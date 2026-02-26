import type {
  NormalizedDiagnostic,
  GetDiagnosticsResult,
  DiagnosticSeverity,
  ProviderStatus,
} from "./types";

export const makeDiagnostic = (
  overrides: Partial<NormalizedDiagnostic> = {},
): NormalizedDiagnostic => ({
  provider: "typescript",
  path: "/src/foo.ts",
  severity: "error",
  message: "Type 'string' is not assignable to type 'number'",
  code: "TS2322",
  source: "ts",
  range: {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 10 },
  },
  ...overrides,
});

export const makeResult = (
  overrides: Partial<GetDiagnosticsResult> = {},
): GetDiagnosticsResult => ({
  request: { path: "src/foo.ts" },
  diagnostics: [],
  providerStatus: { typescript: { status: "ok", timingMs: 100 } },
  truncated: false,
  scannedFiles: 1,
  processedFiles: 1,
  timingMs: 100,
  ...overrides,
});

export const makeProviderStatus = (overrides: Partial<ProviderStatus> = {}): ProviderStatus => ({
  status: "ok",
  timingMs: 100,
  ...overrides,
});

/**
 * Create a batch of diagnostics with varying severities.
 * Useful for testing counts, grouping, and truncation.
 */
export const makeMixedDiagnostics = (counts: Partial<Record<DiagnosticSeverity, number>> = {}) => {
  const { error = 0, warning = 0, info = 0, hint = 0 } = counts;
  const diags: NormalizedDiagnostic[] = [];
  const add = (severity: DiagnosticSeverity, n: number) => {
    for (let i = 0; i < n; i++) {
      diags.push(
        makeDiagnostic({
          severity,
          message: `${severity} ${i}`,
          range: { start: { line: i, character: 0 }, end: { line: i, character: 10 } },
        }),
      );
    }
  };
  add("error", error);
  add("warning", warning);
  add("info", info);
  add("hint", hint);
  return diags;
};
