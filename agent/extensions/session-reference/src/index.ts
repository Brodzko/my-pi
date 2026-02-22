import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { sessionReferenceConfigLoadResult } from './config';
import { buildInjectionPayload } from './inject';
import { parseSessionReferences } from './parse';
import {
  resolveSessionReferences,
  SESSION_REFERENCE_ERROR_CODES,
} from './resolve';
import { createStatusNotifier } from './status';
import { appendInjectionTelemetry, countUnresolvedReasons } from './telemetry';

const sessionReferenceConfig = sessionReferenceConfigLoadResult.config;

type SessionReferenceExtensionState = {
  warnedInvalidConfig: boolean;
};

const createInitialState = (): SessionReferenceExtensionState => ({
  warnedInvalidConfig: false,
});

const notifyInvalidConfig = (
  ctx: ExtensionContext,
  state: SessionReferenceExtensionState
) => {
  if (state.warnedInvalidConfig) {
    return;
  }

  state.warnedInvalidConfig = true;

  const formattedErrors = sessionReferenceConfigLoadResult.errors
    .map(error => `• ${error}`)
    .join('\n');

  ctx.ui.notify(
    `session-reference disabled. Invalid config at ${sessionReferenceConfigLoadResult.path}\n${formattedErrors}`,
    'warning'
  );
};

export const setupSessionReferenceExtension = (pi: ExtensionAPI) => {
  const state = createInitialState();

  pi.on('session_start', async (_event, ctx) => {
    if (!sessionReferenceConfigLoadResult.valid) {
      notifyInvalidConfig(ctx, state);
    }
  });

  pi.on('before_agent_start', async (event, ctx) => {
    if (
      !sessionReferenceConfig.enabled ||
      !sessionReferenceConfigLoadResult.valid
    ) {
      return undefined;
    }

    const prompt = typeof event.prompt === 'string' ? event.prompt : '';
    if (!prompt) {
      return undefined;
    }

    const parsed = parseSessionReferences(
      prompt,
      sessionReferenceConfig.maxRefsPerPrompt
    );

    if (parsed.references.length === 0) {
      return undefined;
    }

    const resolvedReferences = await resolveSessionReferences(
      parsed.references
    );

    const unresolvedReasons = [
      ...resolvedReferences.unresolved.map(unresolved => unresolved.reason),
      ...Array.from(
        { length: parsed.overLimitCount },
        () => SESSION_REFERENCE_ERROR_CODES.overLimit
      ),
    ];

    const resolvedCount = resolvedReferences.resolved.length;
    const unresolvedCount = unresolvedReasons.length;

    const status = createStatusNotifier(ctx, sessionReferenceConfig);
    status.report(resolvedCount, unresolvedCount);

    if (resolvedCount === 0) {
      appendInjectionTelemetry(pi, {
        success: false,
        resolvedCount,
        unresolvedCount,
        unresolvedReasons: countUnresolvedReasons(unresolvedReasons),
        injectedBytes: 0,
        truncated: false,
      });

      return undefined;
    }

    const payload = buildInjectionPayload(
      resolvedReferences.resolved,
      sessionReferenceConfig.maxInjectedBytes
    );

    appendInjectionTelemetry(pi, {
      success: true,
      resolvedCount,
      unresolvedCount,
      unresolvedReasons: countUnresolvedReasons(unresolvedReasons),
      injectedBytes: payload.injectedBytes,
      truncated: payload.truncated,
    });

    return {
      message: {
        customType: 'session-reference',
        content: payload.content,
        display: sessionReferenceConfig.debugDisplayInjectedMessage,
        details: {
          sessionIds: resolvedReferences.resolved.map(
            resolved => resolved.sessionId
          ),
        },
      },
    };
  });
};

export default setupSessionReferenceExtension;
