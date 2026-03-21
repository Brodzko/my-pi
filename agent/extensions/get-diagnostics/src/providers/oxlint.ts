/**
 * Oxlint diagnostics provider.
 *
 * Oxlint is a fast Rust-based JavaScript/TypeScript linter. Unlike ESLint,
 * it requires no persistent server — each invocation is fast enough (~50-200ms)
 * to shell out directly.
 *
 * - Resolves the binary from project `node_modules/.bin/oxlint`
 * - Runs with `--format json` for machine-readable output
 * - proactive=true — fast enough for background checks on file read/edit
 * - No document tracking needed (reads from disk, or uses stdin for content)
 */
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { NormalizedDiagnostic, DiagnosticSeverity } from '../types';
import type { DiagnosticsProvider, ProviderParams } from './types';
import { log } from '../logger';

// --- Oxlint JSON output types ---

type OxlintMessage = {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
};

type OxlintFileResult = {
  filePath: string;
  messages: OxlintMessage[];
};

// --- Binary resolution ---

const resolveOxlintBinary = (cwd: string): string | undefined => {
  // Walk up from cwd looking for node_modules/.bin/oxlint
  let dir = cwd;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', '.bin', 'oxlint');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not found here
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }
  return undefined;
};

// --- Result normalization ---

const SEVERITY_MAP: Record<number, DiagnosticSeverity> = {
  1: 'warning',
  2: 'error',
};

const normalizeResults = (
  results: OxlintFileResult[],
  cwd: string
): NormalizedDiagnostic[] =>
  results.flatMap(result =>
    result.messages.map(
      (msg): NormalizedDiagnostic => ({
        provider: 'oxlint',
        path: path.relative(cwd, result.filePath),
        severity: SEVERITY_MAP[msg.severity] ?? 'warning',
        message: msg.message,
        code: msg.ruleId ?? undefined,
        source: 'oxlint',
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
      })
    )
  );

// --- Shell execution helper ---

const runOxlint = (
  binary: string,
  args: string[],
  cwd: string,
  stdin?: string
): Promise<string> =>
  new Promise((resolve, reject) => {
    const proc = execFile(
      binary,
      args,
      {
        cwd,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        // oxlint exits with code 1 when there are lint errors — that's normal
      },
      (error, stdout, stderr) => {
        // oxlint uses exit code 0 = no issues, 1 = lint issues found, 2 = error
        if (error && error.code === 2) {
          reject(new Error(`oxlint error: ${stderr || error.message}`));
          return;
        }
        resolve(stdout);
      }
    );

    if (stdin !== undefined) {
      proc.stdin?.write(stdin);
      proc.stdin?.end();
    }
  });

// --- Provider ---

export const createOxlintProvider = (): DiagnosticsProvider => {
  let cachedBinary: string | undefined;
  let binaryResolved = false;

  const resolveBinary = (cwd: string): string | undefined => {
    if (binaryResolved) return cachedBinary;
    cachedBinary = resolveOxlintBinary(cwd);
    binaryResolved = true;
    if (cachedBinary) {
      log('oxlint-provider', 'binary resolved', { path: cachedBinary });
    } else {
      log('oxlint-provider', 'binary not found');
    }
    return cachedBinary;
  };

  const supportedExtensions = [
    'ts',
    'tsx',
    'js',
    'jsx',
    'mts',
    'cts',
    'mjs',
    'cjs',
  ] as const;
  const extPattern = new RegExp(`\\.(${supportedExtensions.join('|')})$`);

  const provider: DiagnosticsProvider = {
    id: 'oxlint',
    supportedExtensions,
    proactive: true,
    onStatusChange: undefined,

    isFileSupported: (filePath: string) => extPattern.test(filePath),

    async getDiagnostics(
      params: ProviderParams
    ): Promise<NormalizedDiagnostic[]> {
      const t0 = Date.now();
      const binary = resolveBinary(params.cwd);

      if (!binary) {
        return [
          {
            provider: 'oxlint',
            path: '',
            severity: 'info',
            message:
              'oxlint not found in project. Install with: npm i -D oxlint',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
          },
        ];
      }

      log('oxlint-provider', 'getDiagnostics: start', {
        fileCount: params.files.length,
        hasContent: params.content !== undefined,
      });

      try {
        const args = ['--format', 'json'];

        if (
          params.content !== undefined &&
          params.contentPath &&
          params.files.length === 1
        ) {
          // Single file with content override: use --stdin-filename
          args.push('--stdin-filename', params.contentPath);
          const stdout = await runOxlint(
            binary,
            args,
            params.cwd,
            params.content
          );
          const results = JSON.parse(stdout) as OxlintFileResult[];
          log('oxlint-provider', 'getDiagnostics: complete (stdin)', {
            ms: Date.now() - t0,
          });
          return normalizeResults(results, params.cwd);
        }

        // File paths as positional args
        args.push(...params.files);
        const stdout = await runOxlint(binary, args, params.cwd);
        const results = JSON.parse(stdout) as OxlintFileResult[];

        log('oxlint-provider', 'getDiagnostics: complete', {
          ms: Date.now() - t0,
          diagnosticCount: results.reduce((n, r) => n + r.messages.length, 0),
        });

        return normalizeResults(results, params.cwd);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log('oxlint-provider', 'getDiagnostics: error', { error: message });
        return [
          {
            provider: 'oxlint',
            path: '',
            severity: 'error',
            message: `oxlint error: ${message}`,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
          },
        ];
      }
    },

    prewarm(cwd: string): void {
      // Just resolve the binary path so first getDiagnostics is fast
      const binary = resolveBinary(cwd);
      if (binary) {
        provider.onStatusChange?.({
          state: 'ready',
          detail: 'oxlint',
        });
      }
      // Don't report error for missing binary — it's optional
    },

    dispose(): void {
      log('oxlint-provider', 'dispose');
      cachedBinary = undefined;
      binaryResolved = false;
      provider.onStatusChange?.({ state: 'stopped' });
    },
  };

  return provider;
};
