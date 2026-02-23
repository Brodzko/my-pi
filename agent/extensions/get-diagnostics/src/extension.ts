import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isEditToolResult, isWriteToolResult } from "@mariozechner/pi-coding-agent";
import type { ToolResultEvent } from "@mariozechner/pi-coding-agent";
import { createDiagnosticsService } from "./service";
import { createTypescriptProvider } from "./providers/typescript";
import { createEslintProvider } from "./providers/eslint";
import type { DiagnosticsProvider } from "./providers/types";
import { registerGetDiagnosticsTool } from "./tool";
import { initLog, log, closeLog } from "./logger";

/** Build a regex matching any file extension supported by the given providers. */
const buildFilePattern = (providers: DiagnosticsProvider[]): RegExp => {
  const exts = [...new Set(providers.flatMap((p) => [...p.supportedExtensions]))];
  return new RegExp(`\\.(${exts.join("|")})$`);
};

/**
 * Extract file path and optional content from a tool_result event
 * for document sync purposes.
 */
const extractSyncPayload = (
  event: ToolResultEvent,
  cwd: string,
  filePattern: RegExp,
): { filePath: string; content?: string } | undefined => {
  if (isEditToolResult(event)) {
    const filePath = event.input["path"] as string | undefined;
    if (!filePath) return undefined;
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    if (!filePattern.test(absPath)) return undefined;
    return { filePath: absPath };
  }

  if (isWriteToolResult(event)) {
    const filePath = event.input["path"] as string | undefined;
    const content = event.input["content"] as string | undefined;
    if (!filePath) return undefined;
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    if (!filePattern.test(absPath)) return undefined;
    return { filePath: absPath, content };
  }

  return undefined;
};

export default function setup(pi: ExtensionAPI): void {
  log("extension", "setup: start");

  const tsProvider = createTypescriptProvider();
  const eslintProvider = createEslintProvider();
  const allProviders = [tsProvider, eslintProvider];
  const filePattern = buildFilePattern(allProviders);
  const service = createDiagnosticsService(allProviders);

  // Register the tool
  registerGetDiagnosticsTool(pi, service);
  log("extension", "setup: tool registered");

  // Track session UI context for status updates from provider events
  let sessionCtx: ExtensionContext | undefined;

  // Listen for prewarm completion from the TS provider
  tsProvider.onPrewarmDone = (info) => {
    log("extension", "prewarm done", info);
    if (sessionCtx) {
      const msg = info.success
        ? `✓ Diagnostics: ready (TS ${info.tsVersion ?? "?"}, ${info.timingMs ?? "?"}ms)`
        : `⚠ Diagnostics: prewarm failed${info.message ? `: ${info.message}` : ""}`;
      sessionCtx.ui.setStatus("diag", msg);
      setTimeout(() => {
        sessionCtx?.ui.setStatus("diag", undefined);
      }, 5000);
    }
  };

  // Background prewarm on session start — non-blocking
  pi.on("session_start", (_event, ctx) => {
    sessionCtx = ctx;
    initLog(ctx.cwd);
    log("extension", "session_start: prewarming", { cwd: ctx.cwd });
    ctx.ui.setStatus("diag", "⏳ Diagnostics: warming up...");
    service.prewarm(ctx.cwd);
  });

  // Document sync after file mutations
  pi.on("tool_result", (event, ctx) => {
    const payload = extractSyncPayload(event, ctx.cwd, filePattern);
    if (payload) {
      log("extension", "tool_result: syncing document", { filePath: payload.filePath });
      service.syncDocument(payload.filePath, payload.content);
    }
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", async () => {
    log("extension", "session_shutdown: disposing");
    sessionCtx = undefined;
    service.dispose();
    closeLog();
  });

  log("extension", "setup: complete");
}
