/**
 * A year filed far from its normal tax rate is taxed at that rate, and the rest
 * of its tax is unusual operating income: Airtel FY25 was filed at 2.4%
 * (deferred tax credited) against 32.5% the year before, and its core OI
 * carried the credit.
 */
import { describe, expect, it } from "vitest";
import { coreTaxComparable } from "../../anomalyDetection/shared";
import { processCompanyDataFull } from "../../pipeline";
import { evaluateReconciliationResiduals } from "../../reconciliationResiduals";
import { DEFAULT_CONFIG, type RawPeriodData, type RecastPeriod } from "../../types";
import { normalTaxRate } from "../unusualTax";

const config = { ...DEFAULT_CONFIG, company_type: "consumer" as const };
const PBT = 130;

/** A year earning PBT 130 on sales of 900, its tax filed at `rate`. */
const year = (periodEnd: string, rate: number): RawPeriodData => ({
  company_id: "UNUSUAL-TAX",
  period_end: periodEnd,
  raw_metric_values: {
    "Total Assets__BalanceSheet": 1000,
    "Total Current Assets__BalanceSheet": 400,
    "Total Non-Current and Other Assets__BalanceSheet": 600,
    "Total Stockholders' Equity__BalanceSheet": 600,
    "Total Equity__BalanceSheet": 600,
    "Total Equity and Liabilities__BalanceSheet": 1000,
    "Minority Interest__BalanceSheet": 0,
    "Net Property, plant and equipment__BalanceSheet": 320,
    "Cash and Cash Equivalents__BalanceSheet": 100,
    "Trade Payables__BalanceSheet": 80,
    "Other Current Liabilities__BalanceSheet": 50,
    "Other Non-Current Liabilities__BalanceSheet": 100,
    "Revenue From Operations(Net)__ProfitLoss": 900,
    "Cost of Material Consumed__ProfitLoss": 400,
    "Employee Benefits / Salaries & other Staff Cost__ProfitLoss": 150,
    "Depreciation and Amortization__ProfitLoss": 40,
    "Other Expenses__ProfitLoss": 170,
    "Other Income__ProfitLoss": 15,
    "Interest Income__ProfitLoss": 10,
    "Finance Cost__ProfitLoss": 25,
    "Profit Before Tax__ProfitLoss": PBT,
    "Tax Expenses__ProfitLoss": PBT * rate,
    "Profit After Tax__ProfitLoss": PBT * (1 - rate),
    "Total Comprehensive Income for the Year__ProfitLoss": PBT * (1 - rate),
    "Net Cash from Operating Activities__CashFlow": 120,
  },
});

const ENDS = ["2022-03-31", "2023-03-31", "2024-03-31", "2025-03-31"];
const run = (rates: readonly number[], cfg = config) =>
  processCompanyDataFull(rates.map((rate, i) => year(ENDS[i] ?? `${2022 + i}-03-31`, rate)), cfg).periods;

// Airtel-shaped: 33.5%, 25.8%, 32.5%, then 2.4%.
const AIRTEL = [0.335, 0.258, 0.325, 0.024];

describe("unusual tax", () => {
  const periods = run(AIRTEL);
  const latest = periods.at(-1)!;

  it("taxes a year filed far from its normal rate at that rate, and books the rest as unusual operating income", () => {
    expect(latest.is.filedTaxRate).toBeCloseTo(0.024, 10);
    expect(latest.is.taxRate).toBeCloseTo(0.325, 10);
    expect(latest.cu.UnusualTaxBenefit).toBeCloseTo(PBT * (0.325 - 0.024), 9);
    expect(latest.cu.UOI).toBeCloseTo(latest.cu.UnusualTaxBenefit!, 9);
    expect(latest.cu.policy?.operatingBuckets.map((b) => b.type)).toContain("unusual_tax");
  });

  it("leaves core OI where the same year filed at its normal rate puts it", () => {
    const filedNormally = run([0.335, 0.258, 0.325, 0.325]).at(-1)!;
    expect(filedNormally.cu.UnusualTaxBenefit).toBe(0);
    expect(latest.cu.CoreOI).toBeCloseTo(filedNormally.cu.CoreOI, 9);
    // The credit stays in earnings as filed, and in OI as unusual.
    expect(latest.is.CNI - filedNormally.is.CNI).toBeCloseTo(latest.cu.UnusualTaxBenefit!, 9);
    expect(latest.is.OI - filedNormally.is.OI).toBeCloseTo(latest.cu.UnusualTaxBenefit!, 9);
  });

  it("leaves a year within ten points of its normal rate as filed", () => {
    // FY23: 25.8% against 33.5% the year before.
    const fy23 = periods[1]!;
    expect(fy23.is.taxRate).toBeCloseTo(0.258, 10);
    expect(fy23.cu.UnusualTaxBenefit).toBe(0);
  });

  it("takes a lasting change in the rate as normal after two years", () => {
    const changed = run([0.40, 0.40, 0.40, 0.25, 0.25, 0.25]);
    expect(changed.map((p) => p.cu.UnusualTaxBenefit !== 0)).toEqual([false, false, false, true, true, false]);
    expect(changed[5]!.is.taxRate).toBeCloseTo(0.25, 10);
    // Against the filed rates, not the normalized ones: the years before the
    // last were taxed at 40%, but two of them were filed at 25%.
    expect(changed.map((_, i) => coreTaxComparable(changed, i, config))).toEqual([false, true, true, true, true, true]);
  });

  it("counts the normalized year's core as comparable with its history", () => {
    expect(coreTaxComparable(periods, periods.length - 1, config)).toBe(true);
  });

  it("keeps the operating-cost bridge tied as it is for the year filed at its normal rate", () => {
    const bridge = (ps: RecastPeriod[]) => evaluateReconciliationResiduals({ recastData: ps, config })
      .checks.find((c) => c.key === "operating-cost-bridge" && c.periodEnd === "2025-03-31")!.residual!;
    expect(bridge(periods)).toBeCloseTo(bridge(run([0.335, 0.258, 0.325, 0.325])), 9);
  });

  it("changes nothing in statutory mode", () => {
    const statutory = run(AIRTEL, { ...config, tax_rate_mode: "statutory" }).at(-1)!;
    expect(statutory.is.taxRate).toBe(config.statutory_tax_rate);
    expect(statutory.cu.UnusualTaxBenefit).toBe(0);
  });
});

describe("normalTaxRate", () => {
  const filed = (rate: number | null) => ({ is: { filedTaxRate: rate } }) as unknown as RecastPeriod;

  it("is the median filed rate of the three years before, skipping years with none", () => {
    expect(normalTaxRate([filed(0.5), filed(0.30), filed(null), filed(0.32)], config)).toBeCloseTo(0.31, 10);
    expect(normalTaxRate([filed(0.335), filed(0.258), filed(0.325)], config)).toBeCloseTo(0.325, 10);
  });

  it("is null with no filed rate before", () => {
    expect(normalTaxRate([], config)).toBeNull();
    expect(normalTaxRate([filed(null)], config)).toBeNull();
  });
});
