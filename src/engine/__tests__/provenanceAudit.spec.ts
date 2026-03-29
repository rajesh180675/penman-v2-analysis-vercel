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
  it("suppresses unmatched alias noise when the line resolved successfully", () => {
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
          tier: "Tier B",
          severity: "warning",
          groupId: "cf-debt-movements",
          groupTitle: "Debt proceeds and repayments",
        },
        {
          line: "CF.DebtRepayment",
          issueType: "fuzzy_match",
          key: "Of the short term Borrowings",
          occurrences: 2,
          tier: "Tier B",
          severity: "warning",
          groupId: "cf-debt-movements",
          groupTitle: "Debt proceeds and repayments",
        },
      ]),
    );
    expect(rows.find((row) => row.issueType === "unmatched")).toBeUndefined();
  });

  it("still reports unresolved lines when nothing matched", () => {
    const periods = [
      mkPeriod("2025-03-31", {
        "BS.FA.CashBank": [
          { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 0, matchType: "exact_base", note: "unmatched" },
        ],
      }),
    ];

    expect(buildMappingDiscrepancyRows(periods)).toEqual([
      {
        line: "BS.FA.CashBank",
        issueType: "unmatched",
        key: "Cash and Cash Equivalents",
        occurrences: 1,
        tier: "Tier A",
        severity: "critical",
        groupId: "bs-cash-bank",
        groupTitle: "Cash and bank balances",
      },
    ]);
  });
});
