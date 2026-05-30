/**
 * Tests for Scope-Aware Data Loader
 */
import { describe, it, expect } from "vitest";
import {
  processScopeAwareData,
  validateSOTPAgainstSubsidiaryContribution,
} from "../scopeAwareLoader";
import { DEFAULT_CONFIG } from "../types";
import { PercentFraction } from "../types/units";
import type { RawPeriodData } from "../types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Build minimal RawPeriodData that the pipeline can process.
 * Uses enough keys to produce non-null CoreOI, PAT, CSE, NOA.
 */
function makeRawPeriod(overrides: {
  period_end: string;
  company_id: string;
  sales: number;
  pat: number;
  cse: number;
  noa: number;
}): RawPeriodData {
  const { period_end, company_id, sales, pat, cse, noa } = overrides;
  return {
    company_id,
    period_end,
    raw_metric_values: {
      // Income statement
      "Revenue from Operations__ProfitLoss": sales,
      "Profit After Tax__ProfitLoss": pat,
      "Profit Before Tax__ProfitLoss": pat * 1.33,
      "Tax Expense__ProfitLoss": pat * 0.33,
      "Employee Benefits / Salaries & other Staff Cost__ProfitLoss": sales * 0.15,
      "Depreciation and Amortization__ProfitLoss": sales * 0.05,
      "Finance Costs__ProfitLoss": sales * 0.02,
      "Other Income__ProfitLoss": sales * 0.01,
      "Total Expenses__ProfitLoss": sales - pat * 1.33,

      // Balance sheet
      "Total Assets__BalanceSheet": noa + 200,
      "Total Stockholders' Equity__BalanceSheet": cse,
      "Total Equity__BalanceSheet": cse,
      "Net Property, plant and equipment__BalanceSheet": noa * 0.4,
      "Total Inventory__BalanceSheet": noa * 0.1,
      "Trade Receivables__BalanceSheet": noa * 0.1,
      "Trade Payables__BalanceSheet": noa * 0.05,
      "Total Current Assets__BalanceSheet": noa * 0.3,
      "Total Current Liabilities__BalanceSheet": noa * 0.1,
      "Deferred Tax Liabilities (Net)__BalanceSheet": 10,
      "Minority Interest__BalanceSheet": 0,

      // Cash flow
      "Net Cash from Operating Activities__CashFlow": pat * 1.1,
      "Capital Expenditure__CashFlow": sales * 0.04,
      "Dividend Paid__CashFlow": pat * 0.3,
    },
  };
}

const CONS_PERIODS: RawPeriodData[] = [
  makeRawPeriod({ period_end: "2021-03-31", company_id: "ITC", sales: 15000, pat: 2000, cse: 30000, noa: 25000 }),
  makeRawPeriod({ period_end: "2022-03-31", company_id: "ITC", sales: 16500, pat: 2200, cse: 32000, noa: 27000 }),
  makeRawPeriod({ period_end: "2023-03-31", company_id: "ITC", sales: 18000, pat: 2400, cse: 34000, noa: 29000 }),
  makeRawPeriod({ period_end: "2024-03-31", company_id: "ITC", sales: 19500, pat: 2600, cse: 36000, noa: 31000 }),
  makeRawPeriod({ period_end: "2025-03-31", company_id: "ITC", sales: 21000, pat: 2800, cse: 38000, noa: 33000 }),
];

// Standalone: ~80% of consolidated (parent entity only)
const STAN_PERIODS: RawPeriodData[] = [
  makeRawPeriod({ period_end: "2021-03-31", company_id: "ITC", sales: 12000, pat: 1600, cse: 24000, noa: 20000 }),
  makeRawPeriod({ period_end: "2022-03-31", company_id: "ITC", sales: 13200, pat: 1760, cse: 25600, noa: 21600 }),
  makeRawPeriod({ period_end: "2023-03-31", company_id: "ITC", sales: 14400, pat: 1920, cse: 27200, noa: 23200 }),
  makeRawPeriod({ period_end: "2024-03-31", company_id: "ITC", sales: 15600, pat: 2080, cse: 28800, noa: 24800 }),
  makeRawPeriod({ period_end: "2025-03-31", company_id: "ITC", sales: 16800, pat: 2240, cse: 30400, noa: 26400 }),
];

const CONFIG = { ...DEFAULT_CONFIG, ke: PercentFraction(0.12) };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("processScopeAwareData", () => {
  it("returns a result with consolidated pipeline output", () => {
    const result = processScopeAwareData(CONS_PERIODS, STAN_PERIODS, CONFIG);
    expect(result.consolidated).toBeDefined();
    expect(result.consolidated.periods.length).toBeGreaterThan(0);
  });

  it("returns standalone pipeline output when provided", () => {
    const result = processScopeAwareData(CONS_PERIODS, STAN_PERIODS, CONFIG);
    expect(result.standalone).not.toBeNull();
    expect(result.standalone!.periods.length).toBeGreaterThan(0);
  });

  it("scopeAwareAnalysisAvailable is true when both datasets provided", () => {
    const result = processScopeAwareData(CONS_PERIODS, STAN_PERIODS, CONFIG);
    expect(result.scopeAwareAnalysisAvailable).toBe(true);
  });

  it("scopeAwareAnalysisAvailable is false when standalone is null", () => {
    const result = processScopeAwareData(CONS_PERIODS, null, CONFIG);
    expect(result.scopeAwareAnalysisAvailable).toBe(false);
    expect(result.standalone).toBeNull();
  });

  it("aligned periods match both datasets", () => {
    const result = processScopeAwareData(CONS_PERIODS, STAN_PERIODS, CONFIG);
    expect(result.subsidiaryContribution.length).toBeGreaterThan(0);
    for (const c of result.subsidiaryContribution) {
      expect(c.bothAvailable).toBe(true);
    }
  });

  it("consolidatedOnlyPeriods is empty when all periods align", () => {
    const result = processScopeAwareData(CONS_PERIODS, STAN_PERIODS, CONFIG);
    expect(result.consolidatedOnlyPeriods).toHaveLength(0);
  });

  it("standaloneOnlyPeriods is empty when all periods align", () => {
    const result = processScopeAwareData(CONS_PERIODS, STAN_PERIODS, CONFIG);
    expect(result.standaloneOnlyPeriods).toHaveLength(0);
  });

  it("detects consolidatedOnlyPeriods when standalone has fewer periods", () => {
    const result = processScopeAwareData(CONS_PERIODS, STAN_PERIODS.slice(0, 3), CONFIG);
    expect(result.consolidatedOnlyPeriods.length).toBeGreaterThan(0);
  });

  it("subsidiary contribution is positive (consolidated > standalone)", () => {
    const result = processScopeAwareData(CONS_PERIODS, STAN_PERIODS, CONFIG);
    for (const c of result.subsidiaryContribution) {
      if (c.patContribution != null) {
        expect(c.patContribution).toBeGreaterThan(0);
      }
    }
  });

  it("subsidiary PAT contribution % is ~20% (cons=2000, stan=1600 → 20% gap)", () => {
    const result = processScopeAwareData(CONS_PERIODS, STAN_PERIODS, CONFIG);
    const latest = result.summary.latest;
    if (latest?.patContributionPct != null) {
      // (2800 - 2240) / 2800 = 560/2800 = 0.20
      expect(latest.patContributionPct).toBeCloseTo(0.20, 1);
    }
  });

  it("summary.alignedPeriods matches number of contribution entries", () => {
    const result = processScopeAwareData(CONS_PERIODS, STAN_PERIODS, CONFIG);
    expect(result.summary.alignedPeriods).toBe(result.subsidiaryContribution.length);
  });

  it("medianPatContributionPct is computed", () => {
    const result = processScopeAwareData(CONS_PERIODS, STAN_PERIODS, CONFIG);
    expect(result.summary.medianPatContributionPct).not.toBeNull();
    expect(result.summary.medianPatContributionPct).toBeGreaterThan(0);
  });

  it("patContributionTrend is stable for constant 20% gap", () => {
    const result = processScopeAwareData(CONS_PERIODS, STAN_PERIODS, CONFIG);
    expect(result.summary.patContributionTrend).toBe("stable");
  });
});

describe("validateSOTPAgainstSubsidiaryContribution", () => {
  const summary = {
    alignedPeriods: 5,
    medianPatContributionPct: 0.20,
    medianSalesContributionPct: 0.20,
    medianCoreOIContributionPct: 0.20,
    medianNOAContributionPct: 0.20,
    latest: null,
    patContributionTrend: "stable" as const,
  };

  it("consistent when SOTP subsidiary % is close to observed", () => {
    const result = validateSOTPAgainstSubsidiaryContribution(0.22, summary);
    expect(result.consistent).toBe(true);
    expect(result.gap).toBeCloseTo(0.02, 2);
  });

  it("inconsistent when SOTP subsidiary % diverges by >20pp", () => {
    const result = validateSOTPAgainstSubsidiaryContribution(0.50, summary);
    expect(result.consistent).toBe(false);
    expect(result.gap).toBeCloseTo(0.30, 2);
  });

  it("returns consistent=true when data is insufficient", () => {
    const result = validateSOTPAgainstSubsidiaryContribution(null, summary);
    expect(result.consistent).toBe(true);
    expect(result.gap).toBeNull();
  });

  it("note contains percentage values", () => {
    const result = validateSOTPAgainstSubsidiaryContribution(0.22, summary);
    expect(result.note).toContain("%");
  });
});
