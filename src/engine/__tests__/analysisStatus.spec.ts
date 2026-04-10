import { describe, expect, it } from "vitest";
import { deriveAnalysisStatus } from "../analysisStatus";
import { evaluateQualityGate } from "../mappingAudit";
import { getAnalysisPolicyVersions } from "../policyVersions";
import { RawPeriodData, RecastPeriod, Severity } from "../types";
import { resolveValuationReadiness } from "../valuationPolicy";

function guardedRawPeriod(period_end: string): RawPeriodData {
  return {
    company_id: "ITC",
    period_end,
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000,
      "Total Equity__BalanceSheet": 600,
      "Revenue From Operations(Net)__ProfitLoss": 900,
      "Profit Before Tax__ProfitLoss": 120,
      "Tax Expenses__ProfitLoss": 30,
      "Profit After Tax__ProfitLoss": 90,
      "Finance Cost__ProfitLoss": 10,
      "Net Cash from Operating Activities__CashFlow": 110,
      "Purchased of Fixed Assets__CashFlow": 45,
    },
  };
}

function guardedRecastPeriod(period_end: string, contaminated = false): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000,
      CSE: 600,
      MI: 0,
      FA: 120,
      FO: 180,
      OA: 880,
      OL: 280,
      OL_TradePayables: 70,
      OL_OtherCurrentLiabilities: 60,
      OL_ProvisionsCurrent: 10,
      OL_ProvisionsLongTerm: 10,
      OL_CurrentTaxLiabilities: 10,
      OL_NonCurrentTaxLiabilities: 10,
      OL_DeferredTaxLiabilitiesNet: 5,
      OL_OtherNonCurrentLiabilities: 105,
      NOA: 600,
      NFO: 0,
      DTL: 5,
      PensionObl: 0,
      OL_ex_DTL: 275,
      Goodwill: 0,
      CurrentAssets: 420,
      CurrentLiabilities: 240,
      Inventory: 90,
      TradeReceivables: 100,
      TradePayables: 70,
      PPE: 320,
      LIFO_reserve: 0,
      separationScore: 92,
      OA_PPE: 320,
      OA_ROU: 0,
      OA_Goodwill: 0,
      OA_OtherIntangibles: 0,
      OA_Inventory: 90,
      OA_TradeReceivables: 100,
      OA_DTA: 0,
      OA_CWIP: 0,
      OA_Other: 370,
    },
    is: {
      Sales: 900,
      TaxExpense: 30,
      taxRate: 0.25,
      PAT: 90,
      OCI: 0,
      TCI: 90,
      TCI_NCI: 0,
      CNI: 90,
      FinanceCost: 15,
      FinanceIncome: 2,
      FinanceIncomeRung: 1,
      PreferredDividend: 0,
      NFE: 13,
      OI: 103,
      OtherItems: 0,
      OI_from_sales: 103,
      MII: 0,
      COGS: 560,
    },
    cu: {
      UOI: 0,
      CoreOI: 103,
      UFE: 0,
      CoreNFE: 13,
      ExceptionalItemsAfterTax: 0,
      OCITotal: 0,
    },
    cf: {
      CFO: 110,
      Capex: 45,
      DividendPaid: 20,
      EquityIssued: 0,
      ShareBuybacks: 0,
      InterestReceived: 0,
      DividendReceived: 0,
      FCF_accounting: 45,
      FCF_cash: 65,
      d_t: 20,
      d_t_formula: 20,
      d_t_discrepancy: 0,
      EBITDA: 140,
    },
    spec_flags: contaminated ? [
      { spec_id: "S-5.1", severity: Severity.CRITICAL, label: "STRUCTURAL_EVENT", message: "Dirty surplus event.", affects_terminal: true, period: period_end },
      { spec_id: "S-5.3", severity: Severity.CRITICAL, label: "RNOA_OUTLIER_CRITICAL", message: "RNOA outlier.", affects_terminal: true, period: period_end },
    ] : [],
  };
}

const versions = getAnalysisPolicyVersions();

describe("analysis status confidence gating", () => {
  it("marks valuation blocked when recast valuation readiness is guarded", () => {
    const raw = [guardedRawPeriod("2024-03-31"), guardedRawPeriod("2025-03-31")];
    const recast = [guardedRecastPeriod("2024-03-31"), guardedRecastPeriod("2025-03-31", true)];
    const qualityGate = evaluateQualityGate(raw, null, recast);
    const readiness = resolveValuationReadiness(recast);
    const status = deriveAnalysisStatus(qualityGate, readiness, null);

    expect(readiness.status).toBe("guarded");
    expect(qualityGate.valuationBlocked).toBe(true);
    expect(qualityGate.blockingReasons.some((reason) => reason.includes("latest period".slice(0, 6)) || reason.includes("Terminal") || reason.includes("anchor"))).toBe(true);
    expect(status.status).toBe("blocked");
    expect(status.effectiveBlockingCount).toBeGreaterThanOrEqual(status.blockingCount);
    expect(status.effectiveBlockingCount).toBeGreaterThan(0);
  });

  it("floors blocked display counters for valuation blocks even when mapping blockers are zero", () => {
    const status = deriveAnalysisStatus(
      {
        tier: "Tier 1",
        valuationBlocked: true,
        missingMinimum: [],
        missingCore: [],
        blockingReasons: ["Terminal anchor remains guarded."],
        policyVersion: versions.mappingPolicyVersion,
        coverageSummary: {
          policyVersion: versions.mappingPolicyVersion,
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
        scopeAssessment: {
          policyVersion: versions.scopePolicyVersion,
          classification: "supported-industrial",
          analysisFamily: "industrial",
          blocked: false,
          label: "Supported industrial/company scope",
          reasons: [],
          recommendedAction: "Proceed",
          signals: [],
        },
      },
      {
        status: "guarded",
        latestPeriod: "2025-03-31",
        anchorPeriod: "2024-03-31",
        anchorIndex: 1,
        fallbackUsed: true,
        contaminationTier: "COMPROMISED",
        persistenceStatus: "fragile",
        persistenceScore: 38,
        terminalFlags: [],
        terminalFlagLabels: [],
        reasons: ["Terminal anchor remains guarded."],
      },
      null,
    );

    expect(status.status).toBe("blocked");
    expect(status.blockingCount).toBe(0);
    expect(status.effectiveBlockingCount).toBe(1);
  });

  it("keeps blocked display counters non-zero for unsupported scope even without mapping blockers", () => {
    const status = deriveAnalysisStatus(
      {
        tier: "Tier 1",
        valuationBlocked: false,
        missingMinimum: [],
        missingCore: [],
        blockingReasons: [],
        policyVersion: versions.mappingPolicyVersion,
        coverageSummary: {
          policyVersion: versions.mappingPolicyVersion,
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
        scopeAssessment: {
          policyVersion: versions.scopePolicyVersion,
          classification: "unsupported-financial-company",
          analysisFamily: "financial-institution",
          blocked: true,
          label: "Unsupported scope",
          reasons: ["Banking issuer is outside current supported scope."],
          recommendedAction: "Do not proceed",
          signals: [],
        },
      },
      null,
      null,
    );

    expect(status.status).toBe("blocked");
    expect(status.blockingCount).toBe(0);
    expect(status.effectiveBlockingCount).toBe(1);
  });

  it("downgrades to guarded when persistence is fragile despite a clean anchor", () => {
    const status = deriveAnalysisStatus(
      {
        tier: "Tier 1",
        valuationBlocked: false,
        missingMinimum: [],
        missingCore: [],
        blockingReasons: [],
        policyVersion: versions.mappingPolicyVersion,
        coverageSummary: {
          policyVersion: versions.mappingPolicyVersion,
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
        scopeAssessment: {
          policyVersion: versions.scopePolicyVersion,
          classification: "supported-industrial",
          analysisFamily: "industrial",
          blocked: false,
          label: "Supported industrial/company scope",
          reasons: [],
          recommendedAction: "Proceed",
          signals: [],
        },
      },
      {
        status: "production-ready",
        latestPeriod: "2025-03-31",
        anchorPeriod: "2025-03-31",
        anchorIndex: 0,
        fallbackUsed: false,
        contaminationTier: "CLEAN",
        persistenceStatus: "fragile",
        persistenceScore: 38,
        terminalFlags: [],
        terminalFlagLabels: [],
        reasons: ["Terminal period is clean.", "Business-model persistence is fragile (38/100); treat upside as lower-confidence even if accounting contamination is clean."],
      },
      null,
    );

    expect(status.status).toBe("guarded");
    expect(status.persistenceStatus).toBe("fragile");
    expect(status.summary.toLowerCase()).toContain("terminal period is clean");
  });

  it("downgrades to guarded when actionable backlog review remains high", () => {
    const status = deriveAnalysisStatus(
      {
        tier: "Tier 1",
        valuationBlocked: false,
        missingMinimum: [],
        missingCore: [],
        blockingReasons: [],
        policyVersion: versions.mappingPolicyVersion,
        coverageSummary: {
          policyVersion: versions.mappingPolicyVersion,
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
        scopeAssessment: {
          policyVersion: versions.scopePolicyVersion,
          classification: "supported-industrial",
          analysisFamily: "industrial",
          blocked: false,
          label: "Supported industrial/company scope",
          reasons: [],
          recommendedAction: "Proceed",
          signals: [],
        },
      },
      {
        status: "production-ready",
        latestPeriod: "2025-03-31",
        anchorPeriod: "2025-03-31",
        anchorIndex: 0,
        fallbackUsed: false,
        contaminationTier: "CLEAN",
        persistenceStatus: "durable",
        persistenceScore: 72,
        terminalFlags: [],
        terminalFlagLabels: [],
        reasons: ["Terminal period is clean."],
      },
      {
        mappingSpecVersion: versions.mappingSpecVersion,
        policyVersion: versions.mappingPolicyVersion,
        usedKeysNotInYaml: [],
        yamlKeysNotInDataset: [],
        unresolvedCriticalByStatement: { BalanceSheet: [], ProfitLoss: [], CashFlow: [] },
        datasetKeyCounts: { BalanceSheet: 0, ProfitLoss: 0, CashFlow: 0, Unknown: 0 },
        coverageSummary: {
          policyVersion: versions.mappingPolicyVersion,
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
        outOfSpecLabels: [],
        clusterSuggestions: { clusters: [], unclustered: [], stats: { totalUnknown: 0, clusteredCount: 0, aliasRecommendation: 0, reviewCount: 0 } },
        correlationSuggestions: [],
        promotionCandidates: [],
        backlogSummary: {
          policyVersion: versions.mappingPolicyVersion,
          totalsByAction: { "add-to-spec": 2, "group-to-existing": 46, "ignore-non-core": 900, review: 180 },
          totalsByPriority: { blocking: 0, diagnostic: 40, optional: 188 },
          actionableCount: 228,
          ignoredCount: 900,
          topActionable: [],
        },
      },
    );

    expect(status.status).toBe("guarded");
    expect(status.headline).toBe("Coverage breadth still needs review");
    expect(status.reasons.some((reason) => reason.includes("Backlog review volume remains high"))).toBe(true);
  });
});
