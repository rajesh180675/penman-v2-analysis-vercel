/**
 * The financial-institution cap names what the valuation rests on. A bank's
 * three models are one algebra (one independent lens); an insurer's embedded
 * value is a second lens beside its book models.
 */
import { describe, expect, it, vi } from "vitest";
import { describeFinancialValuationEvidence, summarizeFinancialValuationEvidence } from "../bankValuation/evidence";
import { buildAnalysisTraceability } from "../analysisTraceability";
import type { BankValuationBundle, BankValuationModelResult } from "../bankValuation/types";
import type { BankPeriodMetrics } from "../bankPipeline";

const computed = (intrinsicValue: number, diagnostics: Record<string, number | null> = {}): BankValuationModelResult =>
  ({ status: "computed", intrinsicValue, premiumOverMarket: null, reason: "", diagnostics });
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

  it("counts an insurer's embedded value as its one lens: its book models are sanity brackets", () => {
    // HDFC Life FY25: book models ₹13-16k Cr beside embedded value + VNB ₹1.03 L Cr.
    // The catalog applies the book models to banks and NBFCs only.
    const evidence = summarizeFinancialValuationEvidence(insurer, "insurance");
    expect(evidence.groups.map((g) => g.label)).toEqual(["embedded value"]);
    expect(describeFinancialValuationEvidence(evidence)).toBe("One independent lens, embedded value (embedded value + VNB ₹80,000 Cr), so nothing independent cross-checks it.");
  });

  it("separates an NBFC's P/AUM on a sourced multiple from its book models and measures the gap", () => {
    // Muthoot FY25 with its AUM sidecar, were the P/AUM multiple sourced.
    const nbfc = { justifiedPB: computed(52_674), equityResidualIncome: computed(34_109), sustainableDDM: computed(51_399), roaLeverageRI: computed(35_990), pAum: computed(48_892, { multipleSourced: 1 }) } as unknown as BankValuationBundle;
    const evidence = summarizeFinancialValuationEvidence(nbfc, "nbfc");
    expect(evidence.groups.map((g) => g.label)).toEqual(["book residual income", "asset multiple"]);
    // Book lens = median(52,674, 34,109, 51,399, 35,990) = 43,694.5.
    expect(evidence.maxGapRatio).toBeCloseTo((48_892 - 43_694.5) / ((48_892 + 43_694.5) / 2), 9);
    expect(describeFinancialValuationEvidence(evidence)).toMatch(/^2 independent lenses: book residual income ₹43,695 Cr vs asset multiple ₹48,892 Cr, 11% apart\.$/);
  });

  it("shows a P/AUM on an assumed multiple but does not count it as a lens", () => {
    // Muthoot FY25 as the engine values it: P/AUM applies the 12× P/E constant.
    const nbfc = { justifiedPB: computed(52_674), equityResidualIncome: computed(34_109), sustainableDDM: computed(51_399), roaLeverageRI: computed(35_990), pAum: computed(48_892, { multipleSourced: 0, peMultiple: 12 }) } as unknown as BankValuationBundle;
    const evidence = summarizeFinancialValuationEvidence(nbfc, "nbfc");
    expect(evidence.groups.map((g) => g.label)).toEqual(["book residual income"]);
    expect(evidence.maxGapRatio).toBeNull();
    expect(evidence.assumedMultipleLenses).toEqual([{ label: "P/AUM", value: 48_892, multiple: 12 }]);
    expect(describeFinancialValuationEvidence(evidence)).toMatch(/nothing independent cross-checks it\. P\/AUM ₹48,892 Cr applies an assumed 12× multiple nothing sources, so it is shown, not counted\.$/);
  });

  it("treats a P/AUM with no sourcing flag as assumed", () => {
    const nbfc = { justifiedPB: computed(40_000), pAum: computed(44_000) } as unknown as BankValuationBundle;
    const evidence = summarizeFinancialValuationEvidence(nbfc, "nbfc");
    expect(evidence.groups).toHaveLength(1);
    expect(describeFinancialValuationEvidence(evidence)).toMatch(/P\/AUM ₹44,000 Cr applies an assumed multiple nothing sources/);
  });

  it("keeps a bank's book models for a generic financial", () => {
    expect(summarizeFinancialValuationEvidence(bank, "generic-financial").groups.map((g) => g.group)).toEqual(["fi-book-residual-income"]);
  });

  it("says when nothing computed, and leaves skipped models out", () => {
    const none = summarizeFinancialValuationEvidence({ justifiedPB: skipped, equityResidualIncome: skipped, sustainableDDM: skipped } as unknown as BankValuationBundle);
    expect(none.groups).toEqual([]);
    expect(describeFinancialValuationEvidence(none)).toBe("No financial-institution valuation model computed.");
  });
});

describe("a financial's valuation rung where no readiness was assessed", () => {
  const metrics = ["2023-03-31", "2024-03-31", "2025-03-31"].map((period_end) =>
    ({ period_end, pat: 60_000, totalEquity: 500_000, roe: 0.16 }) as unknown as BankPeriodMetrics);
  const rungDetail = (bankValuation: BankValuationBundle | null | undefined) => {
    vi.stubEnv("VITE_RIGOR_CONCEPT_IDENTITY_BLOCK", "false");
    try {
      const env = buildAnalysisTraceability({
        rawData: metrics.map((m) => ({ company_id: "HDFCBANK", period_end: m.period_end, raw_metric_values: {} })),
        recastData: [],
        bankMetrics: metrics,
        bankSubtype: "bank",
        ...(bankValuation === undefined ? {} : { bankValuation }),
      } as never);
      return env.rigor.checkpoints.find((c) => c.level === "valuation-eligible")!.detail;
    } finally {
      vi.unstubAllEnvs();
    }
  };

  it("says so, and lists the lenses that computed", () => {
    expect(rungDetail(bank)).toMatch(/^Financial institution — Financial-institution valuation readiness was not assessed for this run\. One independent lens, book residual income \(justified P\/B ₹6,68,446 Cr/);
  });

  it("says nothing about evidence a caller did not supply", () => {
    expect(rungDetail(undefined)).toBe("Financial institution — Financial-institution valuation readiness was not assessed for this run.");
  });
});
