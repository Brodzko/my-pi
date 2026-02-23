import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@mariozechner/pi-coding-agent";
import type { DiagnosticsService } from "./service";
import type { GetDiagnosticsResult } from "./types";
import { formatDiagnosticsResult } from "./format";
import { renderCall, renderResult } from "./render";
import { log } from "./logger";

const GetDiagnosticsParams = Type.Object({
  path: Type.String({
    description: "File or directory path to check. Relative to cwd or absolute.",
  }),
  content: Type.Optional(
    Type.String({
      description:
        "Unsaved file content to check instead of reading from disk. Only for single file.",
    }),
  ),
  providers: Type.Optional(
    Type.Array(StringEnum(["typescript", "eslint"] as const), {
      description:
        'Diagnostic providers to run. Defaults to ["typescript"]. Use ["typescript", "eslint"] for both.',
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({
      description: "Timeout in milliseconds per provider. Default: 60000.",
    }),
  ),
  maxFiles: Type.Optional(
    Type.Number({
      description: "Maximum files to check when path is a directory. Default: 200.",
    }),
  ),
});

export const registerGetDiagnosticsTool = (pi: ExtensionAPI, service: DiagnosticsService): void => {
  pi.registerTool({
    name: "get_diagnostics",
    label: "Diagnostics",
    description:
      "Get TypeScript and ESLint diagnostics for a file or directory. Returns type errors, lint violations, and other issues. Faster than running tsc or eslint CLI \u2014 uses cached in-memory analysis. Use after editing files to verify changes.",
    parameters: GetDiagnosticsParams,

    async execute(
      _toolCallId: string,
      params: {
        path: string;
        content?: string;
        providers?: string[];
        timeoutMs?: number;
        maxFiles?: number;
      },
      _signal: AbortSignal | undefined,
      _onUpdate: AgentToolUpdateCallback<GetDiagnosticsResult> | undefined,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<GetDiagnosticsResult>> {
      const t0 = Date.now();
      log("tool", "execute: start", {
        params: {
          ...params,
          content: params.content ? `<${params.content.length} chars>` : undefined,
        },
      });

      // Normalize path — strip @ prefix if present (some agents prepend it)
      const targetPath = params.path.startsWith("@") ? params.path.slice(1) : params.path;

      const absPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(ctx.cwd, targetPath);

      log("tool", "execute: resolved path", { targetPath, absPath, cwd: ctx.cwd });

      const result = await service.getDiagnostics({
        cwd: ctx.cwd,
        path: absPath,
        content: params.content,
        providers: params.providers,
        timeoutMs: params.timeoutMs,
        maxFiles: params.maxFiles,
      });

      const text = formatDiagnosticsResult(result);

      log("tool", "execute: complete", {
        totalMs: Date.now() - t0,
        diagnosticCount: result.diagnostics.length,
        providerStatus: result.providerStatus,
      });

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },

    renderCall: (args, theme) =>
      renderCall(args as { path: string; content?: string; providers?: string[] }, theme),

    renderResult: (result, options, theme) =>
      renderResult(result as { details: GetDiagnosticsResult | undefined }, options, theme),
  });
};
