import { describe, it, expect } from "vitest";
import type { DiagnosticsProvider } from "./types";

/**
 * Verifies that any provider's `isFileSupported` is consistent with
 * its declared `supportedExtensions`. This is a contract test that
 * can be run against any provider implementation.
 */
const testProviderContract = (name: string, create: () => DiagnosticsProvider) => {
  describe(`${name} provider contract`, () => {
    it("has a non-empty id", () => {
      expect(create().id).toBeTruthy();
    });

    it("declares at least one supported extension", () => {
      expect(create().supportedExtensions.length).toBeGreaterThan(0);
    });

    it("isFileSupported returns true for all declared extensions", () => {
      const provider = create();
      for (const ext of provider.supportedExtensions) {
        expect(provider.isFileSupported(`/src/file.${ext}`)).toBe(true);
      }
    });

    it("isFileSupported returns false for non-declared extensions", () => {
      const provider = create();
      const alien = ["json", "css", "md", "html", "py"].filter(
        (ext) => !provider.supportedExtensions.includes(ext),
      );
      for (const ext of alien) {
        expect(provider.isFileSupported(`/src/file.${ext}`)).toBe(false);
      }
    });

    it("isFileSupported handles paths with directories", () => {
      const provider = create();
      const ext = provider.supportedExtensions[0]!;
      expect(provider.isFileSupported(`/deep/nested/path/file.${ext}`)).toBe(true);
    });
  });
};

// Lightweight stubs that mirror the real providers' extension declarations
// without importing the heavy implementations (which spawn processes).

const createTsStub = (): DiagnosticsProvider => {
  const supportedExtensions = ["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"] as const;
  const extPattern = new RegExp(`\\.(${supportedExtensions.join("|")})$`);
  return {
    id: "typescript",
    supportedExtensions,
    isFileSupported: (f) => extPattern.test(f),
    getDiagnostics: async () => [],
  };
};

const createEslintStub = (): DiagnosticsProvider => {
  const supportedExtensions = ["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"] as const;
  const extPattern = new RegExp(`\\.(${supportedExtensions.join("|")})$`);
  return {
    id: "eslint",
    supportedExtensions,
    isFileSupported: (f) => extPattern.test(f),
    getDiagnostics: async () => [],
  };
};

testProviderContract("typescript", createTsStub);
testProviderContract("eslint", createEslintStub);

// Test the pattern derivation logic used by extension.ts
describe("buildFilePattern (extension.ts logic)", () => {
  const buildFilePattern = (providers: DiagnosticsProvider[]): RegExp => {
    const exts = [...new Set(providers.flatMap((p) => [...p.supportedExtensions]))];
    return new RegExp(`\\.(${exts.join("|")})$`);
  };

  it("merges extensions from multiple providers", () => {
    const p1: DiagnosticsProvider = {
      id: "a",
      supportedExtensions: ["ts", "tsx"],
      isFileSupported: () => true,
      getDiagnostics: async () => [],
    };
    const p2: DiagnosticsProvider = {
      id: "b",
      supportedExtensions: ["css", "scss"],
      isFileSupported: () => true,
      getDiagnostics: async () => [],
    };
    const pattern = buildFilePattern([p1, p2]);
    expect(pattern.test("file.ts")).toBe(true);
    expect(pattern.test("file.css")).toBe(true);
    expect(pattern.test("file.json")).toBe(false);
  });

  it("deduplicates overlapping extensions", () => {
    const p1: DiagnosticsProvider = {
      id: "a",
      supportedExtensions: ["ts", "tsx"],
      isFileSupported: () => true,
      getDiagnostics: async () => [],
    };
    const p2: DiagnosticsProvider = {
      id: "b",
      supportedExtensions: ["ts", "jsx"],
      isFileSupported: () => true,
      getDiagnostics: async () => [],
    };
    const pattern = buildFilePattern([p1, p2]);
    // Should match all unique extensions
    expect(pattern.test("file.ts")).toBe(true);
    expect(pattern.test("file.tsx")).toBe(true);
    expect(pattern.test("file.jsx")).toBe(true);
  });

  it("handles a single provider", () => {
    const p: DiagnosticsProvider = {
      id: "css",
      supportedExtensions: ["css"],
      isFileSupported: () => true,
      getDiagnostics: async () => [],
    };
    const pattern = buildFilePattern([p]);
    expect(pattern.test("styles.css")).toBe(true);
    expect(pattern.test("file.ts")).toBe(false);
  });
});
