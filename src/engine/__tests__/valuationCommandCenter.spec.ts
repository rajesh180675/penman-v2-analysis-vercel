import { describe, expect, it } from "vitest";
import { buildValuationCommandCenter } from "../valuationCommandCenter";
import { DEFAULT_CONFIG, RecastPeriod, Severity } from "../types";
import { AnalysisStatusSummary } from "../analysisStatus";

function buildHistorySeries(startDate: string, startPrice: number, count: number) {
  const points: Array<{ date: string; close: number }> = [];
  const date = new Date(`${startDate}T00:00:00.000Z`);
  let price = startPrice;
  for (let i = 0; i < count; i += 1) {
    points.unshift({
      date: date.toISOString().slice(0, 10),
      close: Number(price.toFixed(2)),
    });
    date.setUTCDate(date.getUTCDate() - 7);
    price *= i % 9 === 0 ? 0.97 : 1.006;
  }
  return points.sort((left, right) => right.date.localeCompare(left.date));
}

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

  it("builds a historical replay when price history is available", () => {
    const data = [
      mkPeriod(2021, 900, 150, 105, 470, 700),
      mkPeriod(2022, 980, 166, 118, 500, 740),
      mkPeriod(2023, 1060, 185, 132, 545, 790),
      mkPeriod(2024, 1140, 210, 151, 610, 845),
      mkPeriod(2025, 1210, 232, 172, 665, 885),
    ];
    const history = buildHistorySeries("2026-03-30", 1.1, 300);
    const out = buildValuationCommandCenter({
      data,
      config: {
        ...DEFAULT_CONFIG,
        sector_template: "paint",
        shares_outstanding: 620,
        market_price: 1.1,
      },
      marketData: {
        symbol: "ASIANPAINT.BSE",
        provider: "Manual",
        fetchedAt: "2026-03-30T16:00:00.000Z",
        price: 1.1,
        previousClose: 1.08,
        changePct: 0.02,
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
          points: history,
          currentPricePercentile: 0.2,
          low52Week: 0.9,
          high52Week: 1.3,
          distanceFrom52WeekLowPct: 0.22,
          drawdownFrom52WeekHighPct: -0.15,
        },
      },
      analysisStatus: productionReadyStatus,
    });

    expect(out.backtest.available).toBe(true);
    expect(out.backtest.points.length).toBeGreaterThan(0);
    expect(out.checklist.whatMustGoRight.length).toBeGreaterThan(0);
    expect(out.marketContext.expectedReturnSpreadVsRf).not.toBeNull();
  });

  it("caps the signal and exposes provenance when market data is fallback-only", () => {
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
        market_price: 0.8,
      },
      marketData: {
        symbol: "ASIANPAINT.BSE",
        provider: "Manual",
        fetchedAt: "2026-03-30T16:00:00.000Z",
        price: 0.8,
        previousClose: null,
        changePct: null,
        marketCap: null,
        enterpriseValue: null,
        sharesOutstanding: null,
        riskFreeRate: 0.07,
        priceAsOf: null,
        rateAsOf: null,
        freshness: "fallback",
        sourceSummary: "Manual fallback inputs only",
        warnings: ["Using fallback market inputs."],
        history: null,
      },
      analysisStatus: productionReadyStatus,
    });

    expect(["watchlist", "interesting"]).toContain(out.signal.state);
    expect(out.signal.summary).toContain("fallback");
    expect(out.marketContext.freshness).toBe("fallback");
    expect(out.marketContext.sourceSummary).toContain("fallback");
  });

  it("falls back to the prior clean anchor and guards the signal when the latest period is contaminated", () => {
    const data = [
      mkPeriod(2023, 1000, 180, 130, 520, 760),
      mkPeriod(2024, 1100, 205, 150, 590, 820),
      {
        ...mkPeriod(2025, 1210, 232, 172, 665, 885),
        spec_flags: [
          {
            spec_id: "S-5.1",
            severity: Severity.CRITICAL,
            label: "STRUCTURAL_EVENT",
            message: "Dirty surplus event.",
            affects_terminal: true,
            period: "2025-03-31",
          },
          {
            spec_id: "S-5.3",
            severity: Severity.CRITICAL,
            label: "RNOA_OUTLIER_CRITICAL",
            message: "RNOA outlier.",
            affects_terminal: true,
            period: "2025-03-31",
          },
        ],
      },
    ];
    const out = buildValuationCommandCenter({
      data,
      config: {
        ...DEFAULT_CONFIG,
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
        history: null,
      },
      analysisStatus: productionReadyStatus,
    });

    expect(out.valuationReadiness.fallbackUsed).toBe(true);
    expect(out.valuationReadiness.anchorPeriod).toBe("2024-03-31");
    expect(out.marketContext.valuationAnchorPeriod).toBe("2024-03-31");
    expect(out.signal.state).toBe("guarded");
    expect(out.signal.summary).toContain("anchor period 2024-03-31");
  });

  it("keeps conservative scenarios ordered below the base case", () => {
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
        market_price: 0.9,
      },
      marketData: {
        symbol: "ASIANPAINT.BSE",
        provider: "Manual",
        fetchedAt: "2026-03-30T16:00:00.000Z",
        price: 0.9,
        previousClose: 0.92,
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
        history: null,
      },
      analysisStatus: productionReadyStatus,
    });

    const base = out.scenarios.find((scenario) => scenario.key === "base")!;
    const stress = out.scenarios.find((scenario) => scenario.key === "stress")!;
    const panic = out.scenarios.find((scenario) => scenario.key === "historical-panic")!;

    expect(stress.intrinsicPerShare).toBeLessThanOrEqual(base.intrinsicPerShare ?? Number.POSITIVE_INFINITY);
    expect(panic.intrinsicPerShare).toBeLessThanOrEqual(stress.intrinsicPerShare ?? Number.POSITIVE_INFINITY);
  });

  it("leans on multi-year business evidence instead of a one-period spike", () => {
    const data = [
      mkPeriod(2021, 1000, 120, 84, 500, 760),
      mkPeriod(2022, 1040, 126, 88, 530, 790),
      mkPeriod(2023, 1080, 132, 93, 560, 820),
      mkPeriod(2024, 1120, 138, 97, 590, 850),
      {
        ...mkPeriod(2025, 1420, 320, 235, 665, 885),
        ratios: {
          ...mkPeriod(2025, 1420, 320, 235, 665, 885).ratios!,
          Sales_growth: 0.27,
          CoreSalesPM: 320 / 1420,
          PM: 320 / 1420,
          cash_conversion_ratio: 0.49,
          NOA_growth: 0.23,
          SPREAD: 0.19,
          FLEV: 0.72,
        },
        bs: {
          ...mkPeriod(2025, 1420, 320, 235, 665, 885).bs,
          separationScore: 61,
        },
        quality: {
          ...mkPeriod(2025, 1420, 320, 235, 665, 885).quality!,
          piotroski_total: 5,
          altman_zprime: 2.2,
          beneish_mscore: -1.7,
        },
      },
    ];

    const out = buildValuationCommandCenter({
      data,
      config: {
        ...DEFAULT_CONFIG,
        shares_outstanding: 620,
        market_price: 0.75,
      },
      analysisStatus: productionReadyStatus,
    });

    const base = out.scenarios.find((scenario) => scenario.key === "base")!;

    expect(out.businessModel.persistenceScore).toBeLessThan(60);
    expect(out.businessModel.marginDurabilityScore).toBeLessThan(60);
    expect(base.assumptions.salesGrowthYear1).toBeLessThan(0.2);
    expect(base.assumptions.corePmYear1).toBeLessThan(0.2);
    expect(out.businessModel.evidence.some((item) => item.toLowerCase().includes("latest"))).toBe(true);
  });

  it("caps conviction when persistence is weak even if upside looks large", () => {
    const stableData = [
      mkPeriod(2021, 1000, 170, 122, 500, 760),
      mkPeriod(2022, 1060, 182, 131, 540, 800),
      mkPeriod(2023, 1120, 195, 141, 585, 840),
      mkPeriod(2024, 1180, 210, 152, 630, 880),
      mkPeriod(2025, 1240, 226, 164, 680, 920),
    ];
    const weakPersistenceData = [
      {
        ...mkPeriod(2021, 1000, 170, 122, 500, 760),
        ratios: {
          ...mkPeriod(2021, 1000, 170, 122, 500, 760).ratios!,
          cash_conversion_ratio: 0.58,
          SPREAD: 0.06,
          NOA_growth: 0.15,
        },
      },
      {
        ...mkPeriod(2022, 1080, 205, 149, 530, 840),
        ratios: {
          ...mkPeriod(2022, 1080, 205, 149, 530, 840).ratios!,
          cash_conversion_ratio: 0.54,
          SPREAD: 0.07,
          NOA_growth: 0.18,
        },
      },
      {
        ...mkPeriod(2023, 1180, 245, 178, 565, 930),
        ratios: {
          ...mkPeriod(2023, 1180, 245, 178, 565, 930).ratios!,
          cash_conversion_ratio: 0.5,
          SPREAD: 0.08,
          NOA_growth: 0.2,
        },
      },
      {
        ...mkPeriod(2024, 1260, 255, 186, 610, 1020),
        ratios: {
          ...mkPeriod(2024, 1260, 255, 186, 610, 1020).ratios!,
          cash_conversion_ratio: 0.47,
          SPREAD: 0.075,
          NOA_growth: 0.22,
        },
      },
      {
        ...mkPeriod(2025, 1350, 280, 205, 660, 1120),
        ratios: {
          ...mkPeriod(2025, 1350, 280, 205, 660, 1120).ratios!,
          Sales_growth: 0.18,
          CoreSalesPM: 280 / 1350,
          PM: 280 / 1350,
          cash_conversion_ratio: 0.45,
          SPREAD: 0.07,
          NOA_growth: 0.24,
          FLEV: 0.78,
        },
        bs: {
          ...mkPeriod(2025, 1350, 280, 205, 660, 1120).bs,
          separationScore: 60,
        },
        quality: {
          ...mkPeriod(2025, 1350, 280, 205, 660, 1120).quality!,
          piotroski_total: 4,
          altman_zprime: 2.1,
          beneish_mscore: -1.65,
        },
      },
    ];

    const stable = buildValuationCommandCenter({
      data: stableData,
      config: {
        ...DEFAULT_CONFIG,
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
          currentPricePercentile: 0.05,
          low52Week: 0.75,
          high52Week: 2.1,
          distanceFrom52WeekLowPct: 0.06,
          drawdownFrom52WeekHighPct: -0.62,
        },
      },
      analysisStatus: productionReadyStatus,
    });

    const weak = buildValuationCommandCenter({
      data: weakPersistenceData,
      config: {
        ...DEFAULT_CONFIG,
        shares_outstanding: 620,
        market_price: 0.55,
      },
      marketData: {
        symbol: "ASIANPAINT.BSE",
        provider: "Manual",
        fetchedAt: "2026-03-30T16:00:00.000Z",
        price: 0.55,
        previousClose: 0.57,
        changePct: -0.03,
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
          low52Week: 0.5,
          high52Week: 1.9,
          distanceFrom52WeekLowPct: 0.1,
          drawdownFrom52WeekHighPct: -0.7,
        },
      },
      analysisStatus: productionReadyStatus,
    });

    expect(weak.businessModel.persistenceScore).toBeLessThan(stable.businessModel.persistenceScore);
    expect(weak.opportunity.requiredMarginOfSafetyPct).toBeGreaterThan(stable.opportunity.requiredMarginOfSafetyPct);
    expect(["research-only", "starter", "accumulate"]).toContain(weak.opportunity.convictionBucket);
    expect(["watchlist", "interesting", "guarded"]).toContain(weak.signal.state);
    expect(weak.signal.summary.toLowerCase()).toContain("persistence");
    expect(weak.scenarios.find((scenario) => scenario.key === "stress")?.forecastPolicy?.workingCapitalPressure).toBe("high");
    expect(weak.scenarios.find((scenario) => scenario.key === "stress")?.forecastPolicy?.reinvestmentBurden).toBe("heavy");
    expect(weak.opportunity.persistenceNarrative.toLowerCase()).toContain("working-capital");
    expect(weak.checklist.forecastDiscipline.length).toBeGreaterThan(0);
  });
});
