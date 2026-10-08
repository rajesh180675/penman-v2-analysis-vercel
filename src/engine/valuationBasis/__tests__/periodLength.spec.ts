/**
 * A transition year is restated to a twelve-month rate before growth, turnover
 * and returns are measured: Nestlé India's 15-month FY2024 otherwise reads as
 * +44% sales growth and then −17%.
 */
import { describe, expect, it } from "vitest";
import { processCompanyDataFull } from "../../pipeline";
import { DEFAULT_CONFIG, type RawPeriodData } from "../../types";
import { annualizePeriods, periodMonths } from "../periodLength";
import { buildValuationBasis } from "..";

const config = { ...DEFAULT_CONFIG, company_type: "consumer" as const };

/** A consumer company's year, flows scaled to the months it covers. */
const year = (periodEnd: string, sales: number, totalAssets: number): RawPeriodData => ({
  company_id: "TRANSITION",
  period_end: periodEnd,
  raw_metric_values: {
    "Total Assets__BalanceSheet": totalAssets,
    "Total Stockholders' Equity__BalanceSheet": totalAssets * 0.6,
    "Total Equity__BalanceSheet": totalAssets * 0.6,
    "Minority Interest__BalanceSheet": 0,
    "Trade Payables__BalanceSheet": totalAssets * 0.4,
    "Revenue From Operations(Net)__ProfitLoss": sales,
    "Cost of Materials Consumed__ProfitLoss": sales * 0.55,
    "Employee Benefit Expenses__ProfitLoss": sales * 0.1,
    "Other Expenses__ProfitLoss": sales * 0.15,
    "Profit Before Tax__ProfitLoss": sales * 0.2,
    "Tax Expenses__ProfitLoss": sales * 0.05,
    "Profit After Tax__ProfitLoss": sales * 0.15,
    "Total Comprehensive Income for the Year__ProfitLoss": sales * 0.15,
    "Cash Flow From Operating Activities__CashFlow": sales * 0.17,
  },
});

// Calendar years, then a 15-month year to March 2024 and a March year: the
// business grows 10% a year throughout.
const RAW = [
  year("2021-12-31", 10_000, 8_000),
  year("2022-12-31", 11_000, 8_800),
  year("2024-03-31", 12_100 * 1.25, 9_680),
  year("2025-03-31", 13_310, 10_650),
];

describe("periodMonths", () => {
  it("reads a period's length from the gap to the previous year end", () => {
    expect([...periodMonths(RAW).entries()]).toEqual([
      ["2021-12-31", 12], ["2022-12-31", 12], ["2024-03-31", 15], ["2025-03-31", 12],
    ]);
  });

  it("reads a gap no transition year can span as missing years, not a long year", () => {
    // Paytm's export jumps FY16 → FY19.
    expect(periodMonths([{ period_end: "2016-03-31" }, { period_end: "2019-03-31" }]).get("2019-03-31")).toBe(12);
  });
});

describe("annualizePeriods", () => {
  const filed = processCompanyDataFull(RAW, config).periods;
  const { periods, annualized } = annualizePeriods(filed, periodMonths(filed), config);
  const at = (end: string) => periods.find((p) => p.period_end === end)!;
  const filedAt = (end: string) => filed.find((p) => p.period_end === end)!;

  it("restates the transition year's flows to twelve months and leaves its balance sheet as filed", () => {
    expect(annualized).toEqual([{ periodEnd: "2024-03-31", months: 15 }]);
    expect(at("2024-03-31").is.Sales).toBeCloseTo(filedAt("2024-03-31").is.Sales * 12 / 15, 6);
    expect(at("2024-03-31").is.OI).toBeCloseTo(filedAt("2024-03-31").is.OI * 12 / 15, 6);
    expect(at("2024-03-31").cf.CFO).toBeCloseTo(filedAt("2024-03-31").cf.CFO * 12 / 15, 6);
    // A rate is not a flow.
    expect(at("2024-03-31").is.taxRate).toBe(filedAt("2024-03-31").is.taxRate);
    expect(at("2024-03-31").bs).toEqual(filedAt("2024-03-31").bs);
  });

  it("measures growth year on year across the transition", () => {
    // As filed: +37.5% into the 15-month year and −12% out of it.
    expect(filedAt("2024-03-31").ratios!.Sales_growth).toBeCloseTo(0.375, 6);
    expect(filedAt("2025-03-31").ratios!.Sales_growth).toBeCloseTo(-0.12, 6);
    // Restated: the 10% the business grew.
    expect(at("2024-03-31").ratios!.Sales_growth).toBeCloseTo(0.1, 6);
    expect(at("2025-03-31").ratios!.Sales_growth).toBeCloseTo(0.1, 6);
  });

  it("leaves the twelve-month years before the transition untouched", () => {
    expect(at("2021-12-31")).toBe(filedAt("2021-12-31"));
    expect(at("2022-12-31")).toBe(filedAt("2022-12-31"));
  });

  it("is part of the valuation basis, and reported", () => {
    const basis = buildValuationBasis({ ticker: "TRANSITION", periods: filed, rawData: RAW, segmentData: null, config });
    expect(basis.annualizedPeriods).toEqual([{ periodEnd: "2024-03-31", months: 15 }]);
    expect(basis.periods.find((p) => p.period_end === "2025-03-31")!.ratios!.Sales_growth).toBeCloseTo(0.1, 6);
    expect(basis.lendingArm).toBeNull();
  });
});
