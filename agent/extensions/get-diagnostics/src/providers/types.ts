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

/**
 * Lifecycle status of a diagnostics provider.
 * - starting: server process is spawning / initializing
 * - warming:  server is alive, project is loading in background
 * - ready:    project loaded, next call expected to be fast (~100ms)
 * - error:    server crashed or failed to start
 * - stopped:  explicitly disposed (session shutdown)
 */
export type ProviderStatusState = "starting" | "warming" | "ready" | "error" | "stopped";

export type ProviderStatusInfo = {
  state: ProviderStatusState;
  /** Human-readable detail (e.g. "TS 5.7.2", error message). */
  detail?: string;
};

export type DiagnosticsProvider = {
  id: string;
  /** File extensions this provider can handle (without leading dot), e.g. ["ts", "tsx"]. */
  supportedExtensions: readonly string[];
  /** Per-provider timeout in ms. Used when the user doesn't specify one.
   *  Providers with expensive cold starts (e.g. ESLint with type-aware rules)
   *  should set a higher value than the service default. */
  defaultTimeoutMs?: number;
  /**
   * Whether this provider runs proactive background checks on file read/edit.
   * When true, syncDocument fires a background diagnostic check that caches
   * results for fast getDiagnostics responses. When false, the provider only
   * runs when explicitly requested via getDiagnostics.
   *
   * Set to false for expensive providers (e.g. ESLint with type-aware rules)
   * that should only run on demand to conserve memory and CPU.
   *
   * Default: true (backwards compatible).
   */
  proactive?: boolean;
  isFileSupported: (filePath: string) => boolean;
  getDiagnostics: (params: ProviderParams) => Promise<NormalizedDiagnostic[]>;
  /** Warm up the provider for the given cwd. File hint is a source file already
   *  discovered by the service — providers should use it to load the right project. */
  prewarm?: (cwd: string, options?: { file?: string }) => void;
  syncDocument?: (filePath: string, content?: string) => void;
  dispose?: () => void;
  onPrewarmDone?: (info: PrewarmDoneInfo) => void;
  /** Called whenever the provider's lifecycle status changes. */
  onStatusChange?: (status: ProviderStatusInfo) => void;
};
