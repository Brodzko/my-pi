import type { NormalizedDiagnostic } from "../types";

export type ProviderParams = {
  cwd: string;
  files: string[];
  content?: string;
  contentPath?: string;
};

export type PrewarmDoneInfo = {
  success: boolean;
  tsVersion?: string;
  fileCount?: number;
  timingMs?: number;
  message?: string;
};

export type DiagnosticsProvider = {
  id: string;
  /** File extensions this provider can handle (without leading dot), e.g. ["ts", "tsx"]. */
  supportedExtensions: readonly string[];
  isFileSupported: (filePath: string) => boolean;
  getDiagnostics: (params: ProviderParams) => Promise<NormalizedDiagnostic[]>;
  prewarm?: (cwd: string) => void;
  syncDocument?: (filePath: string, content?: string) => void;
  dispose?: () => void;
  onPrewarmDone?: (info: PrewarmDoneInfo) => void;
};
