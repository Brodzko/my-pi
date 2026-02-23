import * as R from "remeda";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import type { Component } from "@mariozechner/pi-tui";
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import type { GetDiagnosticsResult, NormalizedDiagnostic } from "./types";
import { countBySeverity, type SeverityCounts } from "./shared";

// ── Spinner ───────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_INTERVAL_MS = 80;

const spinnerComponent = (buildLine: (spinner: string) => string): Component => ({
  render: (width) => {
    const frame = Math.floor(Date.now() / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length;
    const line = buildLine(SPINNER_FRAMES[frame]!);
    if (!line) return [];
    return [truncateToWidth(line, width)];
  },
  invalidate: () => {},
});

// ── Constants ─────────────────────────────────────────────────────────────

const ICON = "🩺";

/** Max diagnostic lines to show in collapsed view, per provider. */
const COLLAPSED_PREVIEW_LINES = 5;

/** Providers are rendered in this order. Unlisted providers appear last. */
const PROVIDER_ORDER: Record<string, number> = {
  typescript: 0,
  eslint: 1,
};

const SEVERITY_COLORS: Record<string, ThemeColor> = {
  error: "error",
  warning: "warning",
  info: "muted",
  hint: "dim",
};

// ── Helpers ───────────────────────────────────────────────────────────────

const themedCounts = (counts: SeverityCounts, theme: Theme): string => {
  const parts: string[] = [];
  if (counts.error > 0)
    parts.push(theme.fg("error", `${counts.error} error${counts.error > 1 ? "s" : ""}`));
  if (counts.warning > 0)
    parts.push(theme.fg("warning", `${counts.warning} warning${counts.warning > 1 ? "s" : ""}`));
  if (counts.info > 0) parts.push(theme.fg("muted", `${counts.info} info`));
  if (counts.hint > 0)
    parts.push(theme.fg("dim", `${counts.hint} hint${counts.hint > 1 ? "s" : ""}`));
  return parts.join(", ");
};

const renderDiagnosticLine = (d: NormalizedDiagnostic, theme: Theme): string => {
  const loc = theme.fg("dim", `L${d.range.start.line + 1}:C${d.range.start.character + 1}`);
  const color = SEVERITY_COLORS[d.severity] ?? "dim";
  const severity = theme.fg(color, `[${d.severity}]`);
  const code = d.code ? theme.fg("dim", ` (${d.code})`) : "";
  return `${severity} ${loc} ${d.message}${code}`;
};

const groupByProvider = (
  diagnostics: NormalizedDiagnostic[],
): [provider: string, diags: NormalizedDiagnostic[]][] =>
  R.pipe(
    diagnostics,
    R.groupBy((d) => d.provider),
    Object.entries,
    R.sortBy(([id]) => PROVIDER_ORDER[id] ?? 99),
  );

// ── Public API ────────────────────────────────────────────────────────────

export type ToolParams = {
  path: string;
  content?: string;
  providers?: string[];
};

// Shared state between renderCall and renderResult so the spinner stops
// once the result arrives and the call line can show ✓ instead.
let lastArgs: ToolParams | undefined;
let completed = false;

export const renderCall = (args: ToolParams, theme: Theme): Component => {
  lastArgs = args;
  completed = false;

  const target = theme.fg("accent", args.path);
  const providers =
    args.providers && args.providers.length > 0
      ? theme.fg("dim", ` [${args.providers.join(", ")}]`)
      : "";

  const title = theme.fg("toolTitle", theme.bold("get_diagnostics "));

  return spinnerComponent((spinner) => {
    if (completed) return "";
    return `${theme.fg("warning", spinner)} ${ICON} ${title}${target}${providers}`;
  });
};

export const renderResult = (
  result: { details: GetDiagnosticsResult | undefined },
  options: { expanded: boolean; isPartial?: boolean },
  theme: Theme,
): Component => {
  // Still running
  if (options.isPartial || !result.details) {
    return new Text(theme.fg("muted", "Scanning…"), 0, 0);
  }

  completed = true;

  const { diagnostics, timingMs, processedFiles, truncated } = result.details;
  const counts = countBySeverity(diagnostics);

  // Status icon for result
  const resultIcon =
    counts.error > 0
      ? theme.fg("error", "✗")
      : counts.warning > 0
        ? theme.fg("warning", "⚠")
        : theme.fg("success", "✓");

  // Call line: ✓ 🩺 path [providers]  (replaces the spinner line)
  const targetStr = lastArgs ? theme.fg("accent", lastArgs.path) : "";
  const providersStr =
    lastArgs?.providers && lastArgs.providers.length > 0
      ? theme.fg("dim", ` [${lastArgs.providers.join(", ")}]`)
      : "";
  const title = theme.fg("toolTitle", theme.bold("get_diagnostics "));
  const callLine = `${theme.fg("success", "✓")} ${ICON} ${title}${targetStr}${providersStr}`;

  const countsText =
    diagnostics.length === 0 ? theme.fg("success", "No issues") : themedCounts(counts, theme);

  const meta = theme.fg(
    "dim",
    ` (${processedFiles} file${processedFiles !== 1 ? "s" : ""}, ${timingMs}ms)`,
  );

  const statusLine = `${resultIcon} ${countsText}${meta}`;

  // No issues — compact two-liner
  if (diagnostics.length === 0) {
    return new Text(`${callLine}\n${statusLine}`, 0, 0);
  }

  const providerGroups = groupByProvider(diagnostics);
  const lines: string[] = [callLine, statusLine];

  if (options.expanded) {
    // Full expanded view: all diagnostics grouped by provider → file
    for (const [providerId, providerDiags] of providerGroups) {
      lines.push("");
      lines.push(`  ${theme.fg("accent", theme.bold(providerId))}`);

      const byFile = R.groupBy(providerDiags, (d) => d.path);
      for (const [filePath, fileDiags] of Object.entries(byFile)) {
        const fileCounts = countBySeverity(fileDiags);
        lines.push(`    ${theme.fg("accent", filePath)}: ${themedCounts(fileCounts, theme)}`);
        for (const d of fileDiags) lines.push(`      ${renderDiagnosticLine(d, theme)}`);
      }
    }
  } else {
    // Collapsed preview: a few lines per provider
    for (const [providerId, providerDiags] of providerGroups) {
      lines.push("");
      const providerCounts = countBySeverity(providerDiags);
      lines.push(
        `  ${theme.fg("accent", theme.bold(providerId))}: ${themedCounts(providerCounts, theme)}`,
      );

      const preview = providerDiags.slice(0, COLLAPSED_PREVIEW_LINES);
      for (const d of preview) {
        const file = theme.fg("dim", d.path);
        lines.push(`    ${file} ${renderDiagnosticLine(d, theme)}`);
      }

      const remaining = providerDiags.length - preview.length;
      if (remaining > 0) {
        lines.push(theme.fg("dim", `    … and ${remaining} more`));
      }
    }
  }

  if (truncated) {
    lines.push("");
    lines.push(theme.fg("warning", "  ⚠ Output truncated to 2000 diagnostics"));
  }

  const issues = Object.entries(result.details.providerStatus).filter(
    ([, s]) => s.status !== "ok" && s.status !== "skipped",
  );
  if (issues.length > 0) {
    lines.push("");
    for (const [id, s] of issues) {
      lines.push(theme.fg("warning", `  ${id}: ${s.message ?? s.status}`));
    }
  }

  return new Text(lines.join("\n"), 0, 0);
};
