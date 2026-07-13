import { describe, expect, it } from "vitest";
import { computeValuation } from "../../PenmanNissimEngine";
import { DEFAULT_CONFIG } from "../../types";
import { CroreShares } from "../../types/units";
import {
  adaptForecastCaseToLegacyValuation,
  buildIndustrialForecast,
  validateIndustrialScenarioOrdering,
  type IndustrialForecastAnchor,
  type IndustrialForecastCase,
  type IndustrialForecastRequest,
  type IndustrialForecastYearDrivers,
  type IndustrialScenarioKey,
  type IndustrialTerminalAssumptions,
} from "..";

const ANCHOR: IndustrialForecastAnchor = {
  anchorId: "anchor:2026-03-31",
  periodEnd: "2026-03-31",
  revenue: 2_200,
  balanceSheet: {
    cash: 100,
    otherFinancialAssets: 50,
    workingCapitalAssets: 300,
    ppe: 700,
    rightOfUseAssets: 100,
    intangibles: 100,
    goodwill: 50,
    otherOperatingAssets: 100,
    operatingLiabilities: 250,
    debt: 300,
    leaseLiabilities: 100,
    otherFinancialObligations: 50,
    contributedCapital: 300,
    retainedEarnings: 450,
    accumulatedOci: 0,
    commonEquity: 750,
    minorityInterest: 50,
  },
  shares: { endPeriod: 100, diluted: 102 },
  evidenceRefs: ["evidence:anchor"],
};

const BASE_DRIVER: Omit<IndustrialForecastYearDrivers, "yearOffset"> = {
  revenueGrowth: 0.08,
  operatingMargin: 0.15,
  assetTurnover: 2,
  taxRate: 0.25,
  workingCapitalAssetPctRevenue: 0.14,
  operatingLiabilityPctRevenue: 0.11,
  otherOperatingAssetPctRevenue: 0.045,
  depreciationRate: 0.10,
  amortizationRate: 0.10,
  intangibleInvestmentPctRevenue: 0.01,
  rightOfUseAssetAdditions: 10,
  rightOfUseDepreciationRate: 0.10,
  costOfDebtPretax: 0.08,
  financialAssetYieldPretax: 0.03,
  debtIssuance: 0,
  debtRepayment: 0,
  leaseLiabilityAdditions: 10,
  leasePrincipalRepayment: 0,
  otherFinancialObligationChange: 0,
  dividendPayoutRatio: 0.30,
  buybacks: 0,
  shareIssueProceeds: 0,
  sharesIssued: 0,
  sharesRepurchased: 0,
  dilutionOverhangShares: 2,
  financialAssetPurchases: 0,
  financialAssetSales: 0,
  ownerOci: 0,
  minorityOci: 0,
  financialAssetFairValueChange: 0,
  minorityIncomeShare: 0,
  minorityContributions: 0,
  minorityDistributions: 0,
};

const BASE_TERMINAL: IndustrialTerminalAssumptions = {
  growth: 0.03,
  roic: 0.15,
  reinvestmentRate: 0.20,
  ke: 0.12,
  kw: 0.10,
  minimumDiscountGrowthSpread: 0.005,
};

function makeRequest(options: {
  caseId?: string;
  scenarioKey?: IndustrialScenarioKey;
  revenueGrowth?: number;
  operatingMargin?: number;
  horizon?: number;
  terminal?: IndustrialTerminalAssumptions;
  probability?: number | null;
  probabilityStatus?: IndustrialForecastRequest["probabilityStatus"];
  probabilityRationale?: string | null;
  probabilityEvidenceRefs?: readonly string[];
} = {}): IndustrialForecastRequest {
  const horizon = options.horizon ?? 3;
  return {
    caseId: options.caseId ?? "base-case",
    label: options.caseId ?? "Base case",
    scenarioKey: options.scenarioKey ?? "base",
    analysisWindowId: "window:clean-history",
    assumptionIds: ["assumption:growth", "assumption:margin"],
    anchor: ANCHOR,
    drivers: Array.from({ length: horizon }, (_, index) => ({
      ...BASE_DRIVER,
      yearOffset: index + 1,
      revenueGrowth: options.revenueGrowth ?? BASE_DRIVER.revenueGrowth,
      operatingMargin: options.operatingMargin ?? BASE_DRIVER.operatingMargin,
    })),
    terminal: options.terminal ?? BASE_TERMINAL,
    probability: options.probability ?? null,
    probabilityStatus: options.probabilityStatus ?? "not-assigned",
    probabilityEvidenceRefs: options.probabilityEvidenceRefs ?? [],
    probabilityRationale: options.probabilityRationale ?? null,
  };
}

function requireComputed(request: IndustrialForecastRequest): IndustrialForecastCase {
  const result = buildIndustrialForecast(request);
  expect(result.status, result.status === "blocked" ? result.reasonCodes.join("\n") : undefined).toBe("computed");
  if (result.status !== "computed") throw new Error(result.reasonCodes.join(", "));
  return result.forecastCase;
}

describe("Industrial ForecastState", () => {
  it("rolls balanced statements and all core identities for every projected year", () => {
    const forecastCase = requireComputed(makeRequest());
    expect(forecastCase.validation.status).toBe("passed");
    expect(forecastCase.projected).toHaveLength(3);
    for (const state of forecastCase.projected) {
      const bs = state.balanceSheet;
      const cf = state.cashFlow;
      expect(bs.totalAssets).toBeCloseTo(bs.totalLiabilitiesAndEquity, 8);
      expect(cf.endingCash).toBeCloseTo(cf.openingCash + cf.netCashMovement, 8);
      expect(bs.noa).toBeCloseTo(bs.operatingAssets.total - bs.operatingLiabilities, 8);
      expect(bs.nfo).toBeCloseTo(bs.financialObligations.total - bs.financialAssets.total, 8);
      expect(bs.noa).toBeCloseTo(bs.commonEquity.total + bs.minorityInterest + bs.nfo, 8);
      expect(state.incomeStatement.operatingProfitPretax).toBeCloseTo(
        state.incomeStatement.revenue * state.assumptions.operatingMargin,
        8,
      );
      expect(state.incomeStatement.revenue).toBeCloseTo(bs.noa * state.assumptions.assetTurnover, 8);
      expect(cf.fcff).toBeCloseTo(state.incomeStatement.operatingIncomeAfterTax - state.diagnostics.deltaNoa, 8);
    }
    expect(forecastCase.terminal.growthImpliedByReinvestment).toBeCloseTo(0.03, 10);
    expect(forecastCase.terminal.consistencyResidual).toBeCloseTo(0, 10);
  });

  it("creates independent immutable statement objects and a safe narrow legacy adapter", () => {
    const forecastCase = requireComputed(makeRequest());
    const [first, second] = forecastCase.projected;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.cashFlow).not.toBe(second!.cashFlow);
    expect(first!.balanceSheet).not.toBe(second!.balanceSheet);
    expect(first!.assumptions).not.toBe(second!.assumptions);
    expect(Object.isFrozen(first!.cashFlow)).toBe(true);
    expect("cf" in first!).toBe(false);

    const legacy = adaptForecastCaseToLegacyValuation({
      periodEnd: ANCHOR.periodEnd,
      commonEquity: ANCHOR.balanceSheet.commonEquity,
      noa: 1_100,
      nfo: 300,
      minorityInterest: ANCHOR.balanceSheet.minorityInterest,
      commonNetIncome: 180,
      operatingIncomeAfterTax: 220,
      dividendPaid: 50,
      netOwnerDistribution: 50,
      rnoa: 0.20,
      separationScore: 100,
    }, forecastCase);
    expect(legacy).toHaveLength(4);
    expect(legacy[1]!.cf).not.toBe(legacy[2]!.cf);
    expect(legacy[1]!.cf).not.toBe(first!.cashFlow);
    expect(Object.isFrozen(legacy[1]!.cf)).toBe(true);

    const valuation = computeValuation(
      legacy,
      BASE_TERMINAL.ke,
      BASE_TERMINAL.kw,
      BASE_TERMINAL.growth,
      { ...DEFAULT_CONFIG, shares_outstanding: CroreShares(100) },
    );
    expect(valuation.reSeries).toHaveLength(3);
    expect(valuation.V_RE_CV3).not.toBeNull();
  });

  it("fails closed on invalid terminal spread or reinvestment economics", () => {
    const invalidSpread = buildIndustrialForecast(makeRequest({
      terminal: { ...BASE_TERMINAL, growth: 0.10, reinvestmentRate: 2 / 3 },
    }));
    expect(invalidSpread.status).toBe("blocked");
    if (invalidSpread.status === "blocked") {
      expect(invalidSpread.reasonCodes).toContain("terminal.kw-growth-spread");
    }

    const invalidReinvestment = buildIndustrialForecast(makeRequest({
      terminal: { ...BASE_TERMINAL, reinvestmentRate: 0.10 },
    }));
    expect(invalidReinvestment.status).toBe("blocked");
    if (invalidReinvestment.status === "blocked") {
      expect(invalidReinvestment.reasonCodes).toContain("terminal.growth-reinvestment-roic");
    }
  });

  it("blocks a missing required driver instead of inheriting a historical value", () => {
    const request = makeRequest();
    const missing = { ...request.drivers[0] } as unknown as Record<string, unknown>;
    delete missing.assetTurnover;
    const result = buildIndustrialForecast({
      ...request,
      drivers: [missing as unknown as IndustrialForecastYearDrivers, ...request.drivers.slice(1)],
    });
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reasonCodes).toContain("driver.required.1.assetTurnover");
      expect(result.projected).toEqual([]);
    }
  });

  it("enforces probability status rather than presenting heuristic weights as calibrated", () => {
    const unassigned = requireComputed(makeRequest());
    expect(unassigned.probabilityStatus).toBe("not-assigned");
    expect(unassigned.probability).toBeNull();

    const missingRationale = buildIndustrialForecast(makeRequest({
      probability: 0.5,
      probabilityStatus: "heuristic",
    }));
    expect(missingRationale.status).toBe("blocked");

    const calibrated = requireComputed(makeRequest({
      probability: 0.5,
      probabilityStatus: "calibrated",
      probabilityEvidenceRefs: ["calibration:rolling-origin-v1"],
    }));
    expect(calibrated.probability).toBe(0.5);
    expect(calibrated.probabilityStatus).toBe("calibrated");
  });

  it("is monotonic under stronger growth/margin assumptions and validates named-case ordering", () => {
    const stress = requireComputed(makeRequest({
      caseId: "stress",
      scenarioKey: "stress",
      revenueGrowth: 0.03,
      operatingMargin: 0.12,
      terminal: { ...BASE_TERMINAL, growth: 0.02, roic: 0.10, reinvestmentRate: 0.20, ke: 0.14, kw: 0.12 },
    }));
    const base = requireComputed(makeRequest({
      caseId: "base",
      scenarioKey: "base",
    }));
    const bull = requireComputed(makeRequest({
      caseId: "bull",
      scenarioKey: "bull",
      revenueGrowth: 0.13,
      operatingMargin: 0.18,
      terminal: { ...BASE_TERMINAL, growth: 0.04, roic: 0.20, reinvestmentRate: 0.20, ke: 0.11, kw: 0.09 },
    }));

    for (let index = 0; index < base.projected.length; index += 1) {
      expect(stress.projected[index]!.incomeStatement.revenue)
        .toBeLessThan(base.projected[index]!.incomeStatement.revenue);
      expect(base.projected[index]!.incomeStatement.revenue)
        .toBeLessThan(bull.projected[index]!.incomeStatement.revenue);
      expect(stress.projected[index]!.incomeStatement.operatingIncomeAfterTax)
        .toBeLessThan(base.projected[index]!.incomeStatement.operatingIncomeAfterTax);
      expect(base.projected[index]!.incomeStatement.operatingIncomeAfterTax)
        .toBeLessThan(bull.projected[index]!.incomeStatement.operatingIncomeAfterTax);
    }
    expect(validateIndustrialScenarioOrdering([bull, stress, base]).status).toBe("passed");

    const repeated = requireComputed(makeRequest({ caseId: "base-repeat" }));
    expect(repeated.projected.map((state) => state.incomeStatement.revenue))
      .toEqual(base.projected.map((state) => state.incomeStatement.revenue));
  });
});
