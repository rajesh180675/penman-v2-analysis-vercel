/**
 * The financial-institution cap names what the valuation rests on. A bank's
 * three models are one algebra (one independent lens); an insurer's embedded
 * value is a second lens beside its book models.
 */
import { describe, expect, it } from "vitest";
import { describeFinancialValuationEvidence, summarizeFinancialValuationEvidence } from "../bankValuation/evidence";
import { buildAnalysisTraceability } from "../analysisTraceability";
import type { BankValuationBundle, BankValuationModelResult } from "../bankValuation/types";
import type { BankPeriodMetrics } from "../bankPipeline";

const computed = (intrinsicValue: number): BankValuationModelResult =>
  ({ status: "computed", intrinsicValue, premiumOverMarket: null, reason: "", diagnostics: {} });
const skipped: BankValuationModelResult = { status: "skipped", intrinsicValue: null, premiumOverMarket: null, reason: "skipped", diagnostics: {} };

// HDFC Bank FY25 after #390-#392, ₹ Cr.
const bank = {
  justifiedPB: computed(668_446),
  equityResidualIncome: computed(550_000),
  sustainableDDM: computed(627_000),
} as unknown as BankValuationBundle;

const insurer = {
  justifiedPB: computed(12_421),
  equityResidualIncome: computed(16_000),
  sustainableDDM: skipped,
  evBased: computed(80_000),
} as unknown as BankValuationBundle;

describe("summarizeFinancialValuationEvidence", () => {
  it("puts a bank's justified P/B, residual income and DDM in one lens", () => {
    const evidence = summarizeFinancialValuationEvidence(bank);
    expect(evidence.groups.map((g) => g.group)).toEqual(["fi-book-residual-income"]);
    expect(evidence.groups[0]!.models.map((m) => m.label)).toEqual(["justified P/B", "equity residual income", "DDM"]);
    expect(evidence.groups[0]!.value).toBe(627_000);
    expect(evidence.maxGapRatio).toBeNull();
    expect(describeFinancialValuationEvidence(evidence)).toMatch(/^One independent lens, book residual income .*one algebra/);
  });

  it("separates an insurer's embedded value from its book models and measures the gap", () => {
    const evidence = summarizeFinancialValuationEvidence(insurer);
    expect(evidence.groups.map((g) => g.label)).toEqual(["book residual income", "embedded value"]);
    // Book lens = median(12,421, 16,000) = 14,210.5; gap to 80,000 over the median of the two lenses.
    expect(evidence.maxGapRatio).toBeCloseTo((80_000 - 14_210.5) / ((80_000 + 14_210.5) / 2), 9);
    expect(describeFinancialValuationEvidence(evidence)).toMatch(/^2 independent lenses: book residual income ₹14,211 Cr vs embedded value ₹80,000 Cr, 140% apart\.$/);
  });

  it("says when nothing computed, and leaves skipped models out", () => {
    const none = summarizeFinancialValuationEvidence({ justifiedPB: skipped, equityResidualIncome: skipped, sustainableDDM: skipped } as unknown as BankValuationBundle);
    expect(none.groups).toEqual([]);
    expect(describeFinancialValuationEvidence(none)).toBe("No financial-institution valuation model computed.");
  });
});

describe("the financial-institution cap names its evidence", () => {
  const metrics = ["2023-03-31", "2024-03-31", "2025-03-31"].map((period_end) =>
    ({ period_end, pat: 60_000, totalEquity: 500_000, roe: 0.16 }) as unknown as BankPeriodMetrics);
  const capDetail = (bankValuation: BankValuationBundle | null | undefined) => {
    const env = buildAnalysisTraceability({
      rawData: metrics.map((m) => ({ company_id: "HDFCBANK", period_end: m.period_end, raw_metric_values: {} })),
      recastData: [],
      bankMetrics: metrics,
      bankSubtype: "bank",
      ...(bankValuation === undefined ? {} : { bankValuation }),
    } as never);
    return env.rigor.checkpoints.find((c) => c.level === "valuation-eligible")!.detail;
  };

  it("lists the lenses that computed", () => {
    expect(capDetail(bank)).toMatch(/One independent lens, book residual income \(justified P\/B ₹6,68,446 Cr/);
  });

  it("says nothing about evidence a caller did not supply", () => {
    const detail = capDetail(undefined);
    expect(detail).toMatch(/^Financial institution/);
    expect(detail).not.toMatch(/lens,|No financial-institution valuation model computed/);
  });
});
