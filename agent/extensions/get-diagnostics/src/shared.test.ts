import { describe, it, expect } from "vitest";
import { countBySeverity, formatCounts } from "./shared";
import { makeDiagnostic, makeMixedDiagnostics } from "./test-fixtures";

describe("countBySeverity", () => {
  it("returns zeros for empty array", () => {
    expect(countBySeverity([])).toEqual({ error: 0, warning: 0, info: 0, hint: 0 });
  });

  it("counts single severity", () => {
    const diags = [makeDiagnostic({ severity: "error" }), makeDiagnostic({ severity: "error" })];
    expect(countBySeverity(diags)).toEqual({ error: 2, warning: 0, info: 0, hint: 0 });
  });

  it("counts mixed severities", () => {
    const diags = makeMixedDiagnostics({ error: 3, warning: 2, info: 1, hint: 4 });
    expect(countBySeverity(diags)).toEqual({ error: 3, warning: 2, info: 1, hint: 4 });
  });
});

describe("formatCounts", () => {
  it("returns '0 issues' when all counts are zero", () => {
    expect(formatCounts({ error: 0, warning: 0, info: 0, hint: 0 })).toBe("0 issues");
  });

  it("singularizes when count is 1", () => {
    expect(formatCounts({ error: 1, warning: 0, info: 0, hint: 0 })).toBe("1 error");
    expect(formatCounts({ error: 0, warning: 1, info: 0, hint: 0 })).toBe("1 warning");
  });

  it("pluralizes when count > 1", () => {
    expect(formatCounts({ error: 3, warning: 0, info: 0, hint: 0 })).toBe("3 errors");
  });

  it("joins multiple severities with commas", () => {
    expect(formatCounts({ error: 2, warning: 1, info: 0, hint: 0 })).toBe("2 errors, 1 warning");
  });

  it("includes all four severities when present", () => {
    expect(formatCounts({ error: 1, warning: 2, info: 3, hint: 4 })).toBe(
      "1 error, 2 warnings, 3 infos, 4 hints",
    );
  });

  it("omits zero-count severities", () => {
    expect(formatCounts({ error: 0, warning: 0, info: 5, hint: 0 })).toBe("5 infos");
  });
});
