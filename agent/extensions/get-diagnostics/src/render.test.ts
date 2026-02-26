import { describe, it, expect } from "vitest";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { renderCall, renderResult } from "./render";
import { makeDiagnostic, makeResult } from "./test-fixtures";

const stubTheme = {
  fg: (color: string, text: string) => `[${color}:${text}]`,
  bg: (color: string, text: string) => `{${color}:${text}}`,
  bold: (text: string) => `**${text}**`,
  italic: (text: string) => `_${text}_`,
  underline: (text: string) => `__${text}__`,
  strikethrough: (text: string) => `~~${text}~~`,
  dim: (text: string) => `~${text}~`,
} as unknown as Theme;

const renderToString = (component: { render: (width: number) => string[] }): string =>
  component.render(200).join("\n");

describe("renderCall", () => {
  it("shows tool name and path", () => {
    const component = renderCall({ path: "src/foo.ts" }, stubTheme);
    const output = renderToString(component);
    expect(output).toContain("get_diagnostics");
    expect(output).toContain("src/foo.ts");
  });

  it("shows providers when specified", () => {
    const component = renderCall({ path: "src/foo.ts", providers: ["eslint"] }, stubTheme);
    const output = renderToString(component);
    expect(output).toContain("eslint");
  });
});

describe("renderResult", () => {
  it("shows status summary when collapsed with no diagnostics", () => {
    const result = {
      content: [{ type: "text" as const, text: "No diagnostics found" }],
      details: makeResult(),
    };
    const component = renderResult(result, { expanded: false }, stubTheme);
    const output = renderToString(component);
    expect(output).toContain("no issues");
    expect(output).toContain("1 file");
    expect(output).toContain("100ms");
    expect(output).not.toContain("No diagnostics found");
  });

  it("shows diagnostic count summary when collapsed with errors", () => {
    const result = {
      content: [{ type: "text" as const, text: "src/foo.ts: 1 error\n  [error] L1:C1 bad" }],
      details: makeResult({
        diagnostics: [makeDiagnostic()],
      }),
    };
    const component = renderResult(result, { expanded: false }, stubTheme);
    const output = renderToString(component);
    expect(output).toContain("1 error");
    expect(output).toContain("100ms");
  });

  it("shows truncation and provider issues in meta", () => {
    const result = {
      content: [{ type: "text" as const, text: "..." }],
      details: makeResult({
        truncated: true,
        processedFiles: 5,
        timingMs: 250,
        providerStatus: { eslint: { status: "timeout", timingMs: 60000, message: "timed out" } },
      }),
    };
    const component = renderResult(result, { expanded: false }, stubTheme);
    const output = renderToString(component);
    expect(output).toContain("5 files");
    expect(output).toContain("250ms");
    expect(output).toContain("truncated");
    expect(output).toContain("timed out");
  });

  it("shows full diagnostic output when expanded", () => {
    const result = {
      content: [{ type: "text" as const, text: "line a\nline b" }],
      details: makeResult(),
    };
    const component = renderResult(result, { expanded: true }, stubTheme);
    const output = renderToString(component);
    expect(output).toContain("line a");
    expect(output).toContain("line b");
  });

  it("returns empty component while partial", () => {
    const result = {
      content: [{ type: "text" as const, text: "ignored" }],
      details: makeResult(),
    };
    const component = renderResult(result, { expanded: false, isPartial: true }, stubTheme);
    const lines = component.render(200);
    expect(lines).toHaveLength(0);
  });
});
