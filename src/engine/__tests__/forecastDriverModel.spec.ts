import { describe, expect, it } from "vitest";
import { buildBusinessModelProfile } from "../forecastingEngine";
import { buildCyclicalNormalization } from "../cyclicalNormalization";
import { buildDriverForecastModel } from "../forecastDriverModel";
import { Ratios, RecastPeriod } from "../types";

function mkLatest(period_end = "2024-03-31"): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000, CSE: 600, MI: 0, FA: 120, FO: 80, OA: 880, OL: 280,
      OL_TradePayables: 100, OL_OtherCurrentLiabilities: 40, OL_ProvisionsCurrent: 0, OL_ProvisionsLongTerm: 0,
      OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0, OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 0,
      NOA: 600, NFO: -40, DTL: 0, PensionObl: 0, OL_ex_DTL: 280, Goodwill: 0,
      CurrentAssets: 300, CurrentLiabilities: 200, Inventory: 80, TradeReceivables: 100, TradePayables: 100,
      PPE: 240, LIFO_reserve: 0, separationScore: 90,
      OA_PPE: 240, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0, OA_Inventory: 80,
      OA_TradeReceivables: 100, OA_DTA: 0, OA_CWIP: 0, OA_Other: 460,
    },
    is: {
      Sales: 900, TaxExpense: 20, taxRate: 0.25, PAT: 120, OCI: 0, TCI: 120, TCI_NCI: 0,
      CNI: 120, FinanceCost: 8, FinanceIncome: 2, FinanceIncomeRung: 1,
      PreferredDividend: 0, NFE: 6, OI: 126, OtherItems: 0, OI_from_sales: 126, MII: 0, COGS: 500,
      operatingCostBridge: {
        materialCost: 500,
        employeeCost: 100,
        depreciation: 20,
        sgaAdvertising: 10,
        sgaLegalProfessional: 5,
        sgaRent: 4,
        sgaFreight: 6,
        sgaRepairs: 5,
        sgaPowerFuel: 8,
        sgaDetailed: 38,
        sgaResidual: 0,
        sgaTotal: 38,
        otherOperatingExpense: 40,
        otherOperatingIncome: 24,
        grossProfit: 400,
        operatingCosts: 198,
        bridgeCoreOI: 226,
        bridgeGapToReportedCoreOI: 100,
        coverageRatio: 0.8,
        driverRatios: {
          materialCostPct: 500 / 900,
          employeeCostPct: 100 / 900,
          depreciationPct: 20 / 900,
          sgaPct: 38 / 900,
          otherOperatingExpensePct: 40 / 900,
          otherOperatingIncomePct: 24 / 900,
          bridgeCoreSalesPm: 226 / 900,
        },
      },
    },
    cu: { UOI: 0, CoreOI: 126, UFE: 0, CoreNFE: 6, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: {
      CFO: 140, Capex: 35, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 2, DividendReceived: 1, FCF_accounting: 91, FCF_cash: 105,
      d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 150,
    },
  };
}

function mkPeriod(period_end: string, overrides: Partial<Ratios>, separationScore = 90, bridgeCoverage = 0.8): RecastPeriod {
  const base = mkLatest(period_end);
  // The forecast reads turnover off the balance sheet (sales over year-end
  // NOA), so a fixture's NOA carries the turnover it states.
  const NOA = overrides.ATO != null ? base.is.Sales / overrides.ATO : base.bs.NOA;
  return {
    ...base,
    bs: { ...base.bs, NOA, separationScore },
    is: {
      ...base.is,
      operatingCostBridge: {
        ...base.is.operatingCostBridge!,
        coverageRatio: bridgeCoverage,
      },
    },
    ratios: {
      ...(base.ratios ?? {} as Ratios),
      Sales_growth: 0.08,
      CoreSalesPM: 0.14,
      PM: 0.14,
      ATO: 1.25,
      SPREAD: 0.08,
      cash_conversion_ratio: 0.82,
      NOA_growth: 0.09,
      FLEV: 0.2,
      ...overrides,
    } as Ratios,
  };
}

describe("buildDriverForecastModel", () => {
  it("builds a persistence-led plan that tightens fragile businesses", () => {
    const data = [
      mkPeriod("2021-03-31", { Sales_growth: 0.05, CoreSalesPM: 0.12, PM: 0.12, ATO: 1.32, cash_conversion_ratio: 0.83, NOA_growth: 0.07, FLEV: 0.2 }),
      mkPeriod("2022-03-31", { Sales_growth: 0.06, CoreSalesPM: 0.125, PM: 0.125, ATO: 1.31, cash_conversion_ratio: 0.81, NOA_growth: 0.08, FLEV: 0.22 }),
      mkPeriod("2023-03-31", { Sales_growth: 0.06, CoreSalesPM: 0.13, PM: 0.13, ATO: 1.29, cash_conversion_ratio: 0.78, NOA_growth: 0.09, FLEV: 0.25 }),
      mkPeriod("2024-03-31", { Sales_growth: 0.24, CoreSalesPM: 0.24, PM: 0.24, ATO: 1.18, cash_conversion_ratio: 0.48, NOA_growth: 0.28, FLEV: 0.78 }, 61, 0.61),
    ];
    const businessModel = buildBusinessModelProfile(data);
    const normalized = buildCyclicalNormalization(data);

    const plan = buildDriverForecastModel({
      data,
      latest: data[data.length - 1],
      businessModel,
      normalized,
      scenarioKey: "base",
      template: {
        normalizedGrowth: 0.09,
        terminalGrowthFloor: 0.03,
        terminalGrowthCap: 0.05,
        growthFadeAlpha: 0.8,
        marginFadeAlpha: 0.9,
        atoFadeAlpha: 0.95,
        companyEvidenceMaxWeight: 0.8,
        growthGuardrailBand: 0.035,
        marginGuardrailBand: 0.04,
        atoGuardrailBand: 0.4,
      },
    } as never);

    expect(plan.persistenceBand).toBe("fragile");
    expect(plan.workingCapitalPressure).toBe("high");
    expect(plan.reinvestmentPosture).toBe("heavy");
    expect(plan.year1.salesGrowth).toBeLessThan(0.2);
    expect(plan.targets.salesGrowth).toBeLessThan(plan.year1.salesGrowth);
    expect(plan.targets.ato).toBeGreaterThan(plan.year1.ato);
    expect(plan.narrative.some((item) => item.toLowerCase().includes("working-capital"))).toBe(true);
  });
});

describe("buildDriverForecastModel — loss-makers", () => {
  it("starts a loss-maker's base margin from its losses, not a +4% floor", () => {
    // Paytm-shaped: core margin −25% for four years. The old floor forecast a
    // 4% profit in year 1 (+29pp of sales above the evidence).
    const data = ["2021", "2022", "2023", "2024"].map((y) =>
      mkPeriod(`${y}-03-31`, { CoreSalesPM: -0.25, PM: -0.25, Sales_growth: 0.2 }));
    const plan = buildDriverForecastModel({
      data,
      latest: data[data.length - 1],
      businessModel: buildBusinessModelProfile(data),
      normalized: buildCyclicalNormalization(data),
      scenarioKey: "base",
      template: {
        normalizedGrowth: 0.09, terminalGrowthFloor: 0.03, terminalGrowthCap: 0.05,
        growthFadeAlpha: 0.8, marginFadeAlpha: 0.9, atoFadeAlpha: 0.95, companyEvidenceMaxWeight: 0.8,
        growthGuardrailBand: 0.035, marginGuardrailBand: 0.04, atoGuardrailBand: 0.4,
      },
    } as never);
    expect(plan.year1.coreMargin).toBeLessThan(0);
  });
});

describe("buildDriverForecastModel — high-margin, asset-heavy businesses", () => {
  it("keeps a utility's own margin and turnover instead of capping them at 20–30% and 0.4×", () => {
    // Powergrid-shaped: after-tax core margin ~46%, asset turnover ~0.2×. The
    // old clamps forced the margin target to ≤ 20% (start ≤ 30%) and turnover
    // to ≥ 0.4×; the walk-forward had Powergrid's margin 20pp low and its CNI
    // 9 ROE points low one year ahead. The band around the company's own
    // history still bounds both.
    const data = ["2021", "2022", "2023", "2024"].map((y) =>
      mkPeriod(`${y}-03-31`, { CoreSalesPM: 0.46, PM: 0.46, ATO: 0.2, Sales_growth: 0.05 }));
    const plan = buildDriverForecastModel({
      data,
      latest: data[data.length - 1],
      businessModel: buildBusinessModelProfile(data),
      normalized: buildCyclicalNormalization(data),
      scenarioKey: "base",
      template: {
        normalizedGrowth: 0.09, terminalGrowthFloor: 0.03, terminalGrowthCap: 0.05,
        growthFadeAlpha: 0.8, marginFadeAlpha: 0.9, atoFadeAlpha: 0.95, companyEvidenceMaxWeight: 0.8,
        growthGuardrailBand: 0.035, marginGuardrailBand: 0.04, atoGuardrailBand: 0.4,
      },
    } as never);
    expect(plan.year1.coreMargin).toBeGreaterThan(0.4);
    expect(plan.targets.coreMargin).toBeGreaterThan(0.4);
    expect(plan.year1.ato).toBeLessThan(0.3);
    expect(plan.targets.ato).toBeLessThan(0.35);
  });
});

describe("buildDriverForecastModel — asset turnover", () => {
  const template = {
    normalizedGrowth: 0.09, terminalGrowthFloor: 0.03, terminalGrowthCap: 0.05,
    growthFadeAlpha: 0.8, marginFadeAlpha: 0.9, atoFadeAlpha: 0.95, companyEvidenceMaxWeight: 0.8,
    growthGuardrailBand: 0.035, marginGuardrailBand: 0.04, atoGuardrailBand: 0.4,
  };
  const planFor = (ato: number, latestAto = ato, scenarioKey = "base") => {
    const data = ["2021", "2022", "2023", "2024"].map((y, i) =>
      mkPeriod(`${y}-03-31`, { CoreSalesPM: 0.1, PM: 0.1, ATO: i === 3 ? latestAto : ato, Sales_growth: 0.1 }));
    return buildDriverForecastModel({
      data,
      latest: data[data.length - 1],
      businessModel: buildBusinessModelProfile(data),
      normalized: buildCyclicalNormalization(data),
      scenarioKey,
      template,
    } as never);
  };

  it("keeps a high-turnover franchise's own turnover instead of capping it at 2.5x", () => {
    // Maruti-shaped: turnover ~5x (NOA ~20% of sales). The 2.5x cap doubled
    // forecast NOA; with leverage held, forecast equity doubled too, and the
    // capital charge drove Maruti's residual-earnings value to −₹1,784/share
    // (below its book) while it earned 50% on NOA. The walk-forward RNOA bias
    // for such firms was −44pp (Maruti), −34pp (Britannia), −27pp (TCS) at t+3.
    const plan = planFor(5);
    expect(plan.year1.ato).toBeGreaterThan(4);
    expect(plan.targets.ato).toBeGreaterThan(4);
  });

  it("starts from the latest year-end turnover, not a blend with the long-run median", () => {
    // L&T-shaped: turnover 0.7x for years (a lending arm's loan book in NOA),
    // 1.7x now. Blending the start with the median put forecast NOA up 42% in
    // one year (₹71k Cr, 15x capex); walk-forward over 204 origins, turnover
    // held at the cutoff predicts NOA a year ahead far better (|log error|
    // 0.142 vs 0.241).
    const plan = planFor(0.7, 1.7);
    expect(plan.year1.ato).toBeCloseTo(1.7, 9);
    expect(plan.targets.ato).toBeLessThan(plan.year1.ato);
  });

  it("measures turnover on year-end NOA, the basis the forecast applies it on", () => {
    // Nestlé-shaped: NOA jumped in the latest year, so turnover on AVERAGE NOA
    // (ratios.ATO, 4.99x) reads above turnover on year-end NOA (3.93x).
    // NOA_f = Sales_f / ato is a year-end figure; the average-basis ratio
    // forecast year-1 NOA 23% below the NOA the company holds.
    const data = ["2021", "2022", "2023", "2024"].map((y, i) => {
      const period = mkPeriod(`${y}-03-31`, { CoreSalesPM: 0.15, PM: 0.15, ATO: 3.93, Sales_growth: 0.1 });
      return i === 3 ? { ...period, ratios: { ...period.ratios!, ATO: 4.99 } } : period;
    });
    const plan = buildDriverForecastModel({
      data,
      latest: data[data.length - 1],
      businessModel: buildBusinessModelProfile(data),
      normalized: buildCyclicalNormalization(data),
      scenarioKey: "base",
      template,
    } as never);
    expect(plan.year1.ato).toBeCloseTo(3.93, 9);
  });

  it("leaves near-zero-NOA years out of the long-run turnover", () => {
    // HUL-shaped: NOA a few % of sales for years (sales 40x NOA), then a normal
    // 1.6x after an acquisition. Counting those years put the median at the
    // 8x ceiling, and the fade toward it drove forecast PPE below zero.
    const data = ["2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024"].map((y, i) =>
      mkPeriod(`${y}-03-31`, { CoreSalesPM: 0.17, PM: 0.17, ATO: i < 4 ? 40 : i === 7 ? 1.7 : 1.6, Sales_growth: 0.08 }));
    const plan = buildDriverForecastModel({
      data,
      latest: data[data.length - 1],
      businessModel: buildBusinessModelProfile(data),
      normalized: buildCyclicalNormalization(data),
      scenarioKey: "base",
      template,
    } as never);
    expect(plan.year1.ato).toBeCloseTo(1.7, 9);
    expect(plan.targets.ato).toBeLessThan(2.1);
  });

  it("treats a negative turnover (negative NOA) as unknown rather than flooring it", () => {
    // Net operating liabilities (HUL before FY21) give a negative ratio; the
    // floor would turn it into a forecast NOA of 10x sales.
    const plan = planFor(1.5, -8);
    expect(plan.year1.ato).toBeGreaterThan(1);
    expect(plan.year1.ato).toBeLessThan(2);
  });

  it.each([5, 0.2])("keeps the named scenarios' turnover ordered around base at %sx", (ato) => {
    // Lower turnover means more NOA per rupee of sales, so a heavier capital
    // charge. When only base was uncapped, bull kept a 2.8x ceiling — half a
    // 5x firm's turnover, doubling its NOA below base — and stress kept a 0.35x
    // floor, giving a 0.2x utility less NOA under stress than under base.
    const [stress, base, bull, panic] = (["stress", "base", "bull", "historical-panic"] as const)
      .map((key) => planFor(ato, ato, key).year1.ato);
    expect(stress).toBeLessThanOrEqual(base!);
    expect(panic).toBeLessThanOrEqual(base!);
    expect(bull).toBeGreaterThanOrEqual(base! * 0.99);
  });
});

describe("buildDriverForecastModel — scenario margin ordering", () => {
  const template = {
    normalizedGrowth: 0.09, terminalGrowthFloor: 0.03, terminalGrowthCap: 0.05,
    growthFadeAlpha: 0.8, marginFadeAlpha: 0.9, atoFadeAlpha: 0.95, companyEvidenceMaxWeight: 0.8,
    growthGuardrailBand: 0.035, marginGuardrailBand: 0.04, atoGuardrailBand: 0.4,
  };
  const startMargin = (pm: number, scenarioKey: string) => {
    const data = ["2021", "2022", "2023", "2024"].map((y) =>
      mkPeriod(`${y}-03-31`, { CoreSalesPM: pm, PM: pm, ATO: 1.2, Sales_growth: 0.1 }));
    return buildDriverForecastModel({
      data,
      latest: data[data.length - 1],
      businessModel: buildBusinessModelProfile(data),
      normalized: buildCyclicalNormalization(data),
      scenarioKey,
      template,
    } as never).year1.coreMargin;
  };

  it.each([0.46, 0.14, -0.2])("keeps stress ≤ base ≤ bull on year-1 margin at %s", (pm) => {
    // #344 let base reach a 46% utility margin (Powergrid) and a loss-maker's
    // own losses, but bull kept a 34% ceiling and stress a +2% floor — so bull
    // earned less than base on a utility and stress more than base on a
    // loss-maker, which the run's scenario-ordering gate blocks on.
    const [stress, base, bull, panic] = (["stress", "base", "bull", "historical-panic"] as const)
      .map((key) => startMargin(pm, key));
    expect(stress).toBeLessThanOrEqual(base!);
    expect(panic).toBeLessThanOrEqual(base!);
    expect(bull).toBeGreaterThanOrEqual(base!);
  });
});


describe("buildDriverForecastModel — core margin", () => {
  const template = {
    normalizedGrowth: 0.09, terminalGrowthFloor: 0.03, terminalGrowthCap: 0.05,
    growthFadeAlpha: 0.8, marginFadeAlpha: 0.9, atoFadeAlpha: 0.95, companyEvidenceMaxWeight: 0.8,
    growthGuardrailBand: 0.035, marginGuardrailBand: 0.04, atoGuardrailBand: 0.4,
  };
  const planFor = (history: number, latest: number) => {
    const data = ["2021", "2022", "2023", "2024"].map((y, i) =>
      mkPeriod(`${y}-03-31`, { CoreSalesPM: i === 3 ? latest : history, PM: i === 3 ? latest : history, ATO: 1.2, Sales_growth: 0.1 }));
    return buildDriverForecastModel({
      data,
      latest: data[data.length - 1],
      businessModel: buildBusinessModelProfile(data),
      normalized: buildCyclicalNormalization(data),
      scenarioKey: "base",
      template,
    } as never);
  };

  it("starts the margin at the latest year's, not a blend with the median", () => {
    // The fade toward the median already reverts it; blending the start too
    // reverted it twice, and on the walk-forward the latest start cut one-year
    // core-OI margin error 2.44 → 1.99 points of sales (trimmed).
    expect(planFor(0.12, 0.15).year1.coreMargin).toBeCloseTo(0.15, 9);
  });

  it("targets the company's own median margin, without a persistence haircut", () => {
    // 0.85 + 0.2 × persistence put the target below the company's history for
    // any persistence under 75, and the fade carried it into every later year:
    // the forecast margin ran a median 1.4 points of sales low three years out.
    // Fragile fixture (as above): median core margin 12.5% before the spike.
    const data = [
      mkPeriod("2021-03-31", { Sales_growth: 0.05, CoreSalesPM: 0.12, PM: 0.12, ATO: 1.32, cash_conversion_ratio: 0.83, NOA_growth: 0.07, FLEV: 0.2 }),
      mkPeriod("2022-03-31", { Sales_growth: 0.06, CoreSalesPM: 0.125, PM: 0.125, ATO: 1.31, cash_conversion_ratio: 0.81, NOA_growth: 0.08, FLEV: 0.22 }),
      mkPeriod("2023-03-31", { Sales_growth: 0.06, CoreSalesPM: 0.13, PM: 0.13, ATO: 1.29, cash_conversion_ratio: 0.78, NOA_growth: 0.09, FLEV: 0.25 }),
      mkPeriod("2024-03-31", { Sales_growth: 0.24, CoreSalesPM: 0.24, PM: 0.24, ATO: 1.18, cash_conversion_ratio: 0.48, NOA_growth: 0.28, FLEV: 0.78 }, 61, 0.61),
    ];
    const plan = buildDriverForecastModel({
      data,
      latest: data[data.length - 1],
      businessModel: buildBusinessModelProfile(data),
      normalized: buildCyclicalNormalization(data),
      scenarioKey: "base",
      template,
    } as never);
    expect(plan.persistenceBand).toBe("fragile");
    expect(plan.targets.coreMargin).toBeCloseTo(0.125, 9);
  });
});
