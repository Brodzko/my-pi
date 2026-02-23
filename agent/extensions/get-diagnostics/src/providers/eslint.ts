import * as path from "node:path";
import { createRequire } from "node:module";
import * as R from "remeda";
import type { NormalizedDiagnostic, DiagnosticSeverity } from "../types";
import type { DiagnosticsProvider, ProviderParams } from "./types";

type ESLintLintMessage = {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
};

type ESLintLintResult = {
  filePath: string;
  messages: ESLintLintMessage[];
};

type ESLintInstance = {
  lintFiles: (patterns: string[]) => Promise<ESLintLintResult[]>;
  lintText: (code: string, options?: { filePath?: string }) => Promise<ESLintLintResult[]>;
};

type ESLintConstructor = new (options: { cwd: string }) => ESLintInstance;

const resolveESLint = (cwd: string): ESLintConstructor | undefined => {
  try {
    const require = createRequire(path.join(cwd, "package.json"));
    const eslintPath = require.resolve("eslint");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const eslintModule = require(eslintPath) as { ESLint?: ESLintConstructor };
    return eslintModule.ESLint;
  } catch {
    return undefined;
  }
};

const SEVERITY_MAP: Record<number, DiagnosticSeverity> = {
  1: "warning",
  2: "error",
};

const normalizeResults = (results: ESLintLintResult[], cwd: string): NormalizedDiagnostic[] =>
  R.pipe(
    results,
    R.flatMap((result) =>
      result.messages.map(
        (msg): NormalizedDiagnostic => ({
          provider: "eslint",
          path: path.relative(cwd, result.filePath),
          severity: SEVERITY_MAP[msg.severity] ?? "warning",
          message: msg.message,
          code: msg.ruleId ?? undefined,
          source: "eslint",
          range: {
            start: {
              line: Math.max(0, msg.line - 1),
              character: Math.max(0, msg.column - 1),
            },
            end: {
              line: Math.max(0, (msg.endLine ?? msg.line) - 1),
              character: Math.max(0, (msg.endColumn ?? msg.column) - 1),
            },
          },
        }),
      ),
    ),
  );

const makeErrorDiagnostic = (message: string): NormalizedDiagnostic => ({
  provider: "eslint",
  path: "",
  severity: "error",
  message,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
});

const makeInfoDiagnostic = (message: string): NormalizedDiagnostic => ({
  provider: "eslint",
  path: "",
  severity: "info",
  message,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
});

export const createEslintProvider = (): DiagnosticsProvider => {
  const instances = new Map<string, ESLintInstance>();

  const getOrCreate = (cwd: string): ESLintInstance | undefined => {
    const existing = instances.get(cwd);
    if (existing) return existing;

    const ESLint = resolveESLint(cwd);
    if (!ESLint) return undefined;

    const instance = new ESLint({ cwd });
    instances.set(cwd, instance);
    return instance;
  };

  const supportedExtensions = ["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"] as const;
  const extPattern = new RegExp(`\\.(${supportedExtensions.join("|")})$`);

  return {
    id: "eslint",
    supportedExtensions,
    isFileSupported: (filePath: string) => extPattern.test(filePath),

    getDiagnostics: async (params: ProviderParams) => {
      const eslint = getOrCreate(params.cwd);
      if (!eslint) {
        return [makeInfoDiagnostic("ESLint not found in project. Install with: npm i -D eslint")];
      }

      try {
        const results =
          params.content !== undefined && params.contentPath
            ? await eslint.lintText(params.content, { filePath: params.contentPath })
            : await eslint.lintFiles(params.files);
        return normalizeResults(results, params.cwd);
      } catch (e) {
        return [makeErrorDiagnostic(`ESLint error: ${e instanceof Error ? e.message : String(e)}`)];
      }
    },

    dispose: () => {
      instances.clear();
    },
  };
};
