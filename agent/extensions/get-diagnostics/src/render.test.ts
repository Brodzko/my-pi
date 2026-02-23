import { describe, it, expect, beforeEach } from "vitest";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { renderCall, renderResult } from "./render";
import { makeDiagnostic, makeResult } from "./test-fixtures";

/**
 * Stub theme that wraps text with [color:text] markers so we can assert
 * on color usage without real ANSI codes.
 *
 * Theme is a class so we can't use an object literal — we cast through unknown.
 */
const stubTheme = {
  fg: (color: string, text: string) => `[${color}:${text}]`,
  bg: (color: string, text: string) => `{${color}:${text}}`,
  bold: (text: string) => `**${text}**`,
  italic: (text: string) => `_${text}_`,
  underline: (text: string) => `__${text}__`,
  strikethrough: (text: string) => `~~${text}~~`,
  dim: (text: string) => `~${text}~`,
} as unknown as Theme;

/** Render a component to a single string (joins lines). */
const renderToString = (component: { render: (width: number) => string[] }): string =>
  component.render(200).join("\n");

describe("renderCall", () => {
  it("shows tool name and path", () => {
    const component = renderCall({ path: "src/foo.ts" }, stubTheme);
    const output = renderToString(component);
    expect(output).toContain("get_diagnostics");
    expect(output).toContain("src/foo.ts");
  });

  it("colors path with accent", () => {
    const component = renderCall({ path: "src/foo.ts" }, stubTheme);
    const output = renderToString(component);
    expect(output).toContain("[accent:src/foo.ts]");
  });

  it("shows providers when specified", () => {
    const component = renderCall({ path: "src/", providers: ["typescript", "eslint"] }, stubTheme);
    const output = renderToString(component);
    expect(output).toContain("typescript, eslint");
  });

  it("omits provider list when not specified", () => {
    const component = renderCall({ path: "src/foo.ts" }, stubTheme);
    const output = renderToString(component);
    expect(output).not.toContain("[dim:");
    // The only dim content would be the provider bracket
  });

  it("includes a spinner frame", () => {
    const component = renderCall({ path: "x.ts" }, stubTheme);
    const output = renderToString(component);
    // Should contain one of the braille spinner frames wrapped in warning color
    expect(output).toMatch(/\[warning:⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏\]/);
  });
});

describe("renderResult", () => {
  beforeEach(() => {
    // Reset module-level state by rendering a fresh call
    renderCall({ path: "test.ts" }, stubTheme);
  });

  describe("partial / in-progress", () => {
    it("shows scanning message when isPartial", () => {
      const component = renderResult(
        { details: undefined },
        { expanded: false, isPartial: true },
        stubTheme,
      );
      const output = renderToString(component);
      expect(output).toContain("Scanning");
    });

    it("shows scanning message when details is undefined", () => {
      const component = renderResult(
        { details: undefined },
        { expanded: false, isPartial: false },
        stubTheme,
      );
      const output = renderToString(component);
      expect(output).toContain("Scanning");
    });
  });

  describe("no issues", () => {
    it("shows success checkmark and 'No issues'", () => {
      const result = makeResult({ processedFiles: 3, timingMs: 50 });
      const component = renderResult({ details: result }, { expanded: false }, stubTheme);
      const output = renderToString(component);
      expect(output).toContain("[success:✓]");
      expect(output).toContain("[success:No issues]");
      expect(output).toContain("3 files");
      expect(output).toContain("50ms");
    });
  });

  describe("with errors", () => {
    const resultWithErrors = makeResult({
      diagnostics: [
        makeDiagnostic({ provider: "typescript", severity: "error", path: "/a.ts" }),
        makeDiagnostic({ provider: "typescript", severity: "warning", path: "/b.ts" }),
      ],
      processedFiles: 2,
      timingMs: 120,
    });

    it("shows error icon when errors present", () => {
      const component = renderResult({ details: resultWithErrors }, { expanded: false }, stubTheme);
      const output = renderToString(component);
      expect(output).toContain("[error:✗]");
    });

    it("shows themed error and warning counts", () => {
      const component = renderResult({ details: resultWithErrors }, { expanded: false }, stubTheme);
      const output = renderToString(component);
      expect(output).toContain("[error:1 error]");
      expect(output).toContain("[warning:1 warning]");
    });

    it("shows call line with checkmark on completion", () => {
      const component = renderResult({ details: resultWithErrors }, { expanded: false }, stubTheme);
      const output = renderToString(component);
      // The call line should start with ✓ icon
      const firstLine = output.split("\n")[0];
      expect(firstLine).toContain("[success:✓]");
      expect(firstLine).toContain("get_diagnostics");
    });
  });

  describe("warning-only result", () => {
    it("shows warning icon when no errors but has warnings", () => {
      const result = makeResult({
        diagnostics: [makeDiagnostic({ severity: "warning" })],
      });
      const component = renderResult({ details: result }, { expanded: false }, stubTheme);
      const output = renderToString(component);
      expect(output).toContain("[warning:⚠]");
    });
  });

  describe("collapsed view", () => {
    it("shows preview lines per provider", () => {
      const diags = Array.from({ length: 8 }, (_, i) =>
        makeDiagnostic({
          provider: "typescript",
          message: `diag ${i}`,
          range: { start: { line: i, character: 0 }, end: { line: i, character: 5 } },
        }),
      );
      const result = makeResult({ diagnostics: diags });
      const component = renderResult({ details: result }, { expanded: false }, stubTheme);
      const output = renderToString(component);

      // Should show first 5
      expect(output).toContain("diag 0");
      expect(output).toContain("diag 4");
      // Should NOT show 6th+
      expect(output).not.toContain("diag 5");
      // Should show "and N more"
      expect(output).toContain("3 more");
    });

    it("does not show 'and N more' when all fit in preview", () => {
      const diags = [makeDiagnostic({ message: "only one" })];
      const result = makeResult({ diagnostics: diags });
      const component = renderResult({ details: result }, { expanded: false }, stubTheme);
      const output = renderToString(component);
      expect(output).not.toContain("more");
    });
  });

  describe("expanded view", () => {
    it("shows all diagnostics grouped by provider and file", () => {
      const diags = [
        makeDiagnostic({ provider: "typescript", path: "/a.ts", message: "ts-err" }),
        makeDiagnostic({ provider: "eslint", path: "/a.ts", message: "lint-err" }),
        makeDiagnostic({ provider: "typescript", path: "/b.ts", message: "ts-err-2" }),
      ];
      const result = makeResult({
        diagnostics: diags,
        providerStatus: {
          typescript: { status: "ok", timingMs: 50 },
          eslint: { status: "ok", timingMs: 30 },
        },
      });
      const component = renderResult({ details: result }, { expanded: true }, stubTheme);
      const output = renderToString(component);

      // Provider headers
      expect(output).toContain("[accent:**typescript**]");
      expect(output).toContain("[accent:**eslint**]");

      // File paths under providers
      expect(output).toContain("[accent:/a.ts]");
      expect(output).toContain("[accent:/b.ts]");

      // All diagnostics present
      expect(output).toContain("ts-err");
      expect(output).toContain("lint-err");
      expect(output).toContain("ts-err-2");
    });

    it("renders typescript before eslint", () => {
      const diags = [
        makeDiagnostic({ provider: "eslint", message: "lint" }),
        makeDiagnostic({ provider: "typescript", message: "ts" }),
      ];
      const result = makeResult({
        diagnostics: diags,
        providerStatus: {
          typescript: { status: "ok", timingMs: 50 },
          eslint: { status: "ok", timingMs: 30 },
        },
      });
      const component = renderResult({ details: result }, { expanded: true }, stubTheme);
      const output = renderToString(component);
      const tsIdx = output.indexOf("typescript");
      const eslintIdx = output.indexOf("eslint");
      expect(tsIdx).toBeLessThan(eslintIdx);
    });
  });

  describe("truncation", () => {
    it("shows truncation warning when truncated", () => {
      const result = makeResult({
        diagnostics: [makeDiagnostic()],
        truncated: true,
      });
      const component = renderResult({ details: result }, { expanded: false }, stubTheme);
      const output = renderToString(component);
      expect(output).toContain("Output truncated");
    });
  });

  describe("provider issues", () => {
    it("shows provider errors/timeouts but not ok/skipped", () => {
      const result = makeResult({
        diagnostics: [makeDiagnostic()],
        providerStatus: {
          typescript: { status: "ok", timingMs: 50 },
          eslint: { status: "timeout", timingMs: 60000, message: "Timed out" },
          other: { status: "skipped", timingMs: 0, message: "No files" },
        },
      });
      const component = renderResult({ details: result }, { expanded: false }, stubTheme);
      const output = renderToString(component);
      expect(output).toContain("eslint: Timed out");
      expect(output).not.toContain("other:");
    });
  });

  describe("severity color coding", () => {
    it("uses correct colors for each severity", () => {
      const diags = [
        makeDiagnostic({ severity: "error", message: "e" }),
        makeDiagnostic({ severity: "warning", message: "w" }),
        makeDiagnostic({ severity: "info", message: "i" }),
        makeDiagnostic({ severity: "hint", message: "h" }),
      ];
      const result = makeResult({ diagnostics: diags });
      const component = renderResult({ details: result }, { expanded: true }, stubTheme);
      const output = renderToString(component);
      expect(output).toContain("[error:[error]]");
      expect(output).toContain("[warning:[warning]]");
      expect(output).toContain("[muted:[info]]");
      expect(output).toContain("[dim:[hint]]");
    });
  });
});
