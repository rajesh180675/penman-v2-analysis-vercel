import { describe, expect, it } from "vitest";
import { buildAnalysisTraceability } from "../analysisTraceability";
import { buildEarningsQualityCard } from "../earningsQuality";
import { buildEarningsQualitySummary } from "../earningsQualitySummary";
import type { RecastPeriod } from "../types";

/* ── the card projection ──────────────────────────────────────────────────── */

/** Every dimension measured and bad: the case the gate exists for. */
function unreliableCard() {
  return buildEarningsQualityCard(
    { n: 5, rSquared: 0.15, residualStdDev: 50, avgAbsAq: 0.8, label: "Very low" },
    { abnormalCFO: -100, abnormalDiscExp: -50, abnormalProdCost: 80, remScore: 200, remFlag: true, label: "REM detected" },
    0.15,
    0.30,
    0.15,
  );
}

/** Measured and clean apart from soft cash backing. */
function watchCard() {
  return buildEarningsQualityCard(
    { n: 8, rSquared: 0.85, residualStdDev: 5, avgAbsAq: 0.1, label: "High" },
    { abnormalCFO: 0, abnormalDiscExp: 0, abnormalProdCost: 0, remScore: 0, remFlag: false, label: "No REM" },
    0.01,
    0.60,
    0.02,
  );
}

function cleanCard() {
  return buildEarningsQualityCard(
    { n: 10, rSquared: 0.85, residualStdDev: 5, avgAbsAq: 0.1, label: "High" },
    { abnormalCFO: 0, abnormalDiscExp: 0, abnormalProdCost: 0, remScore: 0, remFlag: false, label: "No REM" },
    0.01,
    0.95,
    0.01,
  );
}

describe("buildEarningsQualitySummary", () => {
  it("reports absent — not a clean bill — when no valuation ran", () => {
    const summary = buildEarningsQualitySummary(null);

    expect(summary.status).toBe("absent");
    expect(summary.status).not.toBe("confirmed");
    expect(summary.totalScore).toBeNull();
    expect(summary.checks).toEqual([]);
  });

  it("withholds the composite when every dimension is a placeholder", () => {
    // The defect this module exists for: an all-null card still returns 51/100
    // and calls itself "moderate". 51 is the sum of neutral placeholders, not a
    // measurement, so the envelope must not publish it as a score.
    const card = buildEarningsQualityCard(null, null, null, null, null);
    expect(card.totalScore).toBeGreaterThan(0);

    const summary = buildEarningsQualitySummary(card);

    expect(summary.measuredCount).toBe(0);
    expect(summary.status).toBe("absent");
    expect(summary.totalScore).toBeNull();
    expect(summary.checks.every((check) => !check.measured)).toBe(true);
  });

  it("marks only the dimensions that had inputs as measured", () => {
    const summary = buildEarningsQualitySummary(buildEarningsQualityCard(null, null, 0.01, 0.95, null));

    expect(summary.measuredCount).toBe(2);
    const measured = summary.checks.filter((check) => check.measured).map((check) => check.key).sort();
    expect(measured).toEqual(["completeness", "realization"]);
    expect(summary.totalScore).not.toBeNull();
  });

  it("reports unreliable when the composite sits in the card's own unreliable band", () => {
    const summary = buildEarningsQualitySummary(unreliableCard());

    expect(summary.status).toBe("unreliable");
    expect(summary.totalScore).toBeLessThan(40);
    expect(summary.measuredCount).toBe(4);
    expect(summary.flaggedDimensions.length).toBeGreaterThanOrEqual(3);
  });

  it("reports watch — not unreliable — for a single soft dimension", () => {
    const summary = buildEarningsQualitySummary(watchCard());

    expect(summary.status).toBe("watch");
    expect(summary.flaggedDimensions).toEqual(["realization"]);
  });

  it("reports confirmed when every measured dimension is clean", () => {
    const summary = buildEarningsQualitySummary(cleanCard());

    expect(summary.status).toBe("confirmed");
    expect(summary.flaggedDimensions).toEqual([]);
    expect(summary.remFlag).toBe(false);
  });

  it("treats real earnings management as reportable, not blocking", () => {
    // The Roychowdhury proxy here is a sales-divergence heuristic with an
    // uncalibrated 10%-of-sales threshold. It belongs in a reviewer's eyeline;
    // failing a run closed on it would be a false-precision claim.
    const summary = buildEarningsQualitySummary(buildEarningsQualityCard(
      { n: 8, rSquared: 0.85, residualStdDev: 5, avgAbsAq: 0.1, label: "High" },
      { abnormalCFO: -10, abnormalDiscExp: -5, abnormalProdCost: 5, remScore: 20, remFlag: true, label: "REM detected" },
      0.01,
      0.95,
      0.01,
    ));

    expect(summary.remFlag).toBe(true);
    expect(summary.status).toBe("watch");
  });
});

/* ── the gate ─────────────────────────────────────────────────────────────── */

function recastPeriod(period_end: string): RecastPeriod {
  return {
    period_end,
    bs: { TA: 1000, CSE: 600, MI: 0, FA: 200, FO: 150, OA: 800, OL: 250, NOA: 600, NFO: 0 },
    is: {
      Sales: 900, TaxExpense: 30, taxRate: 0.25, PAT: 90, OCI: 0, TCI: 90, TCI_NCI: 0, CNI: 90,
      FinanceCost: 12, FinanceIncome: 2, FinanceIncomeRung: 1, PreferredDividend: 0,
      NFE: 10, OI: 100, OtherItems: 0, MII: 0, COGS: 600,
    },
    cu: { UOI: 0, CoreOI: 100, UFE: 0, CoreNFE: 10, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: {
      CFO: 120, Capex: 40, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 0, DividendReceived: 0, FCF_accounting: 60, FCF_cash: 80,
      d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 140,
    },
    shareCountInput: {
      endPeriodShares: 60,
      endPeriodSharesSource: "Number of Equity Shares - Subscribed Fully Paid up",
      weightedAverageBasicShares: 60,
      weightedAverageBasicSource: "Weighted Average Number of Shares in Issue - Basic",
      weightedAverageDilutedShares: 60,
      weightedAverageDilutedSource: "Weighted Average Number of Shares in Issue - Diluted",
      faceValue: 10,
      shareCapital: 600,
    },
    trace: {},
  } as RecastPeriod;
}

const productionReadyStatus = {
  status: "production-ready" as const,
  label: "Production-ready",
  headline: "Analysis cleared current release checks",
  summary: "No blocking scope or valuation issues were detected for the loaded dataset.",
  reasons: [],
  tone: "emerald" as const,
  qualityTier: "Tier 1" as const,
  valuationStatus: "production-ready" as const,
  scopeBlocked: false,
  valuationBlocked: false,
  blockingCount: 0,
  diagnosticCount: 0,
  optionalCount: 0,
};

function envelope(earningsQuality?: ReturnType<typeof buildEarningsQualitySummary> | null) {
  // Real Capitaline labels: the concept-identity gate resolves core concepts by
  // label, so synthetic `metric_0__BalanceSheet` keys block valuation-eligible
  // before this gate is ever consulted.
  const rawData = Array.from({ length: 2 }, (_, i) => ({
    company_id: "QOECO",
    period_end: `202${4 + i}-03-31`,
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000 + i,
      "Total Equity__BalanceSheet": 600 + i,
      "Property, Plant and Equipment__BalanceSheet": 320 + i,
      "Revenue From Operations(Net)__ProfitLoss": 900 + i,
      "Profit Before Tax__ProfitLoss": 120 + i,
      "Tax Expenses__ProfitLoss": 30,
      "Profit After Tax__ProfitLoss": 90 + i,
      "Net Cash From Operating Activities__CashFlow": 110 + i,
      "Purchase of Fixed Assets__CashFlow": 45,
    },
  }));
  return buildAnalysisTraceability({
    sourceMode: "manual",
    periodCount: rawData.length,
    rawMetricKeyCount: 20,
    rawData,
    recastData: rawData.map((period) => recastPeriod(period.period_end)),
    analysisStatus: productionReadyStatus,
    ...(earningsQuality !== undefined ? { earningsQuality } : {}),
  });
}

describe("earnings-quality rigor gate", () => {
  it("the baseline fixture reaches production-ready", () => {
    // Guards every assertion below from passing vacuously.
    const env = envelope();

    expect(env.rigor.achievedLevels).toContain("production-ready");
    expect(env.earningsQuality).toBeNull();
  });

  it("denies production-ready when measured earnings quality is unreliable", () => {
    const env = envelope(buildEarningsQualitySummary(unreliableCard()));

    expect(env.rigor.achievedLevels).not.toContain("production-ready");
    const checkpoint = env.rigor.checkpoints.find((item) => item.level === "production-ready");
    expect(checkpoint?.achieved).toBe(false);
    expect(checkpoint?.detail).toMatch(/earnings quality/i);
  });

  it("leaves valuation-eligible intact — poor earnings quality is a caveat, not a parse failure", () => {
    const env = envelope(buildEarningsQualitySummary(unreliableCard()));

    expect(env.rigor.achievedLevels).toContain("valuation-eligible");
    expect(env.rigor.currentLevel).toBe("valuation-eligible");
  });

  it("does not fire on a mostly-placeholder composite", () => {
    // One measured dimension at its worst still scores 39/100 — under the band,
    // but 36 of those points are placeholders. A release claim must not turn on
    // filler, so this reports watch and passes.
    const summary = buildEarningsQualitySummary(buildEarningsQualityCard(null, null, 0.15, null, null));
    expect(summary.totalScore).toBeLessThan(40);
    expect(summary.measuredCount).toBe(1);

    const env = envelope(summary);

    expect(summary.status).toBe("watch");
    expect(env.rigor.achievedLevels).toContain("production-ready");
  });

  it("does not fire on a watch-level run", () => {
    const env = envelope(buildEarningsQualitySummary(watchCard()));

    expect(env.earningsQuality?.status).toBe("watch");
    expect(env.rigor.achievedLevels).toContain("production-ready");
  });

  it("does not fire when no earnings quality was reported", () => {
    const env = envelope(buildEarningsQualitySummary(null));

    expect(env.earningsQuality?.status).toBe("absent");
    expect(env.rigor.achievedLevels).toContain("production-ready");
  });
});
