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

    it("handles provider timeout gracefully", async () => {
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
        timeoutMs: 50,
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.providerStatus["typescript"]?.status).toBe("timeout");
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

  describe("prewarm", () => {
    it("delegates to all providers", () => {
      const p1 = createMockProvider({ id: "typescript" });
      const p2 = createMockProvider({ id: "eslint" });
      const service = createDiagnosticsService([p1, p2]);

      service.prewarm("/project");

      expect(p1.prewarm).toHaveBeenCalledWith("/project");
      expect(p2.prewarm).toHaveBeenCalledWith("/project");
    });
  });

  describe("syncDocument", () => {
    it("delegates to all providers", () => {
      const p1 = createMockProvider({ id: "typescript" });
      const p2 = createMockProvider({ id: "eslint" });
      const service = createDiagnosticsService([p1, p2]);

      service.syncDocument("/tmp/foo.ts", "content");

      expect(p1.syncDocument).toHaveBeenCalledWith("/tmp/foo.ts", "content");
      expect(p2.syncDocument).toHaveBeenCalledWith("/tmp/foo.ts", "content");
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
