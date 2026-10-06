/**
 * A disposal group's liabilities are financial obligations: the buyer takes
 * them over against the price, and its borrowings' interest stays in finance
 * cost until the sale. Capitaline files them on their own line, or outside the
 * current and non-current blocks on catch-all lines that also carry
 * regulatory-deferral balances.
 */
import { describe, expect, it } from "vitest";
import { extractRecastDebug, recastBalanceSheet } from "../PenmanNissimEngine/recast";
import { DEFAULT_CONFIG, type RawPeriodData } from "../types";

const period = (values: Record<string, number>): RawPeriodData => ({
  company_id: "HELD_FOR_SALE",
  period_end: "2026-03-31",
  raw_metric_values: {
    "Total Assets__BalanceSheet": 10_000,
    "Total Stockholders' Equity__BalanceSheet": 6_000,
    "Total Equity__BalanceSheet": 6_000,
    "Minority Interest__BalanceSheet": 0,
    "Long Term Borrowings__BalanceSheet": 1_000,
    ...values,
  },
});

describe("held-for-sale liabilities", () => {
  it("reads the older layout's own line as FO", () => {
    // L&T FY17 shape: the group's liabilities on their own line.
    const bs = recastBalanceSheet(period({
      "Assets Classified as Held for Sale__BalanceSheet": 1_649,
      "Liabilities Directly Associated with Assets Classified as Held for Sale__BalanceSheet": 1_496,
    }), DEFAULT_CONFIG);
    expect(bs.FO).toBe(2_496);
    expect(bs.FO_FinancialDebtExLease).toBe(2_496);
    expect(bs.OL).toBe(4_000 - 2_496);
  });

  it("reads the liabilities filed outside the blocks as FO when everything outside the asset blocks is held for sale", () => {
    // L&T FY26 shape: Hyderabad Metro's group outside both blocks.
    const data = period({
      "Non-Current Assets Classified as Held for Sale__BalanceSheet": 2_547,
      "Other Assets Excluding Non-Current and Current Assets__BalanceSheet": 2_547,
      "Other Liabilities Excluding Equity, Non-Current and Current Liabilities__BalanceSheet": 2_097,
    });
    const bs = recastBalanceSheet(data, DEFAULT_CONFIG);
    expect(bs.FO).toBe(3_097);
    expect(bs.OL).toBe(4_000 - 3_097);
    // Out of the operating components the coverage check sums.
    expect(bs.OL_OtherNonCurrentLiabilities).toBe(0);
    expect(extractRecastDebug(data, bs).olOutsideSections).toBe(0);
  });

  it("keeps the outside-block liabilities operating when the assets outside the blocks are regulatory deferrals", () => {
    // NTPC FY25 shape: regulatory debits beside a small held-for-sale line.
    const data = period({
      "Regulatory Deferral Account - Debit Balance__BalanceSheet": 1_873,
      "Non-Current Assets Classified as Held for Sale__BalanceSheet": 16,
      "Other Assets Excluding Non-Current and Current Assets__BalanceSheet": 1_889,
      "Other Liabilities Excluding Equity, Non-Current and Current Liabilities__BalanceSheet": 300,
    });
    const bs = recastBalanceSheet(data, DEFAULT_CONFIG);
    expect(bs.FO).toBe(1_000);
    expect(bs.OL_OtherNonCurrentLiabilities).toBe(300);
    expect(extractRecastDebug(data, bs).olOutsideSections).toBe(300);
  });
});
