import { describe, expect, it } from "vitest";
import { computeRecastPeriod } from "../PenmanNissimEngine";
import { DEFAULT_CONFIG, RawPeriodData } from "../types";

function makeBasePeriod(overrides: Record<string, number>): RawPeriodData {
  return {
    company_id: "MAP",
    period_end: "2025-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000,
      "Total Stockholders' Equity__BalanceSheet": 600,
      "Total Equity__BalanceSheet": 600,
      "Minority Interest__BalanceSheet": 0,
      "Revenue From Operations(Net)__ProfitLoss": 900,
      "Profit Before Tax__ProfitLoss": 140,
      "Tax Expenses__ProfitLoss": 35,
      "Profit After Tax__ProfitLoss": 105,
      "Total Comprehensive Income for the Year__ProfitLoss": 105,
      "Finance Cost__ProfitLoss": 10,
      "Other Income__ProfitLoss": 5,
      "Net Cash from Operating Activities__CashFlow": 120,
      "Purchased of Fixed Assets__CashFlow": -30,
      "Dividend Paid__CashFlow": -10,
      ...overrides,
    },
  };
}

describe("mapping resolution", () => {
  it("does not double count debt repayment/proceeds from typo and case variants", () => {
    const raw = makeBasePeriod({
      "Proceed from 0ther Long Term Borrowings__CashFlow": 25,
      "Of the short term Borrowings__CashFlow": -52.5,
      "Of financial Liabilities__CashFlow": -65.52,
      "Of the Long Tem Borrowings__CashFlow": -1.52,
    });

    const recast = computeRecastPeriod(raw, DEFAULT_CONFIG);

    expect(recast.cf.DebtProceeds).toBe(25);
    expect(recast.cf.DebtRepayment).toBeCloseTo(-119.54, 6);
  });

  it("normalizes key typos for direct scalar mappings", () => {
    const raw = makeBasePeriod({
      "Other Comprehensive Income That Will Be Reclassified to Profit Or Loss :__ProfitLoss": 12,
      "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss__ProfitLoss": 3,
      "Interest Income__ProfitLoss": 8,
    });

    const recast = computeRecastPeriod(raw, DEFAULT_CONFIG);

    expect(recast.is.OCI).toBe(15);
    expect(recast.is.FinanceIncome).toBe(8);
    expect(recast.is.FinanceIncomeRung).toBe(1);
  });

  it("marks missing scalar mappings as unmatched instead of silently presenting them as sourced zeroes", () => {
    const raw = makeBasePeriod({});
    delete raw.raw_metric_values["Total Assets__BalanceSheet"];

    const recast = computeRecastPeriod(raw, DEFAULT_CONFIG);

    expect(recast.bs.TA).toBe(0);
    expect(recast.trace?.["BS.TA"]).toEqual([
      {
        statement: "BalanceSheet",
        key: "Total Assets",
        value: 0,
        matchType: "exact_base",
        note: "unmatched",
      },
    ]);
    expect(recast.spec_flags?.some((flag) => flag.label === "Missing required financial line")).toBe(true);
  });
});
