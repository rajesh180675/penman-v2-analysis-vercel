import { describe, expect, it } from "vitest";
import { buildMappingDiscrepancyRows } from "../provenanceAudit";
import { RecastPeriod } from "../types";

function mkPeriod(period_end: string, trace: RecastPeriod["trace"]): RecastPeriod {
  return {
    period_end,
    trace,
  } as RecastPeriod;
}

describe("buildMappingDiscrepancyRows", () => {
  it("aggregates duplicate, unmatched and fuzzy discrepancies", () => {
    const periods = [
      mkPeriod("2024-03-31", {
        "CF.DebtRepayment": [
          { statement: "CashFlow", key: "Of the short term Borrowings", value: -52.5, matchType: "exact_composite" },
          { statement: "CashFlow", key: "Of the short term Borrowings", value: 0, matchType: "fuzzy", note: "duplicate_source_ignored:Of the short term Borrowings__CashFlow" },
          { statement: "CashFlow", key: "Of the Long Term Borrowings", value: 0, matchType: "exact_base", note: "unmatched" },
        ],
      }),
      mkPeriod("2025-03-31", {
        "CF.DebtRepayment": [
          { statement: "CashFlow", key: "Of the short term Borrowings", value: -10, matchType: "fuzzy" },
        ],
      }),
    ];

    const rows = buildMappingDiscrepancyRows(periods);

    expect(rows).toEqual(
      expect.arrayContaining([
        {
          line: "CF.DebtRepayment",
          issueType: "duplicate_source_ignored",
          key: "Of the short term Borrowings",
          occurrences: 1,
        },
        {
          line: "CF.DebtRepayment",
          issueType: "unmatched",
          key: "Of the Long Term Borrowings",
          occurrences: 1,
        },
        {
          line: "CF.DebtRepayment",
          issueType: "fuzzy_match",
          key: "Of the short term Borrowings",
          occurrences: 2,
        },
      ]),
    );
  });
});
