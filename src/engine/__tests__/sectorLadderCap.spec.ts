/* ================================================================
   Phase 0 — sector fail-safe: rigor-ladder cap for detected-but-unmodelled
   industrial subsectors (telecom/utility) (#92).

   A telecom/utility company runs the full industrial recast and produces
   sector-correct ratios, but the engine has NO sector-native valuation
   model, so its industrial Penman-Nissim intrinsic value must NOT be
   blessed. The ladder is capped at economically-plausible: valuation-
   eligible and production-ready are denied even on otherwise-clean inputs.

   The scope classification is produced by the REAL assessAnalysisScope over
   a telecom/utility-shaped fixture (not hand-injected), so the cap is
   exercised end-to-end. The negative control uses identical clean inputs
   with a supported-industrial scope to prove the cap is scoped only to the
   two new classifications.
================================================================ */

import { describe, expect, it } from "vitest";
import { buildAnalysisTraceability } from "../analysisTraceability";
import { assessAnalysisScope } from "../scopePolicy";
import { getAnalysisPolicyVersions } from "../policyVersions";
import { AnalysisStatusSummary } from "../analysisStatus";
import { QualityGateReport } from "../mappingAudit";
import { DEFAULT_CONFIG, RawPeriodData, RecastPeriod } from "../types";

function mkBalancedPeriod(period_end: string): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000, CSE: 600, MI: 0, FA: 150, FO: 150, OA: 850, OL: 250,
      OL_TradePayables: 80, OL_OtherCurrentLiabilities: 50, OL_ProvisionsCurrent: 10,
      OL_ProvisionsLongTerm: 10, OL_CurrentTaxLiabilities: 10, OL_NonCurrentTaxLiabilities: 10,
      OL_DeferredTaxLiabilitiesNet: 5, OL_OtherNonCurrentLiabilities: 75,
      NOA: 600, NFO: 0, DTL: 5, PensionObl: 0, OL_ex_DTL: 245, Goodwill: 0,
      CurrentAssets: 400, CurrentLiabilities: 220, Inventory: 90, TradeReceivables: 110,
      TradePayables: 80, PPE: 320, LIFO_reserve: 0, separationScore: 90,
      OA_PPE: 320, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0, OA_Inventory: 90,
      OA_TradeReceivables: 110, OA_DTA: 0, OA_CWIP: 0, OA_Other: 330,
    },
    is: {
      Sales: 900, TaxExpense: 30, taxRate: 0.25, PAT: 90, OCI: 0, TCI: 90, TCI_NCI: 0,
      CNI: 90, FinanceCost: 12, FinanceIncome: 2, FinanceIncomeRung: 1, PreferredDividend: 0,
      NFE: 10, OI: 100, OtherItems: 0, OI_from_sales: 100, MII: 0, COGS: 600,
    },
    cu: { UOI: 0, CoreOI: 100, UFE: 0, CoreNFE: 10, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: {
      CFO: 120, Capex: 40, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 0, DividendReceived: 0, FCF_accounting: 60, FCF_cash: 80,
      d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 140,
    },
  };
}

const RAW: RawPeriodData[] = [
  {
    company_id: "TEST",
    period_end: "2025-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000,
      "Total Equity__BalanceSheet": 600,
      "Revenue From Operations(Net)__ProfitLoss": 900,
      "Profit After Tax__ProfitLoss": 90,
    },
  },
];

/** A clean status that would otherwise reach production-ready / valuation-eligible. */
const CLEAN_STATUS: AnalysisStatusSummary = {
  status: "production-ready",
  label: "Production-ready",
  headline: "All checks cleared.",
  summary: "Clean.",
  reasons: [],
  tone: "emerald",
  qualityTier: "Tier 1",
  valuationStatus: "production-ready",
  scopeBlocked: false,
  valuationBlocked: false,
  blockingCount: 0,
  diagnosticCount: 0,
  optionalCount: 0,
};

/** Minimal clean quality gate carrying a real scopeAssessment. */
function gateWithScope(scope: QualityGateReport["scopeAssessment"]): QualityGateReport {
  return {
    tier: "Tier 1",
    valuationBlocked: false,
    missingMinimum: [],
    missingCore: [],
    blockingReasons: [],
    policyVersion: getAnalysisPolicyVersions().mappingPolicyVersion,
    coverageSummary: {
      policyVersion: getAnalysisPolicyVersions().mappingPolicyVersion,
      issues: [],
      unresolvedBySeverity: { critical: [], warning: [], info: [] },
      unresolvedByTier: { "Tier A": [], "Tier B": [], "Tier C": [], "Tier D": [] },
      totalsByTier: {
        "Tier A": { total: 0, resolved: 0, unresolved: 0 },
        "Tier B": { total: 0, resolved: 0, unresolved: 0 },
        "Tier C": { total: 0, resolved: 0, unresolved: 0 },
        "Tier D": { total: 0, resolved: 0, unresolved: 0 },
      },
    },
    valuationCriticalGaps: [],
    ratioCriticalGaps: [],
    scopeAssessment: scope,
  };
}

/** 4-period telecom-shaped fixture → real assessAnalysisScope yields detected-telecom-unmodelled. */
function telecomScope() {
  const periods = Array.from({ length: 4 }, (_, i) => ({
    company_id: "TELECOM_LIKE",
    period_end: `${2022 + i}-03-31`,
    raw_metric_values: {
      "Total Assets__BalanceSheet": 100000 + i * 5000,
      "Total Equity__BalanceSheet": 40000 + i * 2000,
      "Profit After Tax__ProfitLoss": 6000 + i * 300,
      "Revenue From Operations(Net)__ProfitLoss": 80000 + i * 4000,
      "Direct Tele Communication / Network Development Expenses__ProfitLoss": 5000 + i * 300,
    },
  }));
  return assessAnalysisScope(periods);
}

function buildTrace(scope: QualityGateReport["scopeAssessment"]) {
  return buildAnalysisTraceability({
    generatedAt: "2026-06-01T00:00:00.000Z",
    runId: "run-sector-cap",
    companyId: "TEST",
    sourceMode: "json",
    recastData: [mkBalancedPeriod("2025-03-31")],
    config: DEFAULT_CONFIG,
    rawData: RAW,
    periodCount: 1,
    latestPeriod: "2025-03-31",
    analysisStatus: CLEAN_STATUS,
    qualityGate: gateWithScope(scope),
    policyVersions: getAnalysisPolicyVersions(),
  });
}

describe("Phase 0 — sector ladder cap (detected-but-unmodelled telecom/utility)", () => {
  it("negative control: the sector cap does NOT fire for a supported-industrial scope", () => {
    // The cap must be scoped ONLY to the two new classifications. We assert the
    // cap boolean's effect directly (via the valuation-eligible checkpoint
    // detail) rather than "reaches valuation-eligible", because the synthetic
    // recast may trip unrelated gates (distress/concept/terminal) — those are
    // not what this test is about.
    const industrialPeriods = Array.from({ length: 4 }, (_, i) => ({
      company_id: "INDUSTRIAL_LIKE",
      period_end: `${2022 + i}-03-31`,
      raw_metric_values: {
        "Total Assets__BalanceSheet": 100000 + i * 5000,
        "Total Equity__BalanceSheet": 40000 + i * 2000,
        "Profit After Tax__ProfitLoss": 6000 + i * 300,
        "Revenue From Operations(Net)__ProfitLoss": 80000 + i * 4000,
      },
    }));
    const industrialScope = assessAnalysisScope(industrialPeriods); // → supported-industrial
    expect(industrialScope.classification).toBe("supported-industrial");

    const trace = buildTrace(industrialScope);
    const veCheckpoint = trace.rigor.checkpoints.find((c) => c.level === "valuation-eligible");
    // The sector-cap message must be absent — the cap did not fire for industrial.
    expect(veCheckpoint?.detail.toLowerCase()).not.toContain("no sector-native valuation model");
    // And production-ready is gated by the (clean) analysisStatus, NOT by a sector cap.
    const prCheckpoint = trace.rigor.checkpoints.find((c) => c.level === "production-ready");
    expect(prCheckpoint?.detail.toLowerCase()).not.toContain("sector");
  });

  it("caps a detected telecom run at economically-plausible (denies valuation-eligible + production-ready)", () => {
    const scope = telecomScope();
    expect(scope.classification).toBe("detected-telecom-unmodelled");

    const trace = buildTrace(scope);
    expect(trace.rigor.currentLevel).toBe("economically-plausible");
    expect(trace.rigor.achievedLevels).not.toContain("valuation-eligible");
    expect(trace.rigor.achievedLevels).not.toContain("production-ready");
    expect(trace.rigor.pendingLevels).toContain("valuation-eligible");

    const veCheckpoint = trace.rigor.checkpoints.find((c) => c.level === "valuation-eligible");
    expect(veCheckpoint?.achieved).toBe(false);
    expect(veCheckpoint?.detail).toContain("Telecom");
    expect(veCheckpoint?.detail.toLowerCase()).toContain("no sector-native valuation model");
  });

  it("caps a detected utility run identically, labelled Utility", () => {
    const periods = Array.from({ length: 4 }, (_, i) => ({
      company_id: "UTILITY_LIKE",
      period_end: `${2022 + i}-03-31`,
      raw_metric_values: {
        "Total Assets__BalanceSheet": 100000 + i * 5000,
        "Total Equity__BalanceSheet": 40000 + i * 2000,
        "Profit After Tax__ProfitLoss": 6000 + i * 300,
        "Revenue From Operations(Net)__ProfitLoss": 80000 + i * 4000,
        "Regulatory Deferral Account - Debit Balance__BalanceSheet": 9000 + i * 500,
      },
    }));
    const scope = assessAnalysisScope(periods);
    expect(scope.classification).toBe("detected-utility-unmodelled");

    const trace = buildTrace(scope);
    expect(trace.rigor.currentLevel).toBe("economically-plausible");
    expect(trace.rigor.achievedLevels).not.toContain("valuation-eligible");
    const veCheckpoint = trace.rigor.checkpoints.find((c) => c.level === "valuation-eligible");
    expect(veCheckpoint?.detail).toContain("Utility");
  });
});
