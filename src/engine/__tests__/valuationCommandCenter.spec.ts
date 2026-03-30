import { describe, expect, it } from "vitest";
import { buildValuationCommandCenter } from "../valuationCommandCenter";
import { DEFAULT_CONFIG, RecastPeriod } from "../types";
import { AnalysisStatusSummary } from "../analysisStatus";

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
      altman_s_ta: 1.0,
      altman_zprime: 3.6,
    },
  };
}

const productionReadyStatus: AnalysisStatusSummary = {
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

describe("valuation command center", () => {
  it("builds stressed and base scenarios with an investable signal ladder", () => {
    const data = [
      mkPeriod(2023, 1000, 180, 130, 520, 760),
      mkPeriod(2024, 1100, 205, 150, 590, 820),
      mkPeriod(2025, 1210, 232, 172, 665, 885),
    ];
    const out = buildValuationCommandCenter({
      data,
      config: {
        ...DEFAULT_CONFIG,
        shares_outstanding: 620,
        market_price: 1,
      },
      marketData: {
        symbol: "ASIANPAINT.BSE",
        provider: "Alpha Vantage",
        fetchedAt: "2026-03-30T16:00:00.000Z",
        price: 1,
        previousClose: 1.1,
        changePct: -0.09,
        marketCap: null,
        enterpriseValue: null,
        sharesOutstanding: null,
        riskFreeRate: 0.07,
        priceAsOf: "2026-03-30T15:59:00.000Z",
        rateAsOf: "2026-03-29",
        freshness: "live",
        sourceSummary: "Alpha Vantage",
        warnings: [],
        history: {
          points: [],
          currentPricePercentile: 0.05,
          low52Week: 0.9,
          high52Week: 2.1,
          distanceFrom52WeekLowPct: 0.11,
          drawdownFrom52WeekHighPct: -0.52,
        },
      },
      analysisStatus: productionReadyStatus,
    });

    expect(out.scenarios).toHaveLength(4);
    expect(out.scenarios.find((scenario) => scenario.key === "base")?.intrinsicPerShare).toBeGreaterThan(0);
    expect(out.scenarios.find((scenario) => scenario.key === "stress")?.intrinsicPerShare).toBeGreaterThan(0);
    expect(["interesting", "high-conviction", "screaming-buy"]).toContain(out.signal.state);
    expect(out.reverseDcf.impliedOwnerEarningsGrowth).not.toBeNull();
    expect(out.opportunity.qualityScore).toBeGreaterThan(60);
    expect(out.opportunity.requiredMarginOfSafetyPct).toBeGreaterThan(0.15);
    expect(out.scenarios.find((scenario) => scenario.key === "stress")?.expectedCagr).not.toBeNull();
  });

  it("blocks the signal when the broader analysis is blocked", () => {
    const data = [
      mkPeriod(2024, 1100, 205, 150, 590, 820),
      mkPeriod(2025, 1210, 232, 172, 665, 885),
    ];
    const out = buildValuationCommandCenter({
      data,
      config: {
        ...DEFAULT_CONFIG,
        shares_outstanding: 620,
      },
      analysisStatus: {
        ...productionReadyStatus,
        status: "blocked",
        label: "Blocked",
        headline: "Unsupported scope",
        summary: "Dataset is outside the supported industrial-company scope.",
        tone: "red",
        scopeBlocked: true,
      },
    });

    expect(out.signal.state).toBe("blocked");
    expect(out.signal.killSwitches[0]).toContain("outside the supported industrial-company scope");
  });

  it("applies the selected sector template and exposes a professional opportunity protocol", () => {
    const data = [
      mkPeriod(2023, 1000, 180, 130, 520, 760),
      mkPeriod(2024, 1100, 205, 150, 590, 820),
      mkPeriod(2025, 1210, 232, 172, 665, 885),
    ];
    const out = buildValuationCommandCenter({
      data,
      config: {
        ...DEFAULT_CONFIG,
        sector_template: "paint",
        shares_outstanding: 620,
        market_price: 0.8,
      },
      marketData: {
        symbol: "ASIANPAINT.BSE",
        provider: "Manual",
        fetchedAt: "2026-03-30T16:00:00.000Z",
        price: 0.8,
        previousClose: 0.82,
        changePct: -0.02,
        marketCap: null,
        enterpriseValue: null,
        sharesOutstanding: null,
        riskFreeRate: 0.07,
        priceAsOf: "2026-03-30T15:59:00.000Z",
        rateAsOf: "2026-03-29",
        freshness: "live",
        sourceSummary: "Manual",
        warnings: [],
        history: {
          points: [],
          currentPricePercentile: 0.04,
          low52Week: 0.75,
          high52Week: 2.1,
          distanceFrom52WeekLowPct: 0.06,
          drawdownFrom52WeekHighPct: -0.62,
        },
      },
      analysisStatus: productionReadyStatus,
    });

    expect(out.sectorTemplate.id).toBe("paint");
    expect(["accumulate", "high-conviction", "truck-load zone"]).toContain(out.opportunity.convictionBucket);
    expect(out.opportunity.requiredMarginOfSafetyPct).toBeGreaterThanOrEqual(0.18);
    expect(out.reverseDcf.expectationLabel.length).toBeGreaterThan(10);
    expect(out.diagnostics.maintenanceCapex).toBeGreaterThan(0);
  });

  it("widens the required margin of safety when quality deteriorates", () => {
    const baseData = [
      mkPeriod(2023, 1000, 180, 130, 520, 760),
      mkPeriod(2024, 1100, 205, 150, 590, 820),
      mkPeriod(2025, 1210, 232, 172, 665, 885),
    ];
    const strong = buildValuationCommandCenter({
      data: baseData,
      config: {
        ...DEFAULT_CONFIG,
        sector_template: "industrials",
        shares_outstanding: 620,
        market_price: 1,
      },
      analysisStatus: productionReadyStatus,
    });

    const weakData = [...baseData];
    weakData[2] = {
      ...weakData[2],
      quality: {
        ...weakData[2].quality!,
        piotroski_total: 3,
        altman_zprime: 1.8,
        beneish_mscore: -1.6,
      },
      ratios: {
        ...weakData[2].ratios!,
        cash_conversion_ratio: 0.55,
        FLEV: 0.9,
      },
      bs: {
        ...weakData[2].bs,
        separationScore: 58,
      },
    };

    const weak = buildValuationCommandCenter({
      data: weakData,
      config: {
        ...DEFAULT_CONFIG,
        sector_template: "industrials",
        shares_outstanding: 620,
        market_price: 1,
      },
      analysisStatus: productionReadyStatus,
    });

    expect(weak.opportunity.qualityScore).toBeLessThan(strong.opportunity.qualityScore);
    expect(weak.opportunity.requiredMarginOfSafetyPct).toBeGreaterThan(strong.opportunity.requiredMarginOfSafetyPct);
  });
});
