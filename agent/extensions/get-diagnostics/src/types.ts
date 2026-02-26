export type DiagnosticsProviderId = "typescript" | "eslint";

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export type DiagnosticRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

export type NormalizedDiagnostic = {
  provider: string;
  path: string;
  severity: DiagnosticSeverity;
  message: string;
  code?: string;
  source?: string;
  range: DiagnosticRange;
};

export type ProviderStatus = {
  status: "ok" | "error" | "timeout" | "skipped";
  timingMs: number;
  message?: string;
};

export type GetDiagnosticsResult = {
  request?: {
    path: string;
    providers?: string[];
  };
  diagnostics: NormalizedDiagnostic[];
  providerStatus: Record<string, ProviderStatus>;
  truncated: boolean;
  scannedFiles: number;
  processedFiles: number;
  timingMs: number;
};
