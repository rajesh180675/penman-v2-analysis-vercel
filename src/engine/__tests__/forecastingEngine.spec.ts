import { describe, expect, it } from "vitest";
import { applyDriverSensitivityToScenario, buildBusinessModelProfile, buildPersistenceForecastScenarioSet, buildScenario, buildValuationPeriodsFromForecast, derivePersistenceForecastScenario } from "../forecastingEngine";
import { ForecastPeriod, ForecastScenario, Ratios, RecastPeriod } from "../types";

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

function mkForecast(idx: number): ForecastPeriod {
  return {
    year_offset: idx + 1,
    period_label: `FY${2025 + idx}E`,
    sales_growth_assumption: 0.1,
    core_sales_pm_assumption: 0.14,
    ato_assumption: 1.1,
    flev_assumption: 0.2,
    nbc_assumption: 0.04,
    Sales_f: 1000 + idx * 50,
    NOA_f: 700 + idx * 25,
    OI_f: 140 + idx * 10,
    NFE_f: 20 + idx * 2,
    CNI_f: 120 + idx * 8,
    CSE_f: 620 + idx * 18,
    NFO_f: 80 + idx * 7,
    ΔNOA_f: 25,
    FCF_f: 100,
    RE_f: 30,
    ReOI_f: 28,
    source: "fade",
  };
}

describe("buildValuationPeriodsFromForecast", () => {
  it("maps forecast periods into valuation-ready recast periods", () => {
    const latest = mkLatest("2024-03-31");
    const forecasts = [mkForecast(0), mkForecast(1)];

    const out = buildValuationPeriodsFromForecast(latest, forecasts);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(latest);

    expect(out[1]!.period_end).toBe("2025-03-31");
    expect(out[1]!.bs.CSE).toBe(forecasts[0]!.CSE_f);
    expect(out[1]!.bs.NOA).toBe(forecasts[0]!.NOA_f);
    expect(out[1]!.bs.NFO).toBe(forecasts[0]!.NOA_f - forecasts[0]!.CSE_f - latest.bs.MI);
    expect(out[1]!.is.OI).toBe(forecasts[0]!.OI_f);
    expect(out[1]!.is.CNI).toBe(forecasts[0]!.CNI_f);
    expect(out[1]!.cf.d_t).toBe(forecasts[0]!.CNI_f - (forecasts[0]!.CSE_f - latest.bs.CSE));
    expect(out[1]!.cf).not.toBe(latest.cf);
    expect("Sales" in out[1]!.is).toBe(false);
    expect("cu" in out[1]!).toBe(false);

    expect(out[2]!.period_end).toBe("2026-03-31");
  });

  it("throws for malformed latest period_end year", () => {
    const latest = mkLatest("bad-date");
    expect(() => buildValuationPeriodsFromForecast(latest, [mkForecast(0)])).toThrow(
      "Invalid period_end year in latestPeriod: bad-date",
    );
  });

  it("fails closed instead of publishing non-finite forecast valuation inputs", () => {
    const latest = mkLatest();
    const forecast = { ...mkForecast(0), OI_f: Number.NaN };

    expect(() => buildValuationPeriodsFromForecast(latest, [forecast])).toThrow(
      "Forecast period 1 contains a non-finite valuation input.",
    );
  });
});

describe("applyDriverSensitivityToScenario", () => {
  it("scales operational driver arrays and changes built scenario outputs", () => {
    const latest = mkLatest("2024-03-31");
    const baseScenario: ForecastScenario = {
      name: "base",
      probability: 1,
      horizonT: 2,
      drivers: {
        sales_growth: [0.10, 0.10],
        core_sales_pm: [0.12, 0.12],
        ato: [1.20, 1.20],
        flev: [0.2, 0.2],
        nbc: [0.04, 0.04],
        g_terminal: 0.05,
        ke: 0.12,
        kw: 0.10,
      },
    };

    const scaled = applyDriverSensitivityToScenario(
      baseScenario,
      { core_pm: 0.12, ato: 1.20, sales_growth: 0.10 },
      { core_pm: 0.15, ato: 1.44, sales_growth: 0.12 },
    );

    expect(scaled.drivers.core_sales_pm[0]).toBeCloseTo(0.15, 8);
    expect(scaled.drivers.ato[0]).toBeCloseTo(1.44, 8);
    expect(scaled.drivers.sales_growth[0]).toBeCloseTo(0.12, 8);

    const baseBuilt = buildScenario(baseScenario, latest);
    const scaledBuilt = buildScenario(scaled, latest);
    expect(scaledBuilt[0]!.Sales_f).toBeGreaterThan(baseBuilt[0]!.Sales_f);
    expect(scaledBuilt[0]!.OI_f).toBeGreaterThan(baseBuilt[0]!.OI_f);
    expect(scaledBuilt[0]!.NOA_f).toBeLessThan(baseBuilt[0]!.NOA_f);
  });
});

describe("derivePersistenceForecastScenario", () => {
  it("leans away from one-period spikes when persistence is weak", () => {
    const data: RecastPeriod[] = [
      {
        ...mkLatest("2021-03-31"),
        ratios: {
          ...(mkLatest("2021-03-31").ratios ?? {} as Ratios),
          Sales_growth: 0.05, CoreSalesPM: 0.12, PM: 0.12, ATO: 1.35, SPREAD: 0.08, cash_conversion_ratio: 0.82, NOA_growth: 0.07, FLEV: 0.2,
        } as Ratios,
      },
      {
        ...mkLatest("2022-03-31"),
        ratios: {
          ...(mkLatest("2022-03-31").ratios ?? {} as Ratios),
          Sales_growth: 0.06, CoreSalesPM: 0.125, PM: 0.125, ATO: 1.33, SPREAD: 0.08, cash_conversion_ratio: 0.8, NOA_growth: 0.08, FLEV: 0.22,
        } as Ratios,
      },
      {
        ...mkLatest("2023-03-31"),
        ratios: {
          ...(mkLatest("2023-03-31").ratios ?? {} as Ratios),
          Sales_growth: 0.06, CoreSalesPM: 0.13, PM: 0.13, ATO: 1.31, SPREAD: 0.08, cash_conversion_ratio: 0.78, NOA_growth: 0.09, FLEV: 0.25,
        } as Ratios,
      },
      {
        ...mkLatest("2024-03-31"),
        bs: { ...mkLatest("2024-03-31").bs, separationScore: 61 },
        ratios: {
          ...(mkLatest("2024-03-31").ratios ?? {} as Ratios),
          Sales_growth: 0.24, CoreSalesPM: 0.24, PM: 0.24, ATO: 1.22, SPREAD: 0.07, cash_conversion_ratio: 0.48, NOA_growth: 0.27, FLEV: 0.78,
        } as Ratios,
      },
    ];

    const businessModel = buildBusinessModelProfile(data);
    const scenario = derivePersistenceForecastScenario({
      scenarioKey: "base",
      latest: data[data.length - 1]!,
      businessModel,
      horizon: 5,
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
      riskInputs: { ke: 0.12, kw: 0.1, riskFreeRate: 0.07 },
    });

    expect(businessModel.persistenceScore).toBeLessThan(45);
    expect(scenario.forecastPolicy?.companyEvidenceWeight).toBeLessThanOrEqual(0.5);
    expect(scenario.forecastPolicy?.workingCapitalPressure).toBe("high");
    expect(scenario.forecastPolicy?.reinvestmentBurden).toBe("heavy");
    expect(scenario.forecastPolicy?.balanceSheetFlexibility).toBe("tight");
    expect(scenario.drivers.sales_growth[0]).toBeLessThan(0.2);
    expect(scenario.drivers.core_sales_pm[0]).toBeLessThan(0.2);
    expect(scenario.drivers.sales_growth[0]).toBeGreaterThan(scenario.drivers.sales_growth[4]!);
    expect((scenario.forecastPolicy?.narrative ?? []).some((item) => item.toLowerCase().includes("working-capital"))).toBe(true);
  });

  it("keeps terminal assumptions aligned with the persistence-led driver plan", () => {
    const data: RecastPeriod[] = [
      {
        ...mkLatest("2021-03-31"),
        ratios: {
          ...(mkLatest("2021-03-31").ratios ?? {} as Ratios),
          Sales_growth: 0.07, CoreSalesPM: 0.14, PM: 0.14, ATO: 1.28, SPREAD: 0.09, cash_conversion_ratio: 0.88, NOA_growth: 0.07, FLEV: 0.18,
        } as Ratios,
      },
      {
        ...mkLatest("2022-03-31"),
        ratios: {
          ...(mkLatest("2022-03-31").ratios ?? {} as Ratios),
          Sales_growth: 0.08, CoreSalesPM: 0.145, PM: 0.145, ATO: 1.29, SPREAD: 0.095, cash_conversion_ratio: 0.9, NOA_growth: 0.08, FLEV: 0.18,
        } as Ratios,
      },
      {
        ...mkLatest("2023-03-31"),
        ratios: {
          ...(mkLatest("2023-03-31").ratios ?? {} as Ratios),
          Sales_growth: 0.08, CoreSalesPM: 0.148, PM: 0.148, ATO: 1.3, SPREAD: 0.1, cash_conversion_ratio: 0.89, NOA_growth: 0.08, FLEV: 0.19,
        } as Ratios,
      },
      {
        ...mkLatest("2024-03-31"),
        ratios: {
          ...(mkLatest("2024-03-31").ratios ?? {} as Ratios),
          Sales_growth: 0.09, CoreSalesPM: 0.15, PM: 0.15, ATO: 1.31, SPREAD: 0.105, cash_conversion_ratio: 0.91, NOA_growth: 0.08, FLEV: 0.2,
        } as Ratios,
      },
    ];

    const businessModel = buildBusinessModelProfile(data);
    const scenario = derivePersistenceForecastScenario({
      scenarioKey: "base",
      periods: data,
      latest: data[data.length - 1]!,
      businessModel,
      horizon: 5,
      template: {
        normalizedGrowth: 0.08,
        terminalGrowthFloor: 0.03,
        terminalGrowthCap: 0.05,
        growthFadeAlpha: 0.82,
        marginFadeAlpha: 0.9,
        atoFadeAlpha: 0.94,
        companyEvidenceMaxWeight: 0.8,
        growthGuardrailBand: 0.03,
        marginGuardrailBand: 0.04,
        atoGuardrailBand: 0.35,
      },
      riskInputs: { ke: 0.12, kw: 0.1, riskFreeRate: 0.07 },
    } as never);

    expect(scenario.forecastPolicy?.terminalAnchorSource).toBe("company-evidence");
    expect(scenario.forecastPolicy?.reinvestmentBurden).toBe("light");
    expect(scenario.forecastPolicy?.terminalFadeYears).toBeGreaterThanOrEqual(5);
    expect(scenario.forecastPolicy?.terminalEconomicsRationale?.length).toBeGreaterThan(0);
    expect(scenario.drivers.sales_growth[0]).toBeGreaterThan(scenario.drivers.sales_growth[4]!);
    expect(scenario.drivers.g_terminal).toBeLessThanOrEqual(0.05);
  });

  it("derives persistence-led scenario probabilities and spread posture", () => {
    const data: RecastPeriod[] = [
      {
        ...mkLatest("2021-03-31"),
        ratios: {
          ...(mkLatest("2021-03-31").ratios ?? {} as Ratios),
          Sales_growth: 0.07, CoreSalesPM: 0.14, PM: 0.14, ATO: 1.28, SPREAD: 0.09, cash_conversion_ratio: 0.89, NOA_growth: 0.07, FLEV: 0.16,
        } as Ratios,
      },
      {
        ...mkLatest("2022-03-31"),
        ratios: {
          ...(mkLatest("2022-03-31").ratios ?? {} as Ratios),
          Sales_growth: 0.08, CoreSalesPM: 0.145, PM: 0.145, ATO: 1.29, SPREAD: 0.095, cash_conversion_ratio: 0.90, NOA_growth: 0.08, FLEV: 0.17,
        } as Ratios,
      },
      {
        ...mkLatest("2023-03-31"),
        ratios: {
          ...(mkLatest("2023-03-31").ratios ?? {} as Ratios),
          Sales_growth: 0.08, CoreSalesPM: 0.148, PM: 0.148, ATO: 1.30, SPREAD: 0.10, cash_conversion_ratio: 0.91, NOA_growth: 0.08, FLEV: 0.18,
        } as Ratios,
      },
      {
        ...mkLatest("2024-03-31"),
        ratios: {
          ...(mkLatest("2024-03-31").ratios ?? {} as Ratios),
          Sales_growth: 0.09, CoreSalesPM: 0.15, PM: 0.15, ATO: 1.31, SPREAD: 0.105, cash_conversion_ratio: 0.92, NOA_growth: 0.08, FLEV: 0.18,
        } as Ratios,
      },
    ];

    const businessModel = buildBusinessModelProfile(data);
    const template = {
      normalizedGrowth: 0.08,
      terminalGrowthFloor: 0.03,
      terminalGrowthCap: 0.05,
      growthFadeAlpha: 0.82,
      marginFadeAlpha: 0.9,
      atoFadeAlpha: 0.94,
      companyEvidenceMaxWeight: 0.8,
      growthGuardrailBand: 0.03,
      marginGuardrailBand: 0.04,
      atoGuardrailBand: 0.35,
    };
    const riskInputs = { ke: 0.12, kw: 0.1, riskFreeRate: 0.07 };
    const scenario = derivePersistenceForecastScenario({
      scenarioKey: "base",
      periods: data,
      latest: data[data.length - 1]!,
      businessModel,
      horizon: 5,
      template,
      riskInputs,
    } as never);

    expect(scenario.probability).toBeGreaterThanOrEqual(0.4);
    expect(scenario.forecastPolicy?.scenarioWeighting?.base).toBeGreaterThan(scenario.forecastPolicy?.scenarioWeighting?.stress ?? 0);
    expect(scenario.forecastPolicy?.scenarioSpread).toBe("contained");
    expect(scenario.forecastPolicy?.scenarioWeightRationale?.length).toBeGreaterThan(0);

    const scenarioSet = buildPersistenceForecastScenarioSet({
      periods: data,
      latest: data[data.length - 1]!,
      businessModel,
      horizon: 5,
      template,
      riskInputs,
    });

    expect(scenarioSet.stress.forecastPolicy?.scenarioWeighting).toEqual(scenarioSet.base.forecastPolicy?.scenarioWeighting);
    expect(scenarioSet.bull.forecastPolicy?.scenarioWeighting).toEqual(scenarioSet.base.forecastPolicy?.scenarioWeighting);
    expect(scenarioSet.historicalPanic.forecastPolicy?.scenarioWeighting).toEqual(scenarioSet.base.forecastPolicy?.scenarioWeighting);
    const weights = scenarioSet.base.forecastPolicy?.scenarioWeighting;
    expect(weights).toBeDefined();
    expect((weights?.stress ?? 0) + (weights?.base ?? 0) + (weights?.bull ?? 0) + (weights?.historicalPanic ?? 0)).toBeCloseTo(1, 6);
  });
});

describe("buildScenario validation", () => {
  it("throws when any required driver series is empty", () => {
    const latest = mkLatest("2024-03-31");
    const malformed: ForecastScenario = {
      name: "base",
      probability: 1,
      horizonT: 2,
      drivers: {
        sales_growth: [],
        core_sales_pm: [0.12, 0.12],
        ato: [1.2, 1.2],
        flev: [0.2, 0.2],
        nbc: [0.04, 0.04],
        g_terminal: 0.05,
        ke: 0.12,
        kw: 0.10,
      },
    };

    expect(() => buildScenario(malformed, latest)).toThrow(
      "Scenario driver 'sales_growth' must be a non-empty array",
    );
  });

  it("throws when driver series contains non-finite value", () => {
    const latest = mkLatest("2024-03-31");
    const malformed: ForecastScenario = {
      name: "base",
      probability: 1,
      horizonT: 1,
      drivers: {
        sales_growth: [Number.NaN],
        core_sales_pm: [0.12],
        ato: [1.2],
        flev: [0.2],
        nbc: [0.04],
        g_terminal: 0.05,
        ke: 0.12,
        kw: 0.10,
      },
    };

    expect(() => buildScenario(malformed, latest)).toThrow(
      "Scenario driver 'sales_growth' contains non-finite value at index 0",
    );
  });

  it("uses detailed operating cost bridge drivers when provided", () => {
    const latest = mkLatest("2024-03-31");
    const scenario: ForecastScenario = {
      name: "base",
      probability: 1,
      horizonT: 1,
      drivers: {
        sales_growth: [0.10],
        core_sales_pm: [0.10],
        ato: [1.2],
        flev: [0.2],
        nbc: [0.04],
        material_cost_ratio: [0.50],
        employee_cost_ratio: [0.10],
        depreciation_ratio: [0.02],
        sga_ratio: [0.04],
        other_opex_ratio: [0.05],
        other_operating_income_ratio: [0.03],
        g_terminal: 0.05,
        ke: 0.12,
        kw: 0.10,
      },
    };

    const [fp] = buildScenario(scenario, latest);

    expect(fp!.bridge_mode).toBe("cost_bridge");
    expect(fp!.MaterialCost_f).toBeCloseTo(495, 6);
    expect(fp!.EmployeeCost_f).toBeCloseTo(99, 6);
    expect(fp!.GrossProfit_f).toBeCloseTo(495, 6);
    expect(fp!.CoreOI_bridge_f).toBeCloseTo(316.8, 6);
    expect(fp!.core_sales_pm_assumption).toBeCloseTo(0.32, 6);
    expect(fp!.OI_f).toBeCloseTo(316.8, 6);
  });
});
