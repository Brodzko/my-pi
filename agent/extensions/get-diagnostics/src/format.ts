import * as R from "remeda";
import type { GetDiagnosticsResult, NormalizedDiagnostic } from "./types";
import { countBySeverity, formatCounts } from "./shared";

const formatDiagnosticLine = (d: NormalizedDiagnostic): string => {
  const loc = `L${d.range.start.line + 1}:C${d.range.start.character + 1}`;
  const code = d.code ? ` (${d.code})` : "";
  return `  [${d.severity}] ${loc} ${d.message}${code}`;
};

const formatFileSection = (filePath: string, diagnostics: NormalizedDiagnostic[]): string => {
  const header = `${filePath}: ${formatCounts(countBySeverity(diagnostics))}`;
  const lines = diagnostics.map(formatDiagnosticLine);
  return `${header}\n${lines.join("\n")}`;
};

export const formatDiagnosticsResult = (result: GetDiagnosticsResult): string => {
  const { diagnostics, processedFiles, providerStatus, truncated, timingMs } = result;

  if (diagnostics.length === 0) {
    const providers = Object.keys(providerStatus).join(", ") || "typescript";
    const files = `${processedFiles} file${processedFiles !== 1 ? "s" : ""}`;
    return `No diagnostics found (${providers}, ${files} checked)`;
  }

  const sections = R.pipe(
    diagnostics,
    R.groupBy((d) => d.path),
    (grouped) => Object.entries(grouped).map(([path, diags]) => formatFileSection(path, diags)),
  );

  const counts = countBySeverity(diagnostics);
  const files = `${processedFiles} file${processedFiles !== 1 ? "s" : ""}`;
  let footer = `\n\nTotal: ${formatCounts(counts)} | ${files} checked | ${timingMs}ms`;
  if (truncated) footer += ` | ⚠ Output truncated`;

  const providerIssues = R.pipe(
    Object.entries(providerStatus),
    R.filter(([, s]) => s.status !== "ok" && s.status !== "skipped"),
    R.map(([id, s]) => `  - ${id}: ${s.message ?? s.status}`),
  );

  if (providerIssues.length > 0) {
    footer += `\n\nProvider issues:\n${providerIssues.join("\n")}`;
  }

  return sections.join("\n\n") + footer;
};
