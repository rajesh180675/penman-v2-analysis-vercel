import type { EngineConfig, ForecastScenario, RecastPeriod } from "../types";
import type { IndustrialForecastAnchor, IndustrialForecastRequest, IndustrialForecastResult, IndustrialForecastYearDrivers, IndustrialProjectedState, IndustrialScenarioKey } from "./contracts";
import { buildIndustrialForecast } from "./engine";

export const LEGACY_FORECAST_STATE_BRIDGE_VERSION = "2026-07-legacy-forecast-state-bridge-v1" as const;

/**
 * Passes that bring the case onto its scenario's financing and fund the years
 * that run short of cash. The distributions converge within a few, and one
 * draw pass funds every short year, so this leaves room to spare.
 */
const MAX_FINANCING_PASSES = 40;
/**
 * ₹ Cr: a case's equity and minority balances count as on its financing path
 * within this. Tight enough that a case values as the command center's
 * forecast does to a few parts in a billion; the passes converge
 * geometrically, so it costs a few.
 */
const FINANCING_TOLERANCE = 1e-6;
/** A draw overshoots its shortfall slightly, so the year closes with cash in hand. */
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

/** An optional driver's value for the year, or null where the scenario has none. */
function optionalSeriesValue(values: readonly number[] | undefined, index: number): number | null {
  return values?.length ? values[Math.min(index, values.length - 1)] ?? null : null;
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
    // The valued forecast charges its net borrowing cost (after tax) on
    // average NFO, so debt and cash are both priced at it here: a rupee of
    // either moves NFE alike, as it does there. Priced apart, at the anchor's
    // own cost of debt and yield on cash, the case's financing expense, and
    // with it the equity it accumulates, drifted from the forecast valued.
    const nbc = seriesValue(scenario.drivers.nbc, index);
    const financingRate = Number.isFinite(nbc) ? clamp(nbc / afterTaxDenominator, 0, 1) : 0;
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
    costOfDebtPretax: financingRate,
    financialAssetYieldPretax: financingRate,
    debtIssuance: 0,
    debtRepayment: 0,
    leaseLiabilityAdditions: 0,
    leasePrincipalRepayment: 0,
    otherFinancialObligationChange: 0,
    // Owner and minority distributions are set by the financing passes below.
    dividendPayoutRatio: 0,
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
    // The minority's share of income after financing, as the valued forecast
    // takes it out before common earnings.
    minorityIncomeShare: clamp(seriesValue(scenario.drivers.mii_share ?? [0], index), 0, 1),
    minorityContributions: 0,
    minorityDistributions: 0,
    };
  });
}

function projectedStates(result: IndustrialForecastResult): readonly IndustrialProjectedState[] {
  return result.status === "computed" ? result.forecastCase.projected : result.projected;
}

/** Years whose projected cash is negative, earliest first, with the shortfall. */
function cashShortfalls(result: IndustrialForecastResult): { index: number; shortfall: number }[] {
  return projectedStates(result).flatMap((state, index) =>
    state.balanceSheet.financialAssets.cash < 0 ? [{ index, shortfall: -state.balanceSheet.financialAssets.cash }] : []);
}

/**
 * The common equity and minority interest the scenario's financing policy
 * sets for a year, on the case's own NOA and income. The policy is the one
 * the command center's forecast applies (forecastingEngine/scenarios.ts,
 * buildForecastPeriod): where owners are paid a fixed amount, equity rolls
 * forward on clean surplus; where net financial obligations are held at a ₹
 * level, equity is NOA less that level; otherwise NFO is held as a ratio to
 * equity, so equity is NOA over one plus the leverage. The minority holds a
 * fixed share of equity.
 */
function policyBalances(
  scenario: ForecastScenario,
  index: number,
  state: IndustrialProjectedState,
  openingEquity: number,
): { readonly equity: number; readonly minority: number } {
  const drivers = scenario.drivers;
  const noa = state.balanceSheet.noa;
  const miRatio = optionalSeriesValue(drivers.mi_ratio, index) ?? 0;
  const payout = optionalSeriesValue(drivers.owner_payout, index);
  const nfoLevel = optionalSeriesValue(drivers.nfo_level, index);
  const equityFromLevel = nfoLevel != null ? (noa - nfoLevel) / (1 + miRatio) : null;
  const leverageDenominator = 1 + seriesValue(drivers.flev, index) + miRatio;
  const equity = payout != null
    ? openingEquity + state.incomeStatement.commonNetIncome - payout
    : equityFromLevel != null && equityFromLevel > 0
      ? equityFromLevel
      : leverageDenominator > 0 ? noa / leverageDenominator : noa;
  return { equity, minority: miRatio * equity };
}

/**
 * The distributions that put each year's common equity and minority interest
 * where the scenario's financing policy sets them, given this pass's NOA and
 * income; null once every year is there. What owners receive beyond the
 * year's earnings is recorded as buybacks, since a payout ratio cannot exceed
 * one; the policy does not split a payout between the two.
 */
function followFinancingPolicy(
  drivers: readonly IndustrialForecastYearDrivers[],
  result: IndustrialForecastResult,
  anchor: IndustrialForecastAnchor,
  scenario: ForecastScenario,
): IndustrialForecastYearDrivers[] | null {
  const states = projectedStates(result);
  const openingEquity = (index: number) =>
    states[index - 1]?.balanceSheet.commonEquity.total ?? anchor.balanceSheet.commonEquity;
  const targets = states.map((state, index) => policyBalances(scenario, index, state, openingEquity(index)));
  const onPath = states.every((state, index) =>
    Math.abs(state.balanceSheet.commonEquity.total - targets[index]!.equity) < FINANCING_TOLERANCE
    && Math.abs(state.balanceSheet.minorityInterest - targets[index]!.minority) < FINANCING_TOLERANCE);
  if (onPath) return null;
  return drivers.map((driver, index) => {
    const state = states[index];
    const target = targets[index];
    if (!state || !target) return driver;
    const openingMinority = states[index - 1]?.balanceSheet.minorityInterest ?? anchor.balanceSheet.minorityInterest;
    const income = state.incomeStatement.commonNetIncome;
    const toOwners = income + openingEquity(index) - target.equity;
    const toMinority = state.incomeStatement.minorityNetIncome + openingMinority - target.minority;
    const dividends = toOwners > 0 ? Math.min(toOwners, Math.max(income, 0)) : 0;
    return {
      ...driver,
      dividendPayoutRatio: income > 0 ? dividends / income : 0,
      buybacks: Math.max(toOwners - dividends, 0),
      shareIssueProceeds: Math.max(-toOwners, 0),
      minorityDistributions: Math.max(toMinority, 0),
      minorityContributions: Math.max(-toMinority, 0),
    };
  });
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

  // The case applies its scenario's financing policy: each year's equity is
  // set by held leverage, a ₹ NFO level, or an owner payout, and the
  // minority's balance as a share of it (policyBalances). Each pass sets the
  // year's distributions to owners and to the minority so both balances land
  // where the policy puts them, and NFO is what NOA leaves. Paying out the
  // latest year's dividend ratio instead, with debt held, left the recorded
  // NFO 1.6–59% of NOA from the forecast the command center values (HUL's
  // bull 59%). The policy is applied to the case's own NOA and income, not
  // copied from that forecast, so the run's check that the two value alike
  // (caseValuationParity.ts) compares two forecasts built apart.
  //
  // Debt is held at the anchor and cash absorbs every other flow, so a year
  // whose investment outruns its cash from operations closes with negative
  // cash (NTPC, L&T, Tata Steel): a balance sheet that cannot exist. A
  // revolving draw funds the shortfall, as a model with a minimum-cash rule
  // would, recorded as that year's debt issuance, so the debt roll-forward
  // and the financing cost both see it.
  //
  // A pass corrects the distributions first and draws only once they hold.
  // With equity and the minority on the policy's path, NFO is too, so a year's
  // cash is its debt less the NFO it carries. A draw then lifts every later
  // year's cash by its own amount, and the interest it costs does not move
  // cash: the next pass's distributions absorb it. So one pass funds every
  // short year, earliest first.
  let drivers = yearDrivers(args.scenario, args.latest, anchor);
  let result = buildIndustrialForecast(requestFor(drivers));
  for (let pass = 0; pass < MAX_FINANCING_PASSES; pass += 1) {
    const followed = followFinancingPolicy(drivers, result, anchor, args.scenario);
    if (followed) {
      drivers = followed;
      result = buildIndustrialForecast(requestFor(drivers));
      continue;
    }
    if (!cashShortfalls(result).length) break;
    const states = projectedStates(result);
    let drawn = 0;
    drivers = drivers.map((driver, index) => {
      const cash = (states[index]?.balanceSheet.financialAssets.cash ?? 0) + drawn;
      if (cash >= 0) return driver;
      const draw = -cash * (1 + REVOLVER_HEADROOM);
      drawn += draw;
      return { ...driver, debtIssuance: driver.debtIssuance + draw };
    });
    result = buildIndustrialForecast(requestFor(drivers));
  }
  return result;
}
