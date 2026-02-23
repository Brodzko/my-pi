import { describe, it, expect } from "vitest";
import { formatDiagnosticsResult } from "./format";
import { makeDiagnostic, makeResult } from "./test-fixtures";

describe("formatDiagnosticsResult", () => {
  it("returns clean message for zero diagnostics", () => {
    const result = makeResult({ processedFiles: 5 });
    expect(formatDiagnosticsResult(result)).toBe(
      "No diagnostics found (typescript, 5 files checked)",
    );
  });

  it("singularizes '1 file checked'", () => {
    const result = makeResult({ processedFiles: 1 });
    expect(formatDiagnosticsResult(result)).toBe(
      "No diagnostics found (typescript, 1 file checked)",
    );
  });

  it("lists all provider names from providerStatus when no diagnostics", () => {
    const result = makeResult({
      providerStatus: {
        typescript: { status: "ok", timingMs: 50 },
        eslint: { status: "ok", timingMs: 30 },
      },
    });
    expect(formatDiagnosticsResult(result)).toContain("typescript, eslint");
  });

  it("formats diagnostics grouped by file", () => {
    const result = makeResult({
      diagnostics: [
        makeDiagnostic({ path: "/a.ts", message: "err1", severity: "error" }),
        makeDiagnostic({ path: "/a.ts", message: "warn1", severity: "warning" }),
        makeDiagnostic({ path: "/b.ts", message: "err2", severity: "error" }),
      ],
      processedFiles: 2,
      timingMs: 42,
    });
    const output = formatDiagnosticsResult(result);

    // File sections
    expect(output).toContain("/a.ts: 1 error, 1 warning");
    expect(output).toContain("/b.ts: 1 error");

    // Diagnostic lines
    expect(output).toContain("[error] L1:C1 err1");
    expect(output).toContain("[warning] L1:C1 warn1");

    // Footer
    expect(output).toContain("Total: 2 errors, 1 warning | 2 files checked | 42ms");
  });

  it("includes diagnostic code when present", () => {
    const result = makeResult({
      diagnostics: [makeDiagnostic({ code: "TS2322" })],
    });
    expect(formatDiagnosticsResult(result)).toContain("(TS2322)");
  });

  it("omits diagnostic code when absent", () => {
    const result = makeResult({
      diagnostics: [makeDiagnostic({ code: undefined })],
    });
    expect(formatDiagnosticsResult(result)).not.toContain("(undefined)");
  });

  it("shows truncation warning", () => {
    const result = makeResult({
      diagnostics: [makeDiagnostic()],
      truncated: true,
    });
    expect(formatDiagnosticsResult(result)).toContain("⚠ Output truncated");
  });

  it("does not show truncation warning when not truncated", () => {
    const result = makeResult({
      diagnostics: [makeDiagnostic()],
      truncated: false,
    });
    expect(formatDiagnosticsResult(result)).not.toContain("truncated");
  });

  it("reports provider issues (error, timeout) but not ok/skipped", () => {
    const result = makeResult({
      diagnostics: [makeDiagnostic()],
      providerStatus: {
        typescript: { status: "ok", timingMs: 50 },
        eslint: { status: "timeout", timingMs: 60000, message: "Timed out after 60000ms" },
        other: { status: "skipped", timingMs: 0 },
      },
    });
    const output = formatDiagnosticsResult(result);
    expect(output).toContain("eslint: Timed out after 60000ms");
    expect(output).not.toContain("other:");
  });

  it("uses line/column from range (1-indexed)", () => {
    const result = makeResult({
      diagnostics: [
        makeDiagnostic({
          range: { start: { line: 9, character: 4 }, end: { line: 9, character: 10 } },
        }),
      ],
    });
    expect(formatDiagnosticsResult(result)).toContain("L10:C5");
  });
});
