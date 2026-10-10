import { describe, expect, it } from "vitest";
import { buildAnalysisTraceability } from "../analysisTraceability";
import { statusWithinLadder } from "../analysisStatus";
import { reReoiGap } from "../reReoiConsistency";
import { DEFAULT_CONFIG } from "../types";
import { workbookMetadataFromPublicationSnapshot } from "../excelExport";
import { buildAnalysisPublicationSnapshot } from "../../lib/publication/analysisPublicationSnapshot";
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

// Two paradigms in agreement, so the triangulation passes and whatever a test
// varies is the only thing under test.
const AGREEING = [
  { key: "accrual-riv", label: "Accrual RIV/ReOI", perShare: 100 },
  { key: "cash-fcff-dcf", label: "Cash-statement FCFF DCF", perShare: 100 },
];

/** `methods: null` passes no triangulation evidence: no industrial valuation ran. */
function envelope(
  accrualPair?: { re: number | null; reoi: number | null },
  methods: Array<{ key: string; label: string; perShare: number | null }> | null = AGREEING,
) {
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
    ...(methods !== null
      ? { valuationTriangulation: { methods, ...(accrualPair !== undefined ? { accrualPair } : {}) } }
      : {}),
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

describe("valuation-triangulation gate", () => {
  const paradigms = (riv: number, dcf: number) => [
    { key: "accrual-riv", label: "Accrual RIV/ReOI", perShare: riv },
    { key: "cash-fcff-dcf", label: "Cash-statement FCFF DCF", perShare: dcf },
  ];

  it("keeps production-ready when the paradigms agree", () => {
    expect(envelope(undefined, paradigms(100, 105)).rigor.achievedLevels).toContain("production-ready");
  });

  it("keeps production-ready in the warning band, where only the residual score weighs it (Maruti)", () => {
    const env = envelope(undefined, paradigms(100, 120)); // 18% of the 110 median
    expect(env.reconciliation.status).not.toBe("failed");
    expect(env.rigor.achievedLevels).toContain("valuation-eligible");
    expect(env.rigor.achievedLevels).toContain("production-ready");
  });

  it("withholds production-ready above the critical band, not valuation eligibility (Infosys: 32%)", () => {
    // The cash lens grows trailing free cash flow at the accrual forecast's
    // rate, so its gap tracks reinvestment (9 of 9 critical gaps on the
    // library), not the accounts or the accrual model: an uncorroborated value,
    // not an ineligible one.
    const env = envelope(undefined, paradigms(858.45, 621.77));
    expect(env.rigor.achievedLevels).toContain("economically-plausible");
    expect(env.rigor.achievedLevels).toContain("valuation-eligible");
    expect(env.rigor.achievedLevels).not.toContain("production-ready");
    const checkpoint = env.rigor.checkpoints.find((c) => c.level === "production-ready");
    expect(checkpoint?.detail).toMatch(/Cash-statement FCFF DCF.*not corroborated, so the run is not production-ready/);
  });

  it("withholds production-ready when one paradigm values the equity below zero (Reliance)", () => {
    const env = envelope(undefined, paradigms(235.03, -20.64));
    expect(env.rigor.achievedLevels).toContain("valuation-eligible");
    expect(env.rigor.achievedLevels).not.toContain("production-ready");
  });

  it("withholds production-ready when only one paradigm values the equity: absence is not agreement", () => {
    // DMart before #424: its cash DCF was skipped, so the check was never
    // built and the accrual value reached production-ready uncorroborated.
    const env = envelope(undefined, [
      { key: "accrual-riv", label: "Accrual RIV/ReOI", perShare: 368.51 },
      { key: "cash-fcff-dcf", label: "Cash-statement FCFF DCF", perShare: null },
    ]);
    expect(env.reconciliation.checks.some((c) => c.key === "valuation-triangulation")).toBe(false);
    expect(env.rigor.achievedLevels).toContain("valuation-eligible");
    expect(env.rigor.achievedLevels).not.toContain("production-ready");
    const checkpoint = env.rigor.checkpoints.find((c) => c.level === "production-ready");
    expect(checkpoint?.detail).toBe(
      "Only Accrual RIV/ReOI values the equity (₹368.51/share); no independent paradigm corroborates it, so the run is not production-ready.",
    );
  });

  it("withholds production-ready when no paradigm values the equity above zero", () => {
    const env = envelope(undefined, paradigms(-5, -40));
    expect(env.rigor.achievedLevels).not.toContain("production-ready");
    const checkpoint = env.rigor.checkpoints.find((c) => c.level === "production-ready");
    expect(checkpoint?.detail).toMatch(/^No valuation paradigm values the equity above zero/);
  });

  it("is silent without triangulation evidence: no industrial valuation ran (a financial institution)", () => {
    expect(envelope(undefined, null).rigor.achievedLevels).toContain("production-ready");
  });
});

// The status is assessed before the gates above run, so it reads
// production-ready for every run in this file. The shared confidence must not.
describe("the shared confidence follows the ladder", () => {
  it("stays production-ready when the run reaches production-ready", () => {
    const env = envelope();
    expect(env.confidence.status).toBe("production-ready");
    expect(env.confidence.tone).toBe("emerald");
    expect(env.confidence.headline).toBe("Analysis cleared current release checks");
  });

  it("is guarded, naming why, when a valuation-level gate withholds production-ready (DMart)", () => {
    const env = envelope(undefined, [
      { key: "accrual-riv", label: "Accrual RIV/ReOI", perShare: 368.51 },
      { key: "cash-fcff-dcf", label: "Cash-statement FCFF DCF", perShare: -148.13 },
    ]);
    expect(env.rigor.currentLevel).toBe("valuation-eligible");
    expect(env.confidence.status).toBe("guarded");
    expect(env.confidence.tone).toBe("amber");
    const checkpoint = env.rigor.checkpoints.find((c) => c.level === "production-ready")!;
    expect(env.confidence.headline).toBe(`Production-ready withheld: ${checkpoint.detail}`);
  });

  it("names the lowest rung withheld when the valuation itself is not eligible (TCS: 40%)", () => {
    const env = envelope({ re: 2080.15, reoi: 1383.38 });
    expect(env.rigor.currentLevel).toBe("economically-plausible");
    expect(env.confidence.status).toBe("guarded");
    expect(env.confidence.headline).toMatch(/^Valuation eligible withheld: RE ₹2080\.15 and ReOI ₹1383\.38/);
  });

  it("and so does the readiness every publication prints as the valuation's status", () => {
    // A clean anchor with ratio context, so the anchor alone reads production-ready.
    const data = ["2024-03-31", "2025-03-31"].map((end) => ({ ...recastPeriod(end), ratios: {} }) as RecastPeriod);
    const publish = (sharedTraceability: ReturnType<typeof envelope>) =>
      buildAnalysisPublicationSnapshot({ data, config: DEFAULT_CONFIG, sharedTraceability, analysisStatus: productionReadyStatus });

    const ready = publish(envelope());
    expect(ready.valuationReadiness.status).toBe("production-ready");

    const held = publish(envelope(undefined, [
      { key: "accrual-riv", label: "Accrual RIV/ReOI", perShare: 368.51 },
      { key: "cash-fcff-dcf", label: "Cash-statement FCFF DCF", perShare: -148.13 },
    ]));
    expect(held.valuationReadiness.status).toBe("warning");
    expect(held.valuationReadiness.reasons[0]).toBe(held.traceability.confidence.headline);
    const cover = workbookMetadataFromPublicationSnapshot(held);
    expect(cover.valuationStatus).toBe("warning");
    expect(cover.valuationReasons?.[0]).toMatch(/^Production-ready withheld: /);
  });
});

// The badge surfaces display the status the gates above were computed from.
describe("the displayed status follows the ladder", () => {
  const DMART = [
    { key: "accrual-riv", label: "Accrual RIV/ReOI", perShare: 368.51 },
    { key: "cash-fcff-dcf", label: "Cash-statement FCFF DCF", perShare: -148.13 },
  ];

  it("is the status itself when the run reaches production-ready", () => {
    expect(statusWithinLadder(productionReadyStatus, envelope())).toBe(productionReadyStatus);
  });

  it("is guarded at the rung the run reached, with the withheld reason and a capped valuation status (DMart)", () => {
    const env = envelope(undefined, DMART);
    const shown = statusWithinLadder(productionReadyStatus, env);
    expect(shown.status).toBe("guarded");
    expect(shown.label).toBe("Guarded");
    expect(shown.tone).toBe("amber");
    expect(shown.headline).toBe("Held at Valuation eligible");
    expect(shown.summary).toBe(env.confidence.headline);
    expect(shown.summary).toMatch(/^Production-ready withheld: /);
    expect(shown.valuationStatus).toBe("warning");
    // The counts are the status's own.
    expect(shown.blockingCount).toBe(productionReadyStatus.blockingCount);
    // The rung's own sentence says what the readiness measured, not "Valuation
    // status is production-ready".
    expect(env.rigor.summary).toBe("The terminal anchor is clean, so the run is eligible for valuation use.");
  });

  it("caps the valuation status alone when the status already says guarded (Power Grid)", () => {
    const guarded = { ...productionReadyStatus, status: "guarded" as const, label: "Guarded", tone: "amber" as const, headline: "Review diagnostics before relying on output" };
    const shown = statusWithinLadder(guarded, envelope(undefined, DMART));
    expect(shown.status).toBe("guarded");
    expect(shown.headline).toBe("Review diagnostics before relying on output");
    expect(shown.valuationStatus).toBe("warning");
  });

  it("is blocked when the envelope is, with no valuation status above guarded below valuation-eligible", () => {
    const env = envelope({ re: 2080.15, reoi: 1383.38 });
    const blockedEnvelope = { ...env, confidence: { ...env.confidence, status: "blocked" as const, tone: "red" as const, headline: "Analysis run blocked at model-execution." } };
    const shown = statusWithinLadder(productionReadyStatus, blockedEnvelope);
    expect(shown.status).toBe("blocked");
    expect(shown.label).toBe("Blocked");
    expect(shown.headline).toBe("Held at Economically plausible");
    expect(shown.valuationStatus).toBe("guarded");
  });

  it("is the status itself without an envelope", () => {
    expect(statusWithinLadder(productionReadyStatus, null)).toBe(productionReadyStatus);
  });
});
