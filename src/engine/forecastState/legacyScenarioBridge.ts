import type { EngineConfig, ForecastScenario, RecastPeriod } from "../types";
import type { IndustrialForecastAnchor, IndustrialForecastRequest, IndustrialForecastResult, IndustrialForecastYearDrivers, IndustrialScenarioKey } from "./contracts";
import { buildIndustrialForecast } from "./engine";

export const LEGACY_FORECAST_STATE_BRIDGE_VERSION = "2026-07-legacy-forecast-state-bridge-v1" as const;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function scenarioKey(name: string): IndustrialScenarioKey {
  if (name === "bear") return "stress";
  if (name === "base") return "base";
  if (name === "bull") return "bull";
  return "custom";
}

function seriesValue(values: readonly number[], index: number): number {
  return values[Math.min(index, values.length - 1)] ?? Number.NaN;
}

function buildAnchor(
  latest: RecastPeriod,
  config: EngineConfig,
  evidenceRefs: readonly string[],
): IndustrialForecastAnchor {
  const bs = latest.bs;
  let remainingOperatingAssets = bs.OA;
  const take = (candidate: number): number => {
    const amount = Math.min(Math.max(candidate, 0), Math.max(remainingOperatingAssets, 0));
    remainingOperatingAssets -= amount;
    return amount;
  };
  const workingCapitalAssets = take(bs.OA_Inventory + bs.OA_TradeReceivables);
  const ppe = take(bs.OA_PPE || bs.PPE);
  const rightOfUseAssets = take(bs.OA_ROU);
  const intangibles = take(bs.OA_OtherIntangibles);
  const goodwill = take(bs.OA_Goodwill || bs.Goodwill);
  const otherOperatingAssets = remainingOperatingAssets;
  const leaseLiabilities = bs.FO_LeaseLiabilities ?? 0;
  const debt = bs.FO_FinancialDebtExLease ?? bs.FO - leaseLiabilities;
  const shares = config.shares_outstanding
    ?? latest.shareCountInput?.weightedAverageDilutedShares
    ?? latest.shareCountInput?.weightedAverageBasicShares
    ?? latest.shareCountInput?.endPeriodShares
    ?? Number.NaN;
  return {
    anchorId: `legacy-recast:${latest.period_end}`,
    periodEnd: latest.period_end,
    revenue: latest.is.Sales,
    balanceSheet: {
      cash: bs.FA,
      otherFinancialAssets: 0,
      workingCapitalAssets,
      ppe,
      rightOfUseAssets,
      intangibles,
      goodwill,
      otherOperatingAssets,
      operatingLiabilities: bs.OL,
      debt,
      leaseLiabilities,
      otherFinancialObligations: 0,
      contributedCapital: bs.CSE,
      retainedEarnings: 0,
      accumulatedOci: 0,
      commonEquity: bs.CSE,
      minorityInterest: bs.MI,
    },
    shares: { endPeriod: Number(shares), diluted: Number(shares) },
    evidenceRefs,
  };
}

function yearDrivers(
  scenario: ForecastScenario,
  latest: RecastPeriod,
  anchor: IndustrialForecastAnchor,
): IndustrialForecastYearDrivers[] {
  const taxRate = clamp(latest.is.taxRate, 0, 1);
  const afterTaxDenominator = Math.max(1 - taxRate, 1e-6);
  const depreciation = latest.is.operatingCostBridge?.depreciation ?? 0;
  const debtBase = Math.max(anchor.balanceSheet.debt + anchor.balanceSheet.leaseLiabilities, 0);
  const debtCost = debtBase > 0 ? clamp(latest.is.FinanceCost / debtBase, 0, 1) : 0;
  const financialAssetYield = anchor.balanceSheet.cash > 0
    ? clamp(latest.is.FinanceIncome / anchor.balanceSheet.cash, 0, 1)
    : 0;
  const payout = latest.is.CNI > 0 ? clamp(latest.cf.DividendPaid / latest.is.CNI, 0, 1) : 0;
  return Array.from({ length: scenario.horizonT }, (_, index): IndustrialForecastYearDrivers => ({
    yearOffset: index + 1,
    revenueGrowth: seriesValue(scenario.drivers.sales_growth, index),
    // Legacy core margin represents after-tax operating income. Convert it
    // explicitly to the ForecastState pre-tax margin contract.
    operatingMargin: seriesValue(scenario.drivers.core_sales_pm, index) / afterTaxDenominator,
    assetTurnover: seriesValue(scenario.drivers.ato, index),
    taxRate,
    workingCapitalAssetPctRevenue: anchor.balanceSheet.workingCapitalAssets / anchor.revenue,
    operatingLiabilityPctRevenue: anchor.balanceSheet.operatingLiabilities / anchor.revenue,
    otherOperatingAssetPctRevenue: anchor.balanceSheet.otherOperatingAssets / anchor.revenue,
    depreciationRate: anchor.balanceSheet.ppe > 0 ? clamp(depreciation / anchor.balanceSheet.ppe, 0, 1) : 0,
    amortizationRate: 0,
    intangibleInvestmentPctRevenue: 0,
    rightOfUseAssetAdditions: 0,
    rightOfUseDepreciationRate: 0,
    costOfDebtPretax: debtCost,
    financialAssetYieldPretax: financialAssetYield,
    debtIssuance: 0,
    debtRepayment: 0,
    leaseLiabilityAdditions: 0,
    leasePrincipalRepayment: 0,
    otherFinancialObligationChange: 0,
    dividendPayoutRatio: payout,
    buybacks: 0,
    shareIssueProceeds: 0,
    sharesIssued: 0,
    sharesRepurchased: 0,
    dilutionOverhangShares: 0,
    financialAssetPurchases: 0,
    financialAssetSales: 0,
    ownerOci: 0,
    minorityOci: 0,
    financialAssetFairValueChange: 0,
    minorityIncomeShare: 0,
    minorityContributions: 0,
    minorityDistributions: 0,
  }));
}

/** Convert a legacy named scenario into the balanced ForecastState contract. */
export function buildIndustrialForecastFromLegacyScenario(args: {
  readonly caseId: string;
  readonly label: string;
  readonly scenario: ForecastScenario;
  readonly latest: RecastPeriod;
  readonly config: EngineConfig;
  readonly analysisWindowId: string;
  readonly assumptionIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly probabilityStatus: "heuristic" | "not-assigned";
  readonly probabilityRationale: string | null;
}): IndustrialForecastResult {
  const anchor = buildAnchor(args.latest, args.config, args.evidenceRefs);
  const drivers = yearDrivers(args.scenario, args.latest, anchor);
  const lastIndex = Math.max(args.scenario.horizonT - 1, 0);
  const terminalAfterTaxMargin = seriesValue(args.scenario.drivers.core_sales_pm, lastIndex);
  const terminalAssetTurnover = seriesValue(args.scenario.drivers.ato, lastIndex);
  const terminalRoic = terminalAfterTaxMargin * terminalAssetTurnover;
  const terminalGrowth = args.scenario.drivers.g_terminal;
  const request: IndustrialForecastRequest = {
    caseId: args.caseId,
    label: args.label,
    scenarioKey: scenarioKey(args.scenario.name),
    analysisWindowId: args.analysisWindowId,
    assumptionIds: args.assumptionIds,
    anchor,
    drivers,
    terminal: {
      growth: terminalGrowth,
      roic: terminalRoic,
      reinvestmentRate: terminalRoic > 0 ? terminalGrowth / terminalRoic : Number.NaN,
      ke: args.scenario.drivers.ke,
      kw: args.scenario.drivers.kw,
      minimumDiscountGrowthSpread: 0.005,
    },
    probability: args.probabilityStatus === "heuristic" ? args.scenario.probability : null,
    probabilityStatus: args.probabilityStatus,
    probabilityEvidenceRefs: [],
    probabilityRationale: args.probabilityRationale,
  };
  return buildIndustrialForecast(request);
}
