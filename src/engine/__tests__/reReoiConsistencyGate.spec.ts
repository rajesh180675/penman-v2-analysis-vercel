import { describe, expect, it } from "vitest";
import { buildAnalysisTraceability } from "../analysisTraceability";
import { reReoiGap } from "../reReoiConsistency";
import type { RecastPeriod } from "../types";

// Same fixture as the earnings-quality gate spec: real Capitaline labels, so
// the concept-identity gate resolves and the baseline reaches production-ready.
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

function envelope(accrualPair?: { re: number | null; reoi: number | null }) {
  const rawData = Array.from({ length: 2 }, (_, i) => ({
    company_id: "REREOI",
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
    // No triangulation methods, so the structural triangulation residual stays
    // out and only the RE/ReOI pair is under test.
    ...(accrualPair !== undefined ? { valuationTriangulation: { methods: [], accrualPair } } : {}),
  });
}

describe("RE/ReOI consistency gate", () => {
  it("the baseline fixture reaches production-ready", () => {
    // Guards every assertion below from passing vacuously.
    expect(envelope().rigor.achievedLevels).toContain("production-ready");
  });

  it("measures the gap on the mean of the two values, as PVRE does", () => {
    expect(reReoiGap(110, 90)).toBeCloseTo(0.2, 10);
    expect(reReoiGap(0, 0)).toBeNull();
  });

  it("keeps production-ready when the two valuations of one forecast agree (Dabur: 9.6%)", () => {
    const env = envelope({ re: 113.52, reoi: 103.07 });
    expect(env.rigor.achievedLevels).toContain("production-ready");
  });

  it("denies production-ready but keeps valuation-eligible between the guard and block levels", () => {
    const env = envelope({ re: 110, reoi: 90 }); // 20%
    expect(env.rigor.achievedLevels).toContain("valuation-eligible");
    expect(env.rigor.achievedLevels).not.toContain("production-ready");
    const checkpoint = env.rigor.checkpoints.find((c) => c.level === "production-ready");
    expect(checkpoint?.detail).toMatch(/differ by 20\.0%/);
  });

  it("denies valuation-eligible above the block level (TCS: 40%)", () => {
    const env = envelope({ re: 2080.15, reoi: 1383.38 });
    expect(env.rigor.achievedLevels).toContain("economically-plausible");
    expect(env.rigor.achievedLevels).not.toContain("valuation-eligible");
    expect(env.rigor.achievedLevels).not.toContain("production-ready");
    const checkpoint = env.rigor.checkpoints.find((c) => c.level === "valuation-eligible");
    expect(checkpoint?.detail).toMatch(/not valuation-eligible/);
  });

  it("is silent when either value is missing — no pair is not evidence of disagreement", () => {
    expect(envelope({ re: 2080, reoi: null }).rigor.achievedLevels).toContain("production-ready");
  });
});
