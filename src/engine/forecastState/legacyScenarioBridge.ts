import type { EngineConfig, ForecastScenario, RecastPeriod } from "../types";
import type { IndustrialForecastAnchor, IndustrialForecastRequest, IndustrialForecastResult, IndustrialForecastYearDrivers, IndustrialScenarioKey } from "./contracts";
import { buildIndustrialForecast } from "./engine";

export const LEGACY_FORECAST_STATE_BRIDGE_VERSION = "2026-07-legacy-forecast-state-bridge-v1" as const;

/** Revolver passes: one per year that runs short, with room to spare. */
const MAX_REVOLVER_PASSES = 40;
/** A draw overshoots its shortfall slightly, on top of funding its own interest. */
const REVOLVER_HEADROOM = 0.01;

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
  const bs = anchor.balanceSheet;
  const taxRate = clamp(latest.is.taxRate, 0, 1);
  const afterTaxDenominator = Math.max(1 - taxRate, 1e-6);
  const depreciation = latest.is.operatingCostBridge?.depreciation ?? 0;
  const debtBase = Math.max(bs.debt + bs.leaseLiabilities, 0);
  const financialAssetYield = bs.cash > 0
    ? clamp(latest.is.FinanceIncome / bs.cash, 0, 1)
    : 0;
  const payout = latest.is.CNI > 0 ? clamp(latest.cf.DividendPaid / latest.is.CNI, 0, 1) : 0;
  // The scenario's one turnover driver sets NOA, so each operating balance
  // keeps its anchor share of NOA and a rising turnover shrinks them all in
  // proportion. Holding each at its anchor share of revenue instead put the
  // whole change on PPE, the plug: Titan's inventory alone (48% of sales)
  // exceeded the NOA a 2.6x turnover allows, and PPE went negative. With no
  // positive NOA there are no shares to keep, so the balances hold their
  // share of revenue.
  const noa = bs.workingCapitalAssets + bs.ppe + bs.rightOfUseAssets + bs.intangibles + bs.goodwill
    + bs.otherOperatingAssets - bs.operatingLiabilities;
  const pctOfRevenue = (balance: number, assetTurnover: number) =>
    noa > 0 && assetTurnover > 0 ? balance / noa / assetTurnover : balance / anchor.revenue;
  return Array.from({ length: scenario.horizonT }, (_, index): IndustrialForecastYearDrivers => {
    const assetTurnover = seriesValue(scenario.drivers.ato, index);
    // New borrowing is priced at the opening debt's cost; with no opening
    // debt, at the scenario's own financing rate (after tax, on NFO).
    const nbc = seriesValue(scenario.drivers.nbc, index);
    const debtCost = debtBase > 0
      ? clamp(latest.is.FinanceCost / debtBase, 0, 1)
      : Number.isFinite(nbc) ? clamp(nbc / afterTaxDenominator, 0, 1) : 0;
    return {
    yearOffset: index + 1,
    revenueGrowth: seriesValue(scenario.drivers.sales_growth, index),
    // Legacy core margin represents after-tax operating income. Convert it
    // explicitly to the ForecastState pre-tax margin contract.
    operatingMargin: seriesValue(scenario.drivers.core_sales_pm, index) / afterTaxDenominator,
    assetTurnover,
    taxRate,
    workingCapitalAssetPctRevenue: pctOfRevenue(bs.workingCapitalAssets, assetTurnover),
    operatingLiabilityPctRevenue: pctOfRevenue(bs.operatingLiabilities, assetTurnover),
    otherOperatingAssetPctRevenue: pctOfRevenue(bs.otherOperatingAssets, assetTurnover),
    depreciationRate: bs.ppe > 0 ? clamp(depreciation / bs.ppe, 0, 1) : 0,
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
    };
  });
}

/** Years whose projected cash is negative, earliest first, with the shortfall. */
function cashShortfalls(result: IndustrialForecastResult): { index: number; shortfall: number }[] {
  const projected = result.status === "computed" ? result.forecastCase.projected : result.projected;
  return projected.flatMap((state, index) =>
    state.balanceSheet.financialAssets.cash < 0 ? [{ index, shortfall: -state.balanceSheet.financialAssets.cash }] : []);
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
  const lastIndex = Math.max(args.scenario.horizonT - 1, 0);
  const terminalAfterTaxMargin = seriesValue(args.scenario.drivers.core_sales_pm, lastIndex);
  const terminalAssetTurnover = seriesValue(args.scenario.drivers.ato, lastIndex);
  const terminalRoic = terminalAfterTaxMargin * terminalAssetTurnover;
  const terminalGrowth = args.scenario.drivers.g_terminal;
  const requestFor = (drivers: IndustrialForecastYearDrivers[]): IndustrialForecastRequest => ({
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
  });

  // Debt is held at the anchor and cash absorbs every other flow, so a year
  // whose investment outruns its cash from operations closes with negative
  // cash (NTPC, L&T, Tata Steel) — a balance sheet that cannot exist. A
  // revolving draw funds the shortfall, as a model with a minimum-cash rule
  // would: recorded as that year's debt issuance, so the debt roll-forward
  // and the financing cost both see it. Earliest year first, since a draw
  // lifts cash in every later year too; each pass re-prices the interest.
  let drivers = yearDrivers(args.scenario, args.latest, anchor);
  let result = buildIndustrialForecast(requestFor(drivers));
  for (let pass = 0; pass < MAX_REVOLVER_PASSES; pass += 1) {
    const first = cashShortfalls(result)[0];
    if (!first) break;
    // A draw pays interest in its own year (finance cost is on average
    // obligations), so drawing the bare shortfall leaves the year short by
    // that interest. Grossing up by 1% covered it only below a ~3% cost of
    // debt; above, each pass shrank the gap ~500× until it fell under
    // floating-point resolution (₹7e-13 against ₹1 lakh Cr flows), stuck there
    // for the remaining passes and left later years unfunded (Grasim's
    // historical-panic case: −₹13,525 Cr and −₹31,086 Cr cash). Funding the
    // draw's own after-tax half-year interest closes the year in one pass.
    drivers = drivers.map((driver, index) => {
      if (index !== first.index) return driver;
      const ownInterest = (driver.costOfDebtPretax / 2) * (1 - driver.taxRate);
      return { ...driver, debtIssuance: driver.debtIssuance + (first.shortfall * (1 + REVOLVER_HEADROOM)) / (1 - ownInterest) };
    });
    result = buildIndustrialForecast(requestFor(drivers));
  }
  return result;
}
