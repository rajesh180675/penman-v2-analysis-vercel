import { computeValuation, deriveKwFromStructure } from "./PenmanNissimEngine";
import { LiveMarketDataSnapshot } from "./marketData";
import { buildScenario, buildValuationPeriodsFromForecast } from "./forecastingEngine";
import { AnalysisStatusSummary } from "./analysisStatus";
import { NP_BENCHMARKS, RecastPeriod, EngineConfig, ForecastScenario, ValuationResult, ke_from_config } from "./types";
import { resolveShareBasis } from "./shareCountTools";

export type ValuationSignalState =
  | "blocked"
  | "guarded"
  | "watchlist"
  | "interesting"
  | "high-conviction"
  | "screaming-buy";

export interface ValuationScenarioCard {
  key: "stress" | "base" | "bull" | "historical-panic";
  label: string;
  intrinsicPerShare: number | null;
  upsidePct: number | null;
  valuation: ValuationResult;
  assumptions: {
    ke: number;
    kw: number;
    g: number;
    salesGrowthYear1: number;
    corePmYear1: number;
  };
}

export interface ValuationSignal {
  state: ValuationSignalState;
  label: string;
  summary: string;
  confidenceState: AnalysisStatusSummary["status"] | "unknown";
  stressUpsidePct: number | null;
  baseUpsidePct: number | null;
  historicalPercentile: number | null;
  reverseDcfImpliedGrowth: number | null;
  supportingFlags: string[];
  killSwitches: string[];
}

export interface ValuationCommandCenterOutput {
  shareBasis: ReturnType<typeof resolveShareBasis>;
  marketPrice: number | null;
  riskFreeRate: number;
  asOf: string | null;
  scenarios: ValuationScenarioCard[];
  signal: ValuationSignal;
  range: {
    floorPerShare: number | null;
    ceilingPerShare: number | null;
  };
}

function median(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!filtered.length) return null;
  const middle = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 0 ? (filtered[middle - 1] + filtered[middle]) / 2 : filtered[middle];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function makeFadeArray(base: number, alpha: number, target: number, horizon: number) {
  const values: number[] = [];
  let previous = base;
  for (let i = 0; i < horizon; i += 1) {
    const next = alpha * previous + (1 - alpha) * target;
    values.push(next);
    previous = next;
  }
  return values;
}

function ownerEarningsPerShare(latest: RecastPeriod, shares: number | null) {
  if (!shares || shares <= 0) return null;
  const cfo = latest.cf.CFO ?? 0;
  const depreciation = latest.is.operatingCostBridge?.depreciation ?? 0;
  const capex = Math.abs(latest.cf.Capex ?? 0);
  const maintenanceCapex = Math.min(capex, Math.max(depreciation, capex * 0.65));
  const ownerEarnings = cfo - maintenanceCapex;
  return ownerEarnings / shares;
}

function discountSeries(values: number[], rate: number) {
  return values.reduce((total, value, index) => total + value / Math.pow(1 + rate, index + 1), 0);
}

function computeOwnerEarningsDcf(
  latest: RecastPeriod,
  shares: number | null,
  growthPath: number[],
  ke: number,
  terminalGrowth: number,
) {
  const baseOwnerEarnings = ownerEarningsPerShare(latest, shares);
  if (baseOwnerEarnings == null) return null;
  let current = baseOwnerEarnings;
  const projected = growthPath.map((growth) => {
    current *= 1 + growth;
    return current;
  });
  const pv = discountSeries(projected, ke);
  const terminal = projected.length && ke - terminalGrowth > 0.005
    ? (projected[projected.length - 1] * (1 + terminalGrowth)) / (ke - terminalGrowth)
    : 0;
  return pv + terminal / Math.pow(1 + ke, projected.length);
}

function computeScenarioIntrinsicPerShare(valuation: ValuationResult, ownerEarningsDcf: number | null) {
  const modelValues = [
    valuation.perShare?.intrinsic_re_per_share ?? null,
    valuation.perShare?.intrinsic_reoi_per_share ?? null,
    valuation.perShare?.intrinsic_fcff_per_share ?? null,
    valuation.perShare?.intrinsic_fcfe_per_share ?? null,
    ownerEarningsDcf,
  ];
  return median(modelValues);
}

export function buildValuationCommandCenter(params: {
  data: RecastPeriod[];
  config: EngineConfig;
  marketData?: LiveMarketDataSnapshot | null;
  analysisStatus?: AnalysisStatusSummary | null;
}): ValuationCommandCenterOutput {
  const { data, config, marketData, analysisStatus } = params;
  const shareBasis = resolveShareBasis(data, config);
  const shares = shareBasis.shares ?? null;
  const marketPrice = marketData?.price ?? config.market_price ?? null;
  const riskFreeRate = marketData?.riskFreeRate ?? config.risk_free_rate;
  const latest = data[data.length - 1];
  const latestRatios = latest.ratios ?? null;
  const horizon = 5;
  const keBase = config.ke > 0 ? config.ke : ke_from_config({ ...config, risk_free_rate: riskFreeRate });
  const kwBase = data.length >= 2
    ? deriveKwFromStructure(data[data.length - 1], data[data.length - 2], keBase, riskFreeRate, config)
    : riskFreeRate;
  const baseSalesGrowth = latestRatios?.Sales_growth ?? config.np_SalesGrowth_median ?? NP_BENCHMARKS.Sales_growth.median;
  const basePm = latestRatios?.CoreSalesPM ?? latestRatios?.PM ?? config.np_PM_median ?? NP_BENCHMARKS.PM.median;
  const baseAto = latestRatios?.ATO ?? config.np_ATO_median ?? NP_BENCHMARKS.ATO.median;
  const flevBase = Math.max(latest.bs.NFO / Math.max(latest.bs.CSE, 1), -0.2);
  const nbcBase = Math.max(latest.is.NFE / Math.max(Math.abs(latest.bs.NFO), 1), 0.01);
  const makeScenario = (name: ForecastScenario["name"], growthStart: number, pmStart: number, atoStart: number, ke: number, kw: number, gTerminal: number) => {
    const scenario: ForecastScenario = {
      name,
      probability: name === "base" ? 0.4 : name === "bull" ? 0.15 : 0.25,
      horizonT: horizon,
      drivers: {
        sales_growth: makeFadeArray(growthStart, 0.72, NP_BENCHMARKS.Sales_growth.median, horizon),
        core_sales_pm: makeFadeArray(pmStart, 0.88, NP_BENCHMARKS.PM.median, horizon),
        ato: makeFadeArray(atoStart, 0.92, NP_BENCHMARKS.ATO.median, horizon),
        flev: Array(horizon).fill(flevBase),
        nbc: Array(horizon).fill(nbcBase),
        g_terminal: gTerminal,
        ke,
        kw,
      },
    };
    const periods = buildScenario(scenario, latest);
    const valuationPeriods = buildValuationPeriodsFromForecast(latest, periods);
    return { scenario, periods, valuationPeriods };
  };

  const baseScenario = makeScenario("base", clamp(baseSalesGrowth, 0.02, 0.18), clamp(basePm, 0.04, 0.35), clamp(baseAto, 0.4, 2.5), keBase, kwBase, clamp(config.g_terminal_override ?? 0.04, 0.02, 0.05));
  const stressScenario = makeScenario("bear", clamp(baseSalesGrowth * 0.35 - 0.01, -0.04, 0.08), clamp(basePm * 0.65, 0.02, 0.2), clamp(baseAto * 0.88, 0.35, 2.0), keBase + 0.02, kwBase + 0.015, 0.02);
  const bullScenario = makeScenario("bull", clamp(baseSalesGrowth * 1.2, 0.03, 0.22), clamp(basePm * 1.08, 0.05, 0.38), clamp(baseAto * 1.02, 0.45, 2.8), Math.max(keBase - 0.01, riskFreeRate + 0.04), Math.max(kwBase - 0.008, riskFreeRate + 0.03), clamp((config.g_terminal_override ?? 0.05) + 0.005, 0.03, 0.055));
  const panicScenario = makeScenario("bear", clamp(baseSalesGrowth * 0.15 - 0.02, -0.08, 0.04), clamp(basePm * 0.55, 0.01, 0.16), clamp(baseAto * 0.82, 0.3, 1.8), keBase + 0.03, kwBase + 0.0225, 0.015);

  const scenarioCardsBase = [
    {
      key: "stress" as const,
      label: "Stress case",
      intrinsicPerShare: null,
      upsidePct: null,
      valuation: computeValuation(stressScenario.valuationPeriods, stressScenario.scenario.drivers.ke, stressScenario.scenario.drivers.kw, stressScenario.scenario.drivers.g_terminal, shareBasis.valuationConfig),
      assumptions: {
        ke: stressScenario.scenario.drivers.ke,
        kw: stressScenario.scenario.drivers.kw,
        g: stressScenario.scenario.drivers.g_terminal,
        salesGrowthYear1: stressScenario.scenario.drivers.sales_growth[0] ?? 0,
        corePmYear1: stressScenario.scenario.drivers.core_sales_pm[0] ?? 0,
      },
    },
    {
      key: "base" as const,
      label: "Base case",
      intrinsicPerShare: null,
      upsidePct: null,
      valuation: computeValuation(baseScenario.valuationPeriods, baseScenario.scenario.drivers.ke, baseScenario.scenario.drivers.kw, baseScenario.scenario.drivers.g_terminal, shareBasis.valuationConfig),
      assumptions: {
        ke: baseScenario.scenario.drivers.ke,
        kw: baseScenario.scenario.drivers.kw,
        g: baseScenario.scenario.drivers.g_terminal,
        salesGrowthYear1: baseScenario.scenario.drivers.sales_growth[0] ?? 0,
        corePmYear1: baseScenario.scenario.drivers.core_sales_pm[0] ?? 0,
      },
    },
    {
      key: "bull" as const,
      label: "Bull case",
      intrinsicPerShare: null,
      upsidePct: null,
      valuation: computeValuation(bullScenario.valuationPeriods, bullScenario.scenario.drivers.ke, bullScenario.scenario.drivers.kw, bullScenario.scenario.drivers.g_terminal, shareBasis.valuationConfig),
      assumptions: {
        ke: bullScenario.scenario.drivers.ke,
        kw: bullScenario.scenario.drivers.kw,
        g: bullScenario.scenario.drivers.g_terminal,
        salesGrowthYear1: bullScenario.scenario.drivers.sales_growth[0] ?? 0,
        corePmYear1: bullScenario.scenario.drivers.core_sales_pm[0] ?? 0,
      },
    },
    {
      key: "historical-panic" as const,
      label: "Historical panic",
      intrinsicPerShare: null,
      upsidePct: null,
      valuation: computeValuation(panicScenario.valuationPeriods, panicScenario.scenario.drivers.ke, panicScenario.scenario.drivers.kw, panicScenario.scenario.drivers.g_terminal, shareBasis.valuationConfig),
      assumptions: {
        ke: panicScenario.scenario.drivers.ke,
        kw: panicScenario.scenario.drivers.kw,
        g: panicScenario.scenario.drivers.g_terminal,
        salesGrowthYear1: panicScenario.scenario.drivers.sales_growth[0] ?? 0,
        corePmYear1: panicScenario.scenario.drivers.core_sales_pm[0] ?? 0,
      },
    },
  ];
  const scenarioCards: ValuationScenarioCard[] = scenarioCardsBase.map((card, index) => {
    const scenario = [stressScenario, baseScenario, bullScenario, panicScenario][index];
    const ownerDcf = computeOwnerEarningsDcf(latest, shares, scenario.scenario.drivers.sales_growth, card.assumptions.ke, card.assumptions.g);
    const intrinsicPerShare = computeScenarioIntrinsicPerShare(card.valuation, ownerDcf);
    return {
      ...card,
      intrinsicPerShare,
      upsidePct: intrinsicPerShare != null && marketPrice != null && marketPrice > 0 ? (intrinsicPerShare - marketPrice) / marketPrice : null,
    };
  });

  const stressUpsidePct = scenarioCards.find((card) => card.key === "stress")?.upsidePct ?? null;
  const baseUpsidePct = scenarioCards.find((card) => card.key === "base")?.upsidePct ?? null;
  const historicalPercentile = marketData?.history?.currentPricePercentile ?? null;
  const confidenceState = analysisStatus?.status ?? "unknown";
  const killSwitches = [
    ...(analysisStatus?.status === "blocked" ? [analysisStatus.summary] : []),
    ...(marketPrice == null ? ["Current market price is unavailable."] : []),
    ...(marketData?.freshness === "missing" ? ["Live market data is unavailable."] : []),
  ];
  const supportingFlags = [
    ...(historicalPercentile != null && historicalPercentile <= 0.1 ? ["Current price sits near the bottom decile of observed history."] : []),
    ...(baseUpsidePct != null && baseUpsidePct > 0.4 ? ["Base-case upside is materially above current market price."] : []),
    ...(stressUpsidePct != null && stressUpsidePct > 0.2 ? ["Stress-case upside remains positive and large."] : []),
    ...(scenarioCards.find((card) => card.key === "base")?.valuation.perShare?.implied_growth_rate != null
      && (scenarioCards.find((card) => card.key === "base")?.valuation.perShare?.implied_growth_rate ?? 0) < 0.04
      ? ["Reverse DCF implies subdued growth expectations."] : []),
  ];

  let state: ValuationSignalState = "watchlist";
  let summary = "Current valuation is worth tracking but not yet exceptional.";
  if (killSwitches.length) {
    state = analysisStatus?.status === "blocked" ? "blocked" : "guarded";
    summary = killSwitches[0];
  } else if (baseUpsidePct != null && stressUpsidePct != null) {
    if (baseUpsidePct > 0.6 && stressUpsidePct > 0.35 && historicalPercentile != null && historicalPercentile <= 0.1 && confidenceState === "production-ready") {
      state = "screaming-buy";
      summary = "Rare setup: even the stressed case leaves deep upside and the market setup is historically extreme.";
    } else if (baseUpsidePct > 0.4 && stressUpsidePct > 0.2) {
      state = "high-conviction";
      summary = "Base and stress cases both show strong upside with acceptable downside protection.";
    } else if (baseUpsidePct > 0.25 && stressUpsidePct > 0.05) {
      state = "interesting";
      summary = "The base case is attractive and the stress case still leaves some upside.";
    }
  }

  const intrinsicValues = scenarioCards.map((card) => card.intrinsicPerShare).filter((value): value is number => value != null && Number.isFinite(value));

  return {
    shareBasis,
    marketPrice,
    riskFreeRate,
    asOf: marketData?.priceAsOf ?? marketData?.fetchedAt ?? null,
    scenarios: scenarioCards,
    signal: {
      state,
      label: state === "screaming-buy" ? "Screaming buy" : state === "high-conviction" ? "High conviction" : state === "interesting" ? "Interesting" : state === "watchlist" ? "Watchlist" : state === "guarded" ? "Guarded" : "Blocked",
      summary,
      confidenceState,
      stressUpsidePct,
      baseUpsidePct,
      historicalPercentile,
      reverseDcfImpliedGrowth: scenarioCards.find((card) => card.key === "base")?.valuation.perShare?.implied_growth_rate ?? null,
      supportingFlags,
      killSwitches,
    },
    range: {
      floorPerShare: intrinsicValues.length ? Math.min(...intrinsicValues) : null,
      ceilingPerShare: intrinsicValues.length ? Math.max(...intrinsicValues) : null,
    },
  };
}

export function formatPct(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatPerShare(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₹${value.toFixed(2)}`;
}

export function formatHistoricalPercentile(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(0)}th percentile`;
}
