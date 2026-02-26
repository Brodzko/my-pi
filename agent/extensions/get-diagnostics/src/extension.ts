import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  isEditToolResult,
  isWriteToolResult,
  isReadToolResult,
} from "@mariozechner/pi-coding-agent";
import type { ToolResultEvent } from "@mariozechner/pi-coding-agent";
import { createDiagnosticsService } from "./service";
import { createTypescriptProvider } from "./providers/typescript";
import { createEslintProvider } from "./providers/eslint";
import type { DiagnosticsProvider, ProviderStatusInfo } from "./providers/types";
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
 *
 * Handles: read (path only), edit (path only), write (path + content).
 * Read events trigger proactive background diagnostics so results are
 * cached by the time getDiagnostics is called.
 */
const extractSyncPayload = (
  event: ToolResultEvent,
  cwd: string,
  filePattern: RegExp,
): { filePath: string; content?: string } | undefined => {
  if (isReadToolResult(event)) {
    const filePath = event.input["path"] as string | undefined;
    if (!filePath) return undefined;
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    if (!filePattern.test(absPath)) return undefined;
    // Read: no content — just signal that this file is interesting.
    // Service will open it in tsserver + fire proactive geterr.
    return { filePath: absPath };
  }

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

// --- Status line rendering ---

const STATUS_KEY = "diag";

type StatusEntry = {
  state: ProviderStatusInfo["state"];
  detail?: string;
};

/** Track status per provider so we can render them together. */
const providerStatuses = new Map<string, StatusEntry>();

const STATUS_ICONS: Record<string, string> = {
  starting: "◔",
  warming: "◑",
  ready: "●",
  error: "✖",
  stopped: "○",
};

/**
 * Render the combined footer status for all providers.
 * Shows: "● TS ready (TS 5.8.2) │ ◑ ESLint loading…"
 */
const renderStatus = (ctx: ExtensionContext): void => {
  const { theme } = ctx.ui;

  const parts: string[] = [];
  for (const [id, { state, detail }] of providerStatuses) {
    const icon = STATUS_ICONS[state] ?? "?";
    const label = id === "typescript" ? "TS" : id === "eslint" ? "ESLint" : id;

    const themed = ((): string => {
      switch (state) {
        case "starting":
          return theme.fg("dim", `${icon} ${label} starting…`);
        case "warming":
          return theme.fg("accent", `${icon} ${label} loading…`);
        case "ready":
          return (
            theme.fg("success", `${icon} ${label} ready`) +
            (detail ? theme.fg("dim", ` (${detail})`) : "")
          );
        case "error":
          return (
            theme.fg("error", `${icon} ${label} error`) +
            (detail ? theme.fg("dim", ` (${detail})`) : "")
          );
        case "stopped":
          return theme.fg("dim", `${icon} ${label} stopped`);
      }
    })();

    parts.push(themed);
  }

  ctx.ui.setStatus(STATUS_KEY, parts.join(theme.fg("dim", " │ ")));
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

  // Wire provider status changes → permanent footer status line.
  const wireStatus = (provider: DiagnosticsProvider) => {
    provider.onStatusChange = (status) => {
      log("extension", `${provider.id} status change`, status);
      providerStatuses.set(provider.id, status);
      if (sessionCtx) renderStatus(sessionCtx);
    };
  };
  wireStatus(tsProvider);
  wireStatus(eslintProvider);

  // Background prewarm on session start — non-blocking.
  // Clear stale status first (in case a previous session's status persists).
  pi.on("session_start", (_event, ctx) => {
    sessionCtx = ctx;
    providerStatuses.clear();
    ctx.ui.setStatus(STATUS_KEY, "");
    initLog(ctx.cwd);
    log("extension", "session_start: prewarming", { cwd: ctx.cwd });
    service.prewarm(ctx.cwd);
  });

  // Document sync after file reads, edits, and writes.
  // Reads trigger proactive background diagnostics (VS Code model).
  // Edits/writes bump the cache version and re-check.
  pi.on("tool_result", (event, ctx) => {
    const payload = extractSyncPayload(event, ctx.cwd, filePattern);
    if (payload) {
      log("extension", "tool_result: syncing document", {
        filePath: payload.filePath,
        hasContent: payload.content !== undefined,
        trigger: event.toolName,
      });
      service.syncDocument(payload.filePath, payload.content);
    }
  });

  // Cleanup on shutdown — clear status BEFORE nulling sessionCtx so the
  // "stopped" update actually renders (prevents stale "ready" on reload).
  pi.on("session_shutdown", async () => {
    log("extension", "session_shutdown: disposing");
    if (sessionCtx) {
      sessionCtx.ui.setStatus(STATUS_KEY, "");
    }
    sessionCtx = undefined;
    providerStatuses.clear();
    service.dispose();
    closeLog();
  });

  log("extension", "setup: complete");
}
