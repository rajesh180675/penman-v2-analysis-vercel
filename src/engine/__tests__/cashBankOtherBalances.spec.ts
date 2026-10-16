/**
 * "Total Other Bank Balances" is the detailed Capitaline layout's subtotal of
 * the "Bank Balances Other Than Cash and Cash Equivalents" line. In all 76
 * library company-years that carry both they are equal, and the total never
 * appears alone; summed as two lines they counted the same cash twice.
 */
import { describe, expect, it } from "vitest";
import { recastBalanceSheet } from "../PenmanNissimEngine/recast";
import { DEFAULT_CONFIG, type RawPeriodData } from "../types";

const period = (values: Record<string, number>): RawPeriodData => ({
  company_id: "CASH_FIXTURE",
  period_end: "2025-03-31",
  raw_metric_values: {
    "Total Assets__BalanceSheet": 21_447.7,
    "Total Stockholders' Equity__BalanceSheet": 15_000,
    "Total Equity__BalanceSheet": 15_000,
    "Minority Interest__BalanceSheet": 0,
    ...values,
  },
});

describe("cash and bank balances", () => {
  it("reads the other bank balances once when the detailed layout files the line and its subtotal", () => {
    // Paytm FY25: 2,076.9 + 9,480.3. Summing the subtotal too put FA at
    // 21,037.5 against 21,447.7 of total assets, and NOA near zero.
    const bs = recastBalanceSheet(period({
      "Cash and Cash Equivalents__BalanceSheet": 2_076.9,
      "Bank Balances Other Than Cash and Cash Equivalents__BalanceSheet": 9_480.3,
      "Total Other Bank Balances__BalanceSheet": 9_480.3,
    }), DEFAULT_CONFIG);
    expect(bs.FA).toBeCloseTo(11_557.2, 6);
  });

  it("falls back to the subtotal when the line is filed as zero", () => {
    const bs = recastBalanceSheet(period({
      "Cash and Cash Equivalents__BalanceSheet": 2_076.9,
      "Bank Balances Other Than Cash and Cash Equivalents__BalanceSheet": 0,
      "Total Other Bank Balances__BalanceSheet": 9_480.3,
    }), DEFAULT_CONFIG);
    expect(bs.FA).toBeCloseTo(11_557.2, 6);
  });

  it("still adds the other cash lines beside them", () => {
    const bs = recastBalanceSheet(period({
      "Cash and Cash Equivalents__BalanceSheet": 256.8,
      "Bank Balances Other Than Cash and Cash Equivalents__BalanceSheet": 10_311.7,
      "Total Other Bank Balances__BalanceSheet": 10_311.7,
      "Balances with Bank / Margin Money Balances__BalanceSheet": 78.3,
    }), DEFAULT_CONFIG);
    expect(bs.FA).toBeCloseTo(256.8 + 10_311.7 + 78.3, 6);
  });

  it("does not add margin money again beside the long-term other financial assets that hold it", () => {
    // ITC FY25: Others Financial Assets - Long-term 1,557.57 = margin money
    // 1,276.54 + security deposits 30.52 + other deposits 250.51.
    const bs = recastBalanceSheet(period({
      "Cash and Cash Equivalents__BalanceSheet": 620,
      "Bank Balances Other Than Cash and Cash Equivalents__BalanceSheet": 3_392.36,
      "Others Financial Assets - Long-term__BalanceSheet": 1_557.57,
      "Balances with Bank / Margin Money Balances__BalanceSheet": 1_276.54,
    }), DEFAULT_CONFIG);
    expect(bs.FA).toBeCloseTo(620 + 3_392.36 + 1_557.57, 6);
  });
});

describe("loans given", () => {
  // TCS FY21: inter-corporate deposits under "Loans", whose interest is finance income.
  const loans = { "Loans - Long - Term__BalanceSheet": 29, "Loans - Short-term__BalanceSheet": 11_472 };

  it("counts the Ind AS loans lines as financial assets", () => {
    const bs = recastBalanceSheet(period({ "Cash and Cash Equivalents__BalanceSheet": 1_000, ...loans }), DEFAULT_CONFIG);
    expect(bs.FA).toBeCloseTo(1_000 + 29 + 11_472, 6);
  });

  it("leaves them operating where they carry a consolidated lending arm's loan book", () => {
    const bs = recastBalanceSheet(period({ "Cash and Cash Equivalents__BalanceSheet": 1_000, ...loans }), { ...DEFAULT_CONFIG, ticker: "M&M" });
    expect(bs.FA).toBeCloseTo(1_000, 6);
  });
});

describe("deposits held as investments", () => {
  it("does not add certificates of deposit again beside the Current Investments total that holds them", () => {
    // ITC FY23: Current Investments 17,232.86 = mutual funds 9,425.09 + CDs
    // 4,827.80 + bonds 2,979.97. Adding the CDs again overstated FA by 4,827.80.
    const bs = recastBalanceSheet(period({
      "Current Investments__BalanceSheet": 17_232.86,
      "Investments in Mutual Funds__BalanceSheet": 9_425.09,
      "Investment in Certificate of Deposits with Scheduled Banks__BalanceSheet": 4_827.8,
    }), DEFAULT_CONFIG);
    expect(bs.FA).toBeCloseTo(17_232.86, 6);
  });

  it("counts them when no current investments are filed", () => {
    const bs = recastBalanceSheet(period({
      "Investment in Certificate of Deposits__BalanceSheet": 500,
    }), DEFAULT_CONFIG);
    expect(bs.FA).toBeCloseTo(500, 6);
  });

  it("does not read the long-term schedule's measurement categories as current investments", () => {
    // Power Grid FY22: no current investments; the FVTOCI line is the long-term
    // investments' own breakdown (1,926.43 both).
    const bs = recastBalanceSheet(period({
      "Investments - Long-term__BalanceSheet": 1_926.43,
      "Investments Carried at Fair Value Through Other Comprehensive Income(FVTOCI)__BalanceSheet": 1_926.43,
    }), DEFAULT_CONFIG);
    expect(bs.FA).toBeCloseTo(1_926.43, 6);
  });

  it("still adds restricted cash beside current investments", () => {
    const bs = recastBalanceSheet(period({
      "Current Investments__BalanceSheet": 1_000,
      "Restricted Cash__BalanceSheet": 40,
    }), DEFAULT_CONFIG);
    expect(bs.FA).toBeCloseTo(1_040, 6);
  });
});
