import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import type { Component } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { GetDiagnosticsResult } from "./types";
import { countBySeverity, formatCounts } from "./shared";

const ICON = "🩺";

const PENDING_INDICATOR = "⋯";

const EMPTY: Component = { render: () => [], invalidate: () => {} };

const getTextContent = (result: AgentToolResult<GetDiagnosticsResult>): string =>
  result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

export type ToolParams = {
  path: string;
  content?: string;
  providers?: string[];
};

export const renderCall = (args: ToolParams, theme: Theme): Component => {
  const target = theme.fg("accent", args.path);
  const providers =
    args.providers && args.providers.length > 0
      ? theme.fg("dim", ` [${args.providers.join(", ")}]`)
      : "";

  const title = theme.fg("toolTitle", theme.bold("get_diagnostics "));

  return {
    render: (width) => {
      const line = `${theme.fg("warning", PENDING_INDICATOR)} ${ICON} ${title}${target}${providers}`;
      return [truncateToWidth(line, width)];
    },
    invalidate: () => {},
  };
};

const buildMeta = (details: GetDiagnosticsResult | undefined): string | undefined => {
  if (!details) return undefined;

  const parts: string[] = [];

  if (details.diagnostics.length === 0) {
    parts.push("no issues");
  } else {
    parts.push(formatCounts(countBySeverity(details.diagnostics)));
  }

  const files = details.processedFiles;
  parts.push(`${files} file${files !== 1 ? "s" : ""}`);
  parts.push(`${details.timingMs}ms`);

  if (details.truncated) parts.push("truncated");

  const providerIssues = Object.entries(details.providerStatus).filter(
    ([, s]) => s.status !== "ok" && s.status !== "skipped",
  );
  if (providerIssues.length > 0) {
    parts.push(providerIssues.map(([id, s]) => `${id}: ${s.message ?? s.status}`).join(", "));
  }

  return parts.join(" | ");
};

export const renderResult = (
  result: AgentToolResult<GetDiagnosticsResult>,
  options: { expanded: boolean; isPartial?: boolean },
  theme: Theme,
): Component => {
  if (options.isPartial) {
    return EMPTY;
  }

  const meta = buildMeta(result.details);
  const statusLine = meta ? theme.fg("muted", `(${meta})`) : undefined;

  if (!options.expanded) {
    if (statusLine) return new Text(statusLine, 0, 0);
    return EMPTY;
  }

  // Expanded: meta + full diagnostic output
  const text = getTextContent(result).trim();
  if (text) {
    const styled = text
      .split("\n")
      .map((line) => theme.fg("toolOutput", line))
      .join("\n");
    if (statusLine) return new Text(`${statusLine}\n${styled}`, 0, 0);
    return new Text(styled, 0, 0);
  }

  if (statusLine) return new Text(statusLine, 0, 0);
  return EMPTY;
};
