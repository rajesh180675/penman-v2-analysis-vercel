import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ForecastReport from "../ForecastReport";
import { AnalysisTraceabilityEnvelope } from "../../engine/analysisTraceability";
import { DEFAULT_CONFIG, RecastPeriod } from "../../engine/types";

function mkTraceability(status: "production-ready" | "guarded" | "blocked"): AnalysisTraceabilityEnvelope {
  return {
    schemaVersion: "2026-04-traceability-v8",
    generatedAt: "2026-04-04T12:00:00.000Z",
    runContext: {
      runId: "run-1",
      companyId: "ITC",
      sourceMode: "json",
      periodCount: 3,
      latestPeriod: "2025-03-31",
    },
    policyVersions: {
      engineVersion: "2026-03-phase8-valuation-command-center",
      mappingSpecVersion: "2026-03-capitaline-indas-v2",
      mappingPolicyVersion: "2026-03-phase8",
      anomalyPolicyVersion: "2026-03-phase8",
      valuationPolicyVersion: "2026-03-phase8-dcf",
      goldenCompanySuiteVersion: "2026-03-phase8",
      scopePolicyVersion: "2026-03-phase7",
      traceabilitySchemaVersion: "2026-04-traceability-v8",
    },
    qualityGate: {
      tier: "Tier 1",
      valuationBlocked: status === "blocked",
      blockingReasons: status === "blocked" ? ["Reconciliation still blocks valuation trust."] : [],
      scopeClassification: "supported-industrial",
      scopeBlocked: false,
    },
    confidence: {
      status,
      headline: status === "blocked" ? "Valuation blocked" : status === "guarded" ? "Review diagnostics before relying on output" : "Analysis cleared current release checks",
      tone: status === "blocked" ? "red" : status === "guarded" ? "amber" : "emerald",
      blockingCount: status === "blocked" ? 1 : 0,
      diagnosticCount: 0,
      optionalCount: 0,
    },
    parserFidelity: {
      status: "confirmed",
      score: 100,
      summary: "Parser fidelity cleared the syntactic threshold.",
      warningCount: 0,
      errorCount: 0,
      checks: [],
    },
    reconciliation: {
      status: status === "blocked" ? "failed" : "confirmed",
      summary: status === "blocked"
        ? "1 reconciliation residual check breached the critical threshold."
        : "All reconciliation checks stayed within threshold.",
      warningCount: 0,
      errorCount: status === "blocked" ? 1 : 0,
      maxResidualRatio: status === "blocked" ? 0.1551 : 0,
      checks: [],
    },
    accountingStandardCoverage: {
      dominantStandard: "ind-as",
      periodsByStandard: { "ind-as": 5, "revised-sch-vi": 0, standard: 0, unknown: 0 },
      preIndASPeriods: 0,
      hasMultiStandardData: false,
      confidence: "high",
    },
    conceptIdentity: {
      status: "clean",
      conflictCount: 0,
      unresolvedCriticalCount: 0,
      conflicts: [],
      truncated: false,
    },
    economicSanity: {
      status: "passed",
      anchorPeriod: "2025-03-31",
      anchorReason: "Latest period passed all economic sanity checks.",
      skippedPeriods: [],
      failedChecks: [],
    },
    rigor: {
      currentLevel: status === "blocked" ? "syntactically-valid" : "production-ready",
      currentLabel: status === "blocked" ? "Syntactically valid" : "Production-ready",
      summary: status === "blocked"
        ? "Structural residual thresholds did not clear."
        : "All currently wired release checks passed.",
      achievedLevels: status === "blocked" ? ["syntactically-valid"] : ["syntactically-valid", "structurally-reconciled", "economically-plausible", "valuation-eligible", "production-ready"],
      pendingLevels: status === "blocked" ? ["structurally-reconciled", "economically-plausible", "valuation-eligible", "production-ready"] : [],
      checkpoints: [],
    },
    mappingCoverage: {
      unresolvedBySeverity: { critical: 0, warning: 0, info: 0 },
      unresolvedByTier: { "Tier A": 0, "Tier B": 0, "Tier C": 0, "Tier D": 0 },
      outOfSpecLabelCount: 0,
      actionableOutOfSpecLabelCount: 0,
      backlogByAction: { "add-to-spec": 0, "group-to-existing": 0, "ignore-non-core": 0, review: 0 },
    },
    governance: {
      contentClass: null,
      retentionDays: null,
      runInspectorEnabled: null,
    },
    analysisContext: {
      rawPeriodCount: 3,
      recastPeriodCount: 3,
      hasRecastData: true,
      hasDebugInfo: false,
      debugFiles: 0,
      rawMetricKeyCount: 0,
      engineError: null,
    },
    backlogPreview: [],
  };
}

const blockedTraceability = mkTraceability("blocked");

const data = [
  mkPeriod(2023, 1000, 180, 130, 520, 760),
  mkPeriod(2024, 1100, 205, 150, 590, 820),
  mkPeriod(2025, 1210, 232, 172, 665, 885),
];

const config = { ...DEFAULT_CONFIG, market_price: 100, shares_outstanding: 10 };

function mkPeriod(year: number, sales: number, oi: number, cni: number, cse: number, noa: number): RecastPeriod {
  return {
    period_end: `${year}-03-31`,
    bs: {
      TA: noa + 200,
      CSE: cse,
      MI: 0,
      FA: 120,
      FO: 20,
      OA: noa + 80,
      OL: 140,
      OL_TradePayables: 40,
      OL_OtherCurrentLiabilities: 25,
      OL_ProvisionsCurrent: 0,
      OL_ProvisionsLongTerm: 0,
      OL_CurrentTaxLiabilities: 0,
      OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 0,
      OL_OtherNonCurrentLiabilities: 0,
      NOA: noa,
      NFO: noa - cse,
      DTL: 0,
      PensionObl: 0,
      OL_ex_DTL: 140,
      Goodwill: 0,
      CurrentAssets: 240,
      CurrentLiabilities: 160,
      Inventory: 35,
      TradeReceivables: 55,
      TradePayables: 40,
      PPE: 220,
      LIFO_reserve: 0,
      separationScore: 88,
      OA_PPE: 220,
      OA_ROU: 0,
      OA_Goodwill: 0,
      OA_OtherIntangibles: 0,
      OA_Inventory: 35,
      OA_TradeReceivables: 55,
      OA_DTA: 0,
      OA_CWIP: 0,
      OA_Other: noa - 310,
    },
    is: {
      Sales: sales,
      TaxExpense: 45,
      taxRate: 0.25,
      PAT: cni,
      OCI: 0,
      TCI: cni,
      TCI_NCI: 0,
      CNI: cni,
      FinanceCost: 10,
      FinanceIncome: 2,
      FinanceIncomeRung: 1,
      PreferredDividend: 0,
      NFE: 8,
      OI: oi,
      OtherItems: 0,
      OI_from_sales: oi,
      MII: 0,
      COGS: sales * 0.58,
      operatingCostBridge: {
        materialCost: sales * 0.42,
        employeeCost: sales * 0.10,
        depreciation: sales * 0.04,
        sgaAdvertising: 0,
        sgaLegalProfessional: 0,
        sgaRent: 0,
        sgaFreight: 0,
        sgaRepairs: 0,
        sgaPowerFuel: 0,
        sgaDetailed: sales * 0.12,
        sgaResidual: 0,
        sgaTotal: sales * 0.12,
        otherOperatingExpense: sales * 0.06,
        otherOperatingIncome: sales * 0.01,
        grossProfit: sales * 0.58,
        operatingCosts: sales * 0.32,
        bridgeCoreOI: oi,
        bridgeGapToReportedCoreOI: 0,
        coverageRatio: 0.82,
        driverRatios: {
          materialCostPct: 0.42,
          employeeCostPct: 0.10,
          depreciationPct: 0.04,
          sgaPct: 0.12,
          otherOperatingExpensePct: 0.06,
          otherOperatingIncomePct: 0.01,
          bridgeCoreSalesPm: oi / sales,
        },
      },
    },
    cu: { UOI: 0, CoreOI: oi, UFE: 0, CoreNFE: 8, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: {
      CFO: oi * 0.92,
      Capex: sales * 0.05,
      DividendPaid: cni * 0.22,
      EquityIssued: 0,
      ShareBuybacks: 0,
      InterestReceived: 0,
      DividendReceived: 0,
      FCF_accounting: oi * 0.35,
      FCF_cash: oi * 0.40,
      d_t: cni * 0.22,
      d_t_formula: cni * 0.22,
      d_t_discrepancy: 0,
      EBITDA: oi * 1.12,
    },
    ratios: {
      ROCE: 0.21,
      RNOA: 0.18,
      NBC: 0.045,
      SPREAD: 0.12,
      FLEV: 0.18,
      PM: oi / sales,
      ATO: sales / noa,
      SalesPM: oi / sales,
      ATO_star: sales / noa,
      OtherItemsRatio: 0,
      ROCE_bridge_residual: 0,
      io: 0.07,
      ROOA: 0.18,
      OLLEV: 0.28,
      OLSPREAD: 0.03,
      RNOA_check: 0,
      ROTCE: 0.2,
      MSR: 0.15,
      CoreSalesPM: oi / sales,
      CoreOtherItems_OA: 0,
      UOI_OA: 0,
      CoreNBC: 0.045,
      UFE_NFO: 0,
      CoreSPREAD: 0.12,
      ROCE_eq16_reconstructed: 0.21,
      ROCE_eq16_error: 0,
      eq16_step1_residual: 0,
      eq16_step2_residual: 0,
      eq16_step3_residual: 0,
      eq16_flag: "OK",
      eq16_diagnosis: null,
      ROOA_spec: 0.18,
      imputed_io_spec: 0.07,
      required_return_per_sales: 0.05,
      value_creating_margin: 0.03,
      CSE_eq8_check: 0,
      CSE_eq8_error_pct: 0,
      current_ratio: 1.4,
      quick_ratio: 1.1,
      days_receivable: 22,
      days_payable: 18,
      days_inventory: 19,
      cash_conversion_cycle: 23,
      accrual_ratio_bs: 0.02,
      accrual_ratio_cf: 0.01,
      cash_conversion_ratio: 0.84,
      interest_coverage: 11,
      NOA_growth: 0.07,
      CNI_growth: 0.08,
      OI_growth: 0.09,
      Sales_growth: 0.10,
      noaSmall: false,
      separationScore: 88,
      accrual_regime: "NORMAL",
      dirty_surplus: 0,
      dirty_surplus_pct_cse: 0,
      freeOL: 0,
      interestBearingOL: 0,
      OLLEV_check: 0,
      RNOA_vs_OLLEV_residual: 0,
    employeeCostRatio: null,
    },
    ri: { RE: 75, ReOI: 70 },
    quality: {
      piotroski_roa: 1,
      piotroski_delta_roa: 1,
      piotroski_cfo: 1,
      piotroski_accrual: 1,
      piotroski_leverage: 1,
      piotroski_liquidity: 1,
      piotroski_dilution: 1,
      piotroski_margin: 1,
      piotroski_turnover: 1,
      piotroski_total: 9,
      beneish_dsri: 1,
      beneish_gmi: 1,
      beneish_aqi: 1,
      beneish_sgi: 1,
      beneish_depi: 1,
      beneish_sgai: 1,
      beneish_lvgi: 1,
      beneish_tata: 0,
      beneish_mscore: -2.4,
      altman_wc_ta: 0.2,
      altman_re_ta: 0.3,
      altman_ebit_ta: 0.2,
      altman_bve_tl: 1.8,
      altman_s_ta: 1,
      altman_zprime: 3.6,
    },
  };
}

describe("ForecastReport", () => {
  it("renders persistence-led scenario policy guidance", () => {
    const html = renderToStaticMarkup(
      <ForecastReport
        data={data}
        config={config}
      />,
    );

    expect(html).toContain("Scenario Policy");
    expect(html).toContain("Default weighting");
    expect(html).toContain("Spread posture");
  });

  it("shows four scenario weights that match policy defaults", () => {
    const html = renderToStaticMarkup(
      <ForecastReport
        data={data}
        config={config}
        traceability={blockedTraceability}
      />,
    );

    expect(html).toContain("P(Stress)");
    expect(html).toContain("P(Panic)");
    expect(html).not.toContain("0.38000000000000006");
  });

  it("renders blocked forecast outputs as diagnostic-only", () => {
    const html = renderToStaticMarkup(
      <ForecastReport
        data={data}
        config={config}
        traceability={blockedTraceability}
      />,
    );

    expect(html).toContain("Diagnostic preview only");
    expect(html).not.toContain("Run Monte Carlo");
    expect(html).not.toContain("Sensitivity Analysis — §4.3.4");
  });

  it("keeps guarded runs in review-only mode", () => {
    const html = renderToStaticMarkup(
      <ForecastReport
        data={data}
        config={config}
        traceability={mkTraceability("guarded")}
      />,
    );

    expect(html).toContain("Review-only");
    expect(html).not.toContain("Run Monte Carlo");
    expect(html).toContain("Expected value unavailable until scenario probabilities sum to 1.00 and valuation trust supports point-estimate use.");
    expect(html).toContain("Sensitivity Analysis — §4.3.4");
    expect(html).toContain("inactive in current valuation path");
  });

  it("shows forecast provenance when traceability is available", () => {
    const html = renderToStaticMarkup(
      <ForecastReport
        data={data}
        config={config}
        traceability={mkTraceability("production-ready")}
      />,
    );

    expect(html).toContain("Forecast provenance");
    expect(html).toContain("Engine version");
    expect(html).toContain("Valuation policy");
    expect(html).toContain("Traceability schema");
    expect(html).toContain("Anchor period");
    expect(html).toContain("2026-03-phase8-valuation-command-center");
    expect(html).toContain("2026-04-traceability-v8");
  });

  it("flags incomplete provenance metadata as unverified", () => {
    const traceability = mkTraceability("guarded");
    traceability.policyVersions.engineVersion = "";
    traceability.policyVersions.valuationPolicyVersion = "";
    traceability.policyVersions.traceabilitySchemaVersion = "";

    const html = renderToStaticMarkup(
      <ForecastReport
        data={data}
        config={config}
        traceability={traceability}
      />,
    );

    expect(html).toContain("Version metadata is incomplete; treat this forecast as unverified against the current valuation rule set.");
    expect(html).toContain("unversioned");
  });

});
