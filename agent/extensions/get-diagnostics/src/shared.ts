import * as R from "remeda";
import type { DiagnosticSeverity, NormalizedDiagnostic } from "./types";

const pluralize = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? "" : "s"}`;

export type SeverityCounts = Record<DiagnosticSeverity, number>;

export const countBySeverity = (diagnostics: readonly NormalizedDiagnostic[]): SeverityCounts =>
  R.pipe(
    diagnostics,
    R.countBy((d) => d.severity),
    (counts) => ({
      error: counts["error"] ?? 0,
      warning: counts["warning"] ?? 0,
      info: counts["info"] ?? 0,
      hint: counts["hint"] ?? 0,
    }),
  );

/** "3 errors, 1 warning" — omits zero-count severities. */
export const formatCounts = (counts: SeverityCounts): string => {
  const parts: string[] = [];
  if (counts.error > 0) parts.push(pluralize(counts.error, "error"));
  if (counts.warning > 0) parts.push(pluralize(counts.warning, "warning"));
  if (counts.info > 0) parts.push(pluralize(counts.info, "info"));
  if (counts.hint > 0) parts.push(pluralize(counts.hint, "hint"));
  return parts.join(", ") || "0 issues";
};
