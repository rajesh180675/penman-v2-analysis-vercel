import { describe, expect, it } from "vitest";
import { buildBusinessModelProfile } from "../forecastingEngine";
import { buildCyclicalNormalization } from "../cyclicalNormalization";
import { buildDriverForecastModel } from "../forecastDriverModel";
import { buildTerminalEconomics } from "../terminalEconomics";
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

function makeFragileHistory(): RecastPeriod[] {
  const mkPeriod = (period_end: string, overrides: Partial<Ratios>, separationScore = 90, bridgeCoverage = 0.8): RecastPeriod => {
    const base = mkLatest(period_end);
    return {
      ...base,
      bs: { ...base.bs, separationScore },
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
  };

  return [
    mkPeriod("2021-03-31", { Sales_growth: 0.05, CoreSalesPM: 0.12, PM: 0.12, ATO: 1.32, cash_conversion_ratio: 0.83, NOA_growth: 0.07, FLEV: 0.2 }),
    mkPeriod("2022-03-31", { Sales_growth: 0.06, CoreSalesPM: 0.125, PM: 0.125, ATO: 1.31, cash_conversion_ratio: 0.81, NOA_growth: 0.08, FLEV: 0.22 }),
    mkPeriod("2023-03-31", { Sales_growth: 0.06, CoreSalesPM: 0.13, PM: 0.13, ATO: 1.29, cash_conversion_ratio: 0.78, NOA_growth: 0.09, FLEV: 0.25 }),
    mkPeriod("2024-03-31", { Sales_growth: 0.24, CoreSalesPM: 0.24, PM: 0.24, ATO: 1.18, cash_conversion_ratio: 0.48, NOA_growth: 0.28, FLEV: 0.78 }, 61, 0.61),
  ];
}

describe("buildTerminalEconomics", () => {
  it("compresses terminal posture when persistence and reinvestment quality are weak", () => {
    const data = makeFragileHistory();
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
      },
    } as never);

    const terminal = buildTerminalEconomics({
      latest: data[data.length - 1],
      normalized,
      businessModel,
      driverPlan: plan,
      requiredReturn: 0.1,
      terminalGrowthFloor: 0.03,
      terminalGrowthCap: 0.05,
    } as never);

    expect(terminal.competitionPressure).toBe("high");
    expect(terminal.fadeYears).toBeLessThanOrEqual(4);
    expect(terminal.terminalGrowth).toBeLessThanOrEqual(0.035);
    expect(terminal.rationale.some((item) => item.toLowerCase().includes("reinvestment"))).toBe(true);
  });
});
