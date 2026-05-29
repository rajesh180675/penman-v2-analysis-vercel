import { describe, expect, it } from "vitest";
import { buildAnalysisSnapshot } from "../../lib/auditSnapshot";
import { AnalysisStatusSummary } from "../analysisStatus";
import { MappingAuditReport, QualityGateReport } from "../mappingAudit";
import { getAnalysisPolicyVersions } from "../policyVersions";
import { DEFAULT_CONFIG, RawPeriodData, RecastPeriod } from "../types";
import { AuditSubmissionMeta } from "../../lib/audit";
import { CapitalineParseDebug } from "../capitalineParser";

const traceabilityVersions = getAnalysisPolicyVersions();

function mkRawPeriod(period_end: string): RawPeriodData {
  return {
    company_id: "ASIAN PAINTS",
    period_end,
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000,
      "Total Equity__BalanceSheet": 600,
      "Property, Plant and Equipment__BalanceSheet": 320,
      "Revenue From Operations(Net)__ProfitLoss": 900,
      "Profit Before Tax__ProfitLoss": 120,
      "Tax Expenses__ProfitLoss": 30,
      "Profit After Tax__ProfitLoss": 90,
      "Net Cash From Operating Activities__CashFlow": 110,
      "Purchase of Fixed Assets__CashFlow": 45,
    },
  };
}

function mkRecastPeriod(period_end: string): RecastPeriod {
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
  };
}

describe("traceability snapshot", () => {
  it("persists full run provenance and richer analysis context", () => {
    const rawData = [mkRawPeriod("2025-03-31")];
    const recastData = [mkRecastPeriod("2025-03-31")];
    const auditMeta: AuditSubmissionMeta = {
      runId: "run-asian-paints",
      sourceMode: "capitaline",
      companyId: "ASIAN PAINTS",
      fileName: "asian paints.zip",
      runAccessToken: "token",
      contentClass: "confidential-financial-statements",
      retentionDays: 45,
    };

    const mappingAudit: MappingAuditReport = {
      mappingSpecVersion: traceabilityVersions.mappingSpecVersion,
      policyVersion: traceabilityVersions.mappingPolicyVersion,
      usedKeysNotInYaml: [],
      yamlKeysNotInDataset: [],
      unresolvedCriticalByStatement: { BalanceSheet: [], ProfitLoss: [], CashFlow: [] },
      datasetKeyCounts: { BalanceSheet: 2, ProfitLoss: 4, CashFlow: 2, Unknown: 0 },
      coverageSummary: {
        policyVersion: traceabilityVersions.mappingPolicyVersion,
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
        policyVersion: traceabilityVersions.mappingPolicyVersion,
        totalsByAction: { "add-to-spec": 0, "group-to-existing": 1, "ignore-non-core": 0, review: 0 },
        totalsByPriority: { blocking: 0, diagnostic: 1, optional: 0 },
        actionableCount: 1,
        ignoredCount: 0,
        topActionable: [
          {
            statement: "ProfitLoss",
            key: "Selling and Distribution Expenses",
            periodsObserved: 1,
            nonZeroPeriods: 1,
            latestValue: 100,
            maxAbsValue: 100,
            triage: {
              policyVersion: traceabilityVersions.mappingPolicyVersion,
              action: "group-to-existing",
              priority: "diagnostic",
              rationale: "Belongs in SGA bridge.",
              targetLine: "IS.OpBridge.SGA",
              targetGroupId: "is-sga-detail",
              targetGroupTitle: "Detailed SG&A buckets",
              suggestedSpecPath: null,
            },
          },
        ],
      },
    };

    const qualityGate: QualityGateReport = {
      tier: "Tier 1" as const,
      valuationBlocked: false,
      missingMinimum: [],
      missingCore: [],
      blockingReasons: [],
      policyVersion: traceabilityVersions.mappingPolicyVersion,
      coverageSummary: mappingAudit.coverageSummary,
      valuationCriticalGaps: [],
      ratioCriticalGaps: [],
      scopeAssessment: {
        policyVersion: traceabilityVersions.scopePolicyVersion,
        classification: "supported-industrial" as const,
        analysisFamily: "industrial" as const,
        blocked: false,
        label: "Supported industrial/company scope",
        reasons: [],
        recommendedAction: "Proceed",
        signals: [],
      },
    };

    const debugInfo: CapitalineParseDebug = {
      companyId: "ASIAN PAINTS",
      files: [
        { name: "BalanceSheetINDAS_.xls", statementGuess: "BalanceSheet" },
        { name: "ProfitLossINDAS_.xls", statementGuess: "ProfitLoss" },
        { name: "CashFlowINDAS_.xls", statementGuess: "CashFlow" },
      ],
      detectedPeriods: ["2025-03-31"],
      rawGrids: [
        {
          file: "BalanceSheetINDAS_.xls",
          methods: ["xlsx"],
          bestMethod: "xlsx",
          rowCount: 20,
          colCount: 4,
          firstRows: [],
          headerDetected: true,
          errors: [],
        },
        {
          file: "ProfitLossINDAS_.xls",
          methods: ["xlsx"],
          bestMethod: "xlsx",
          rowCount: 20,
          colCount: 4,
          firstRows: [],
          headerDetected: true,
          errors: [],
        },
        {
          file: "CashFlowINDAS_.xls",
          methods: ["xlsx"],
          bestMethod: "xlsx",
          rowCount: 20,
          colCount: 4,
          firstRows: [],
          headerDetected: true,
          errors: [],
        },
      ],
      metrics: {
        totalCompositeKeys: 8,
        totalBaseKeys: 8,
        baseKeyCollisions: [],
        byStatement: {
          BalanceSheet: 2,
          ProfitLoss: 4,
          CashFlow: 2,
          Unknown: 0,
          Segment: 0,
        },
      },
      warnings: [],
      sample: {
        firstRows: [],
      },
      rawMetricKeys: ["Revenue From Operations(Net)", "Profit Before Tax"],
    };

    recastData[0].bs.FO = 120;

    const analysisStatus: AnalysisStatusSummary = {
      status: "production-ready",
      label: "Production-ready",
      headline: "Analysis cleared current release checks",
      summary: "No blocking scope or valuation issues were detected for the loaded dataset.",
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

    const snapshot = buildAnalysisSnapshot({
      rawData,
      recastData,
      config: DEFAULT_CONFIG,
      debugInfo,
      qualityGate,
      mappingAudit,
      engineError: null,
      analysisStatus,
      auditMeta,
    });

    expect(snapshot.family).toBe("industrial");
    expect(snapshot.traceability.generatedAt).toBeTruthy();
    expect(snapshot.traceability.runContext.runId).toBe("run-asian-paints");
    expect(snapshot.traceability.runContext.sourceMode).toBe("capitaline");
    expect(snapshot.traceability.analysisContext.rawPeriodCount).toBe(1);
    expect(snapshot.traceability.analysisContext.recastPeriodCount).toBe(1);
    expect(snapshot.traceability.analysisContext.debugFiles).toBe(3);
    expect(snapshot.traceability.analysisContext.rawMetricKeyCount).toBe(2);
    expect(snapshot.traceability.parserFidelity.status).toBe("confirmed");
    expect(snapshot.traceability.parserFidelity.score).toBe(100);
    expect(snapshot.traceability.reconciliation.status).toBe("confirmed");
    expect(snapshot.traceability.reconciliation.maxResidualRatio).toBe(0);
    expect(snapshot.traceability.rigor.currentLevel).toBe("production-ready");
    expect(snapshot.traceability.rigor.currentLabel).toBe("Production-ready");
    expect(snapshot.traceability.rigor.pendingLevels).toHaveLength(0);
    expect(snapshot.traceability.backlogPreview).toHaveLength(1);
    expect(snapshot.traceability.backlogPreview[0]?.key).toBe("Selling and Distribution Expenses");
  });

  it("blocks structural reconciliation when residual thresholds are breached", () => {
    const snapshot = buildAnalysisSnapshot({
      rawData: [mkRawPeriod("2025-03-31")],
      recastData: [
        {
          ...mkRecastPeriod("2025-03-31"),
          recastDebug: {
            rawTotalAssets: 1100,
            rawTotalLiabilitiesAndEquity: 1100,
            rawTotalEquity: null,
            explicitOL: 0,
          },
        },
      ],
      config: DEFAULT_CONFIG,
      debugInfo: null,
      qualityGate: null,
      mappingAudit: null,
      engineError: null,
      analysisStatus: null,
      auditMeta: null,
    });

    expect(snapshot.family).toBe("industrial");
    expect(snapshot.traceability.reconciliation.status).toBe("failed");
    expect(snapshot.traceability.confidence.blockingCount).toBe(1);
    expect(snapshot.traceability.rigor.currentLevel).toBe("syntactically-valid");
    expect(snapshot.traceability.rigor.pendingLevels).toContain("structurally-reconciled");
    expect(snapshot.traceability.rigor.checkpoints.find((checkpoint) => checkpoint.level === "structurally-reconciled")?.detail)
      .toContain("Structural residual thresholds did not clear");
  });

  it("persists gate-aware blocking counts from analysis status when mapping blockers are zero", () => {
    const snapshot = buildAnalysisSnapshot({
      rawData: [mkRawPeriod("2025-03-31")],
      recastData: [
        {
          ...mkRecastPeriod("2025-03-31"),
          bs: {
            ...mkRecastPeriod("2025-03-31").bs,
            FO: 120,
          },
        },
      ],
      config: DEFAULT_CONFIG,
      debugInfo: null,
      qualityGate: {
        tier: "Tier 1",
        valuationBlocked: true,
        missingMinimum: [],
        missingCore: [],
        blockingReasons: ["Terminal anchor remains guarded."],
        policyVersion: traceabilityVersions.mappingPolicyVersion,
        coverageSummary: {
          policyVersion: traceabilityVersions.mappingPolicyVersion,
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
          policyVersion: traceabilityVersions.scopePolicyVersion,
          classification: "supported-industrial",
          analysisFamily: "industrial",
          blocked: false,
          label: "Supported industrial/company scope",
          reasons: [],
          recommendedAction: "Proceed",
          signals: [],
        },
      },
      mappingAudit: null,
      engineError: null,
      analysisStatus: {
        status: "blocked",
        label: "Blocked",
        headline: "Valuation blocked",
        summary: "Terminal anchor remains guarded.",
        reasons: ["Terminal anchor remains guarded."],
        tone: "red",
        qualityTier: "Tier 1",
        valuationStatus: "guarded",
        scopeBlocked: false,
        valuationBlocked: true,
        blockingCount: 0,
        diagnosticCount: 0,
        optionalCount: 0,
        effectiveBlockingCount: 1,
        effectiveDiagnosticCount: 0,
        effectiveOptionalCount: 0,
      },
      auditMeta: null,
    });

    expect(snapshot.family).toBe("industrial");
    expect(snapshot.traceability.confidence.status).toBe("blocked");
    expect(snapshot.traceability.confidence.blockingCount).toBe(1);
    expect(snapshot.traceability.mappingCoverage.unresolvedBySeverity.critical).toBe(0);
  });
});
