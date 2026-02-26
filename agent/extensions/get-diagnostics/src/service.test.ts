import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDiagnosticsService } from "./service";
import type { DiagnosticsProvider } from "./providers/types";
import { makeDiagnostic } from "./test-fixtures";
import { NormalizedDiagnostic } from "./types";

// Mock fs — must be before imports that use it
vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("node:fs");
  return {
    ...actual,
    statSync: vi.fn(() => ({ isDirectory: () => false })),
  };
});

// Mock tinyglobby
vi.mock("tinyglobby", () => ({
  glob: vi.fn(async () => []),
  globSync: vi.fn(() => []),
}));

// Mock prewarm discovery — service tests shouldn't exercise file discovery
vi.mock("./prewarm-discovery", () => ({
  findPrewarmFile: vi.fn(() => undefined),
}));

// Mock logger
vi.mock("./logger", () => ({
  log: vi.fn(),
}));

const createMockProvider = (overrides: Partial<DiagnosticsProvider> = {}): DiagnosticsProvider => ({
  id: "mock",
  supportedExtensions: ["ts", "tsx"],
  isFileSupported: () => true,
  getDiagnostics: vi.fn(async () => []),
  prewarm: vi.fn(),
  syncDocument: vi.fn(),
  dispose: vi.fn(),
  ...overrides,
});

describe("createDiagnosticsService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getDiagnostics", () => {
    it("returns empty result when no providers match requested ids", async () => {
      const provider = createMockProvider({ id: "typescript" });
      const service = createDiagnosticsService([provider]);

      const result = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["eslint"],
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.processedFiles).toBe(0);
    });

    it("defaults to typescript provider when providers not specified", async () => {
      const tsProvider = createMockProvider({
        id: "typescript",
        getDiagnostics: vi.fn(async () => [makeDiagnostic({ provider: "typescript" })]),
      });
      const eslintProvider = createMockProvider({ id: "eslint" });
      const service = createDiagnosticsService([tsProvider, eslintProvider]);

      const result = await service.getDiagnostics({ cwd: "/tmp", path: "/tmp/foo.ts" });

      expect(tsProvider.getDiagnostics).toHaveBeenCalled();
      expect(eslintProvider.getDiagnostics).not.toHaveBeenCalled();
      expect(result.diagnostics).toHaveLength(1);
    });

    it("runs multiple providers in parallel", async () => {
      const tsProvider = createMockProvider({
        id: "typescript",
        getDiagnostics: vi.fn(async () => [
          makeDiagnostic({ provider: "typescript", message: "ts-err" }),
        ]),
      });
      const eslintProvider = createMockProvider({
        id: "eslint",
        getDiagnostics: vi.fn(async () => [
          makeDiagnostic({ provider: "eslint", message: "lint-err" }),
        ]),
      });
      const service = createDiagnosticsService([tsProvider, eslintProvider]);

      const result = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript", "eslint"],
      });

      expect(result.diagnostics).toHaveLength(2);
      expect(result.diagnostics.map((d) => d.message)).toContain("ts-err");
      expect(result.diagnostics.map((d) => d.message)).toContain("lint-err");
    });

    it("skips provider when no supported files", async () => {
      const provider = createMockProvider({
        id: "typescript",
        isFileSupported: () => false,
      });
      const service = createDiagnosticsService([provider]);

      const result = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.json",
        providers: ["typescript"],
      });

      expect(provider.getDiagnostics).not.toHaveBeenCalled();
      expect(result.providerStatus["typescript"]?.status).toBe("skipped");
    });

    it("handles provider timeout gracefully (user-specified timeout)", async () => {
      const provider = createMockProvider({
        id: "typescript",
        getDiagnostics: vi.fn(
          () =>
            new Promise<NormalizedDiagnostic[]>((resolve) => setTimeout(() => resolve([]), 5000)),
        ),
      });
      const service = createDiagnosticsService([provider]);

      const result = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
        timeoutMs: 50, // user override wins over provider/global default
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.providerStatus["typescript"]?.status).toBe("timeout");
    });

    it("uses provider defaultTimeoutMs when user does not specify timeout", async () => {
      const provider = createMockProvider({
        id: "eslint",
        defaultTimeoutMs: 80, // provider's own default
        getDiagnostics: vi.fn(
          () =>
            new Promise<NormalizedDiagnostic[]>((resolve) => setTimeout(() => resolve([]), 5000)),
        ),
      });
      const service = createDiagnosticsService([provider]);

      const result = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["eslint"],
        // no timeoutMs — should fall back to provider's 80ms
      });

      expect(result.providerStatus["eslint"]?.status).toBe("timeout");
      expect(result.providerStatus["eslint"]?.message).toContain("80ms");
    });

    it("handles provider rejection gracefully", async () => {
      const provider = createMockProvider({
        id: "typescript",
        getDiagnostics: vi.fn(async () => {
          throw new Error("tsserver crashed");
        }),
      });
      const service = createDiagnosticsService([provider]);

      const result = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.providerStatus["typescript"]?.status).toBe("error");
      expect(result.providerStatus["typescript"]?.message).toContain("tsserver crashed");
    });

    it("deduplicates diagnostics with same key", async () => {
      const dup = makeDiagnostic({ message: "same error", code: "TS123" });
      const provider = createMockProvider({
        id: "typescript",
        getDiagnostics: vi.fn(async () => [dup, { ...dup }]),
      });
      const service = createDiagnosticsService([provider]);

      const result = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });

      expect(result.diagnostics).toHaveLength(1);
    });

    it("sorts diagnostics by path, then line, then severity", async () => {
      const provider = createMockProvider({
        id: "typescript",
        getDiagnostics: vi.fn(async () => [
          makeDiagnostic({
            path: "/b.ts",
            severity: "warning",
            message: "b-warn",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          }),
          makeDiagnostic({
            path: "/a.ts",
            severity: "error",
            message: "a-err",
            range: { start: { line: 5, character: 0 }, end: { line: 5, character: 5 } },
          }),
          makeDiagnostic({
            path: "/a.ts",
            severity: "warning",
            message: "a-warn",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          }),
        ]),
      });
      const service = createDiagnosticsService([provider]);

      const result = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });

      const messages = result.diagnostics.map((d) => d.message);
      expect(messages).toEqual(["a-warn", "a-err", "b-warn"]);
    });

    it("truncates diagnostics beyond MAX_DIAGNOSTICS (2000)", async () => {
      const diags = Array.from({ length: 2500 }, (_, i) =>
        makeDiagnostic({
          message: `err ${i}`,
          path: `/file${i}.ts`,
          range: { start: { line: i, character: 0 }, end: { line: i, character: 5 } },
        }),
      );
      const provider = createMockProvider({
        id: "typescript",
        getDiagnostics: vi.fn(async () => diags),
      });
      const service = createDiagnosticsService([provider]);

      const result = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });

      expect(result.diagnostics).toHaveLength(2000);
      expect(result.truncated).toBe(true);
    });

    it("sets truncated=false when under limit", async () => {
      const provider = createMockProvider({
        id: "typescript",
        getDiagnostics: vi.fn(async () => [makeDiagnostic()]),
      });
      const service = createDiagnosticsService([provider]);

      const result = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });

      expect(result.truncated).toBe(false);
    });

    it("passes content and contentPath to provider", async () => {
      const provider = createMockProvider({ id: "typescript" });
      const service = createDiagnosticsService([provider]);

      await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        content: "const x: number = 'hello';",
        providers: ["typescript"],
      });

      expect(provider.getDiagnostics).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "const x: number = 'hello';",
          contentPath: "/tmp/foo.ts",
        }),
      );
    });
  });

  describe("cache", () => {
    it("returns cached diagnostics on second getDiagnostics call for same file", async () => {
      const diag = makeDiagnostic({ message: "cached-err" });
      const getDiagnostics = vi.fn(async () => [diag]);
      const provider = createMockProvider({ id: "typescript", getDiagnostics });
      const service = createDiagnosticsService([provider]);

      // First call — populates cache
      const r1 = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });
      expect(r1.diagnostics).toHaveLength(1);
      expect(getDiagnostics).toHaveBeenCalledTimes(1);

      // Second call — cache hit
      const r2 = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });
      expect(r2.diagnostics).toHaveLength(1);
      expect(r2.diagnostics[0]!.message).toBe("cached-err");
      expect(getDiagnostics).toHaveBeenCalledTimes(1); // NOT called again
    });

    it("invalidates cache when syncDocument bumps version", async () => {
      const getDiagnostics = vi.fn(async () => [makeDiagnostic()]);
      const provider = createMockProvider({ id: "typescript", getDiagnostics });
      const service = createDiagnosticsService([provider]);
      service.prewarm("/tmp"); // sets serviceCwd

      // First call — populates cache
      await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });
      expect(getDiagnostics).toHaveBeenCalledTimes(1);

      // syncDocument bumps version (and fires proactive check which calls getDiagnostics again)
      service.syncDocument("/tmp/foo.ts");
      // The proactive check is async — wait for it
      await vi.waitFor(() => expect(getDiagnostics).toHaveBeenCalledTimes(2));

      // Third call — should NOT hit stale cache (version bumped)
      // The proactive check populated fresh cache, but getDiagnostics was called with
      // the bumped version, so it should serve from cache or re-check
      await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });
      // Provider was called: once for first getDiagnostics, once for proactive check
      // Third getDiagnostics hits cache from proactive check (same version)
      expect(getDiagnostics).toHaveBeenCalledTimes(2);
    });

    it("discards stale proactive results when file is edited again before check completes", async () => {
      let callCount = 0;
      const getDiagnostics = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // First proactive check: slow
          await new Promise((r) => setTimeout(r, 50));
          return [makeDiagnostic({ message: "stale" })];
        }
        return [makeDiagnostic({ message: "fresh" })];
      });
      const provider = createMockProvider({ id: "typescript", getDiagnostics });
      const service = createDiagnosticsService([provider]);
      service.prewarm("/tmp");

      // First sync → starts slow proactive check (version 1)
      service.syncDocument("/tmp/foo.ts");
      // Second sync bumps version to 2, but the in-flight dedup prevents
      // a second proactive check from firing (first is still running).
      service.syncDocument("/tmp/foo.ts");

      // Wait for the first (and only) proactive check to complete.
      // It will try to cache with version 1, but file is at version 2 →
      // cacheStore discards the stale result.
      await vi.waitFor(() => expect(getDiagnostics).toHaveBeenCalledTimes(1));
      // Let the slow check resolve and the in-flight cleanup run
      await new Promise((r) => setTimeout(r, 60));

      // getDiagnostics: cache miss (stale was discarded), no in-flight → fresh call
      const result = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });
      // Provider called: once for proactive check, once for getDiagnostics
      expect(getDiagnostics).toHaveBeenCalledTimes(2);
      // Result must be "fresh" (from live call), never "stale"
      expect(result.diagnostics.some((d) => d.message === "stale")).toBe(false);
    });

    it("does not use cache for requests with content override", async () => {
      const getDiagnostics = vi.fn(async () => [makeDiagnostic()]);
      const provider = createMockProvider({ id: "typescript", getDiagnostics });
      const service = createDiagnosticsService([provider]);

      // Populate cache
      await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });
      expect(getDiagnostics).toHaveBeenCalledTimes(1);

      // Request with content — should NOT use cache
      await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        content: "const x = 1;",
        providers: ["typescript"],
      });
      expect(getDiagnostics).toHaveBeenCalledTimes(2);
    });

    it("evicts oldest cache entries when over limit", async () => {
      // MAX_CACHE_ENTRIES_PER_PROVIDER is 200 in production. This test
      // verifies the eviction mechanism by populating 201 entries and
      // checking that the first one was evicted (cache miss → provider call).
      let callCount = 0;
      const getDiagnostics = vi.fn(async () => {
        callCount++;
        return [makeDiagnostic({ message: `call-${callCount}` })];
      });
      const provider = createMockProvider({ id: "typescript", getDiagnostics });
      const service = createDiagnosticsService([provider]);

      // Populate cache with 201 unique files
      for (let i = 0; i < 201; i++) {
        await service.getDiagnostics({
          cwd: "/tmp",
          path: `/tmp/file-${i}.ts`,
          providers: ["typescript"],
        });
      }
      expect(getDiagnostics).toHaveBeenCalledTimes(201);

      // file-0 should have been evicted (oldest). Re-checking it should call provider.
      await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/file-0.ts",
        providers: ["typescript"],
      });
      expect(getDiagnostics).toHaveBeenCalledTimes(202); // cache miss → new call

      // file-200 should still be cached (newest). Re-checking should NOT call provider.
      await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/file-200.ts",
        providers: ["typescript"],
      });
      expect(getDiagnostics).toHaveBeenCalledTimes(202); // cache hit
    });

    it("does not use cache for multi-file requests", async () => {
      // Multi-file = directory scan. Cache is only for single-file.
      // This test verifies the provider is always called for directories.
      const getDiagnostics = vi.fn(async () => [makeDiagnostic()]);
      const provider = createMockProvider({
        id: "typescript",
        getDiagnostics,
        // Two files supported
        isFileSupported: (f: string) => f.endsWith(".ts"),
      });
      const service = createDiagnosticsService([provider]);

      // Need the glob mock to return multiple files for directory scan
      const { glob } = await import("tinyglobby");
      const mockGlob = vi.mocked(glob);
      const { statSync } = await import("node:fs");
      const mockStat = vi.mocked(statSync);
      mockStat.mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
      mockGlob.mockResolvedValue(["/tmp/dir/a.ts", "/tmp/dir/b.ts"]);

      await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/dir",
        providers: ["typescript"],
      });
      expect(getDiagnostics).toHaveBeenCalledTimes(1);

      // Second call — still calls provider (no multi-file cache)
      await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/dir",
        providers: ["typescript"],
      });
      expect(getDiagnostics).toHaveBeenCalledTimes(2);
    });
  });

  describe("prewarm", () => {
    it("delegates to all providers regardless of proactive flag", () => {
      const p1 = createMockProvider({ id: "typescript" });
      const p2 = createMockProvider({ id: "eslint", proactive: false });
      const service = createDiagnosticsService([p1, p2]);

      service.prewarm("/project");

      // Both providers get prewarmed — prewarm is a one-time startup cost,
      // separate from proactive background checks (which respect proactive flag).
      expect(p1.prewarm).toHaveBeenCalledWith("/project", undefined);
      expect(p2.prewarm).toHaveBeenCalledWith("/project", undefined);
    });

    it("passes discovered file hint to all providers", async () => {
      const { findPrewarmFile } = await import("./prewarm-discovery");
      vi.mocked(findPrewarmFile).mockReturnValueOnce("/project/src/index.ts");

      const p1 = createMockProvider({ id: "typescript" });
      const p2 = createMockProvider({ id: "eslint", proactive: false });
      const service = createDiagnosticsService([p1, p2]);

      service.prewarm("/project");

      expect(p1.prewarm).toHaveBeenCalledWith("/project", {
        file: "/project/src/index.ts",
      });
      expect(p2.prewarm).toHaveBeenCalledWith("/project", {
        file: "/project/src/index.ts",
      });
    });
  });

  describe("syncDocument", () => {
    it("delegates to all providers", () => {
      const p1 = createMockProvider({ id: "typescript" });
      const p2 = createMockProvider({ id: "eslint" });
      const service = createDiagnosticsService([p1, p2]);
      service.prewarm("/tmp");

      service.syncDocument("/tmp/foo.ts", "content");

      expect(p1.syncDocument).toHaveBeenCalledWith("/tmp/foo.ts", "content");
      expect(p2.syncDocument).toHaveBeenCalledWith("/tmp/foo.ts", "content");
    });

    it("fires proactive background check for each provider", async () => {
      const getDiagnostics = vi.fn(async () => [makeDiagnostic()]);
      const provider = createMockProvider({ id: "typescript", getDiagnostics });
      const service = createDiagnosticsService([provider]);
      service.prewarm("/tmp");

      service.syncDocument("/tmp/foo.ts");

      // Proactive check should have been fired (async)
      await vi.waitFor(() => expect(getDiagnostics).toHaveBeenCalledTimes(1));
      expect(getDiagnostics).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/tmp", files: ["/tmp/foo.ts"] }),
      );
    });

    it("does not fire proactive check for providers with proactive=false", async () => {
      const tsDiag = vi.fn(async () => [makeDiagnostic()]);
      const eslintDiag = vi.fn(async () => [makeDiagnostic()]);
      const tsProvider = createMockProvider({ id: "typescript", getDiagnostics: tsDiag });
      const eslintProvider = createMockProvider({
        id: "eslint",
        proactive: false,
        getDiagnostics: eslintDiag,
      });
      const service = createDiagnosticsService([tsProvider, eslintProvider]);
      service.prewarm("/tmp");

      service.syncDocument("/tmp/foo.ts");

      // Only typescript provider should get a proactive check
      await vi.waitFor(() => expect(tsDiag).toHaveBeenCalledTimes(1));
      // ESLint should NOT have been called
      expect(eslintDiag).not.toHaveBeenCalled();
    });

    it("does not fire proactive check for unsupported files", async () => {
      const getDiagnostics = vi.fn(async () => []);
      const provider = createMockProvider({
        id: "typescript",
        getDiagnostics,
        isFileSupported: (f: string) => f.endsWith(".ts"),
      });
      const service = createDiagnosticsService([provider]);
      service.prewarm("/tmp");

      service.syncDocument("/tmp/foo.json");

      // Give async ops time to run
      await new Promise((r) => setTimeout(r, 20));
      expect(getDiagnostics).not.toHaveBeenCalled();
    });

    it("skips duplicate proactive check when one is already in-flight", async () => {
      let resolveFirst!: (v: NormalizedDiagnostic[]) => void;
      const firstCall = new Promise<NormalizedDiagnostic[]>((r) => {
        resolveFirst = r;
      });
      const getDiagnostics = vi.fn(async () => firstCall);
      const provider = createMockProvider({ id: "typescript", getDiagnostics });
      const service = createDiagnosticsService([provider]);
      service.prewarm("/tmp");

      // First sync — starts proactive check
      service.syncDocument("/tmp/foo.ts");
      // Second sync — should detect in-flight and skip
      service.syncDocument("/tmp/foo.ts");

      // Only one provider.getDiagnostics call (the proactive check)
      expect(getDiagnostics).toHaveBeenCalledTimes(1);

      resolveFirst([makeDiagnostic()]);
      await vi.waitFor(() => expect(getDiagnostics).toHaveBeenCalledTimes(1));
    });
  });

  describe("in-flight proactive check tracking", () => {
    it("getDiagnostics awaits in-flight check instead of duplicating", async () => {
      let resolveProactive!: (v: NormalizedDiagnostic[]) => void;
      const proactivePromise = new Promise<NormalizedDiagnostic[]>((r) => {
        resolveProactive = r;
      });
      const getDiagnostics = vi.fn(() => proactivePromise);
      const provider = createMockProvider({ id: "typescript", getDiagnostics });
      const service = createDiagnosticsService([provider]);
      service.prewarm("/tmp");

      // syncDocument triggers proactive check (still pending)
      service.syncDocument("/tmp/foo.ts");
      expect(getDiagnostics).toHaveBeenCalledTimes(1);

      // Start getDiagnostics — should piggyback on in-flight, not fire a new call
      const resultPromise = service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });

      // Still only 1 call — getDiagnostics is awaiting the same promise
      expect(getDiagnostics).toHaveBeenCalledTimes(1);

      // Resolve the proactive check
      const diag = makeDiagnostic({ message: "from-proactive" });
      resolveProactive([diag]);

      const result = await resultPromise;
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.message).toBe("from-proactive");
      // Provider was only called ONCE total (not twice)
      expect(getDiagnostics).toHaveBeenCalledTimes(1);
    });

    it("getDiagnostics falls through to live call when no in-flight check", async () => {
      const getDiagnostics = vi.fn(async () => [makeDiagnostic({ message: "live" })]);
      const provider = createMockProvider({ id: "typescript", getDiagnostics });
      const service = createDiagnosticsService([provider]);

      // No syncDocument → no proactive check → no in-flight
      const result = await service.getDiagnostics({
        cwd: "/tmp",
        path: "/tmp/foo.ts",
        providers: ["typescript"],
      });

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.message).toBe("live");
      expect(getDiagnostics).toHaveBeenCalledTimes(1);
    });
  });

  describe("dispose", () => {
    it("delegates to all providers", () => {
      const p1 = createMockProvider({ id: "typescript" });
      const p2 = createMockProvider({ id: "eslint" });
      const service = createDiagnosticsService([p1, p2]);

      service.dispose();

      expect(p1.dispose).toHaveBeenCalled();
      expect(p2.dispose).toHaveBeenCalled();
    });
  });
});
