import { computeValuation, deriveKwFromStructure } from "./PenmanNissimEngine";
import { LiveMarketDataSnapshot, MarketHistoryPoint, summarizeHistoricalPrices } from "./marketData";
import { buildScenario, buildValuationPeriodsFromForecast } from "./forecastingEngine";
import { AnalysisStatusSummary } from "./analysisStatus";
import { NP_BENCHMARKS, RecastPeriod, EngineConfig, ForecastScenario, ValuationResult, ke_from_config } from "./types";
import { resolveShareBasis } from "./shareCountTools";
import { resolveValuationSectorTemplate } from "./valuationSectorTemplates";

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
  marginOfSafetyPct: number | null;
  expectedCagr: number | null;
  valuation: ValuationResult;
  assumptions: {
    ke: number;
    kw: number;
    g: number;
    salesGrowthYear1: number;
    corePmYear1: number;
    reinvestmentRateYear1: number | null;
    incrementalRoicYear1: number | null;
  };
}

export interface DcfCashFlowDiagnostics {
  ownerEarningsPerShare: number | null;
  ownerEarningsTotal: number | null;
  nopat: number | null;
  maintenanceCapex: number;
  growthCapex: number;
  workingCapitalInvestment: number;
  totalReinvestment: number;
  reinvestmentRate: number | null;
  incrementalRoic: number | null;
  cashConversionRatio: number | null;
  maintenanceCapexShareOfCapex: number | null;
}

export interface ReverseDcfDiagnostics {
  impliedOwnerEarningsGrowth: number | null;
  normalizedGrowthAnchor: number;
  expectationLabel: string;
  spreadVsNormalizedGrowth: number | null;
}

export interface ValuationOpportunityAssessment {
  qualityScore: number;
  requiredMarginOfSafetyPct: number;
  baseMarginOfSafetyPct: number | null;
  stressMarginOfSafetyPct: number | null;
  expectedCagrBase: number | null;
  expectedCagrStress: number | null;
  historicalCheapnessScore: number | null;
  reverseDcfPessimismScore: number | null;
  opportunityScore: number;
  convictionBucket: "research-only" | "starter" | "accumulate" | "high-conviction" | "truck-load zone";
  thesis: string;
}

export interface ValuationChecklist {
  whatMustGoRight: string[];
  thesisBreakers: string[];
}

export interface ValuationMarketContext {
  expectedReturnSpreadVsRf: number | null;
  marketCapFromPrice: number | null;
  enterpriseValueFromPrice: number | null;
  priceToStressValueRatio: number | null;
}

export interface ValuationBacktestPoint {
  periodEnd: string;
  state: ValuationSignalState;
  convictionBucket: ValuationOpportunityAssessment["convictionBucket"];
  marketPrice: number | null;
  baseIntrinsicPerShare: number | null;
  stressIntrinsicPerShare: number | null;
  expectedCagrStress: number | null;
  realized1Y: number | null;
  realized3Y: number | null;
  realized5Y: number | null;
}

export interface ValuationBacktestSummary {
  available: boolean;
  points: ValuationBacktestPoint[];
  countsByState: Record<ValuationSignalState, number>;
  investableCount: number;
  highConvictionCount: number;
  screamingBuyCount: number;
  forwardWinRate1Y: number | null;
  forwardWinRate3Y: number | null;
  median1Y: number | null;
  median3Y: number | null;
  latestComparedToHistory: string;
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
  requiredMarginOfSafetyPct: number;
  qualityScore: number;
  opportunityScore: number;
  convictionBucket: ValuationOpportunityAssessment["convictionBucket"];
  expectedCagrStress: number | null;
  supportingFlags: string[];
  killSwitches: string[];
}

export interface ValuationCommandCenterOutput {
  shareBasis: ReturnType<typeof resolveShareBasis>;
  marketPrice: number | null;
  riskFreeRate: number;
  asOf: string | null;
  sectorTemplate: {
    id: string;
    label: string;
    description: string;
    source: "user" | "auto";
  };
  scenarios: ValuationScenarioCard[];
  diagnostics: DcfCashFlowDiagnostics;
  reverseDcf: ReverseDcfDiagnostics;
  opportunity: ValuationOpportunityAssessment;
  checklist: ValuationChecklist;
  marketContext: ValuationMarketContext;
  backtest: ValuationBacktestSummary;
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

function annualizedReturn(from: number | null, to: number | null, years = 3) {
  if (from == null || to == null || from <= 0 || to <= 0) return null;
  return Math.pow(to / from, 1 / years) - 1;
}

function marginOfSafety(intrinsicPerShare: number | null, marketPrice: number | null) {
  if (intrinsicPerShare == null || marketPrice == null || intrinsicPerShare <= 0) return null;
  return 1 - marketPrice / intrinsicPerShare;
}

function scoreFromRange(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  return clamp((value - min) / Math.max(max - min, 1e-9), 0, 1);
}

function computeOwnerEarningsDcf(baseOwnerEarnings: number | null, growthPath: number[], ke: number, terminalGrowth: number) {
  if (baseOwnerEarnings == null) return null;
  let current = baseOwnerEarnings;
  const projected = growthPath.map((growth) => {
    current *= 1 + growth;
    return current;
  });
  const pv = projected.reduce((total, value, index) => total + value / Math.pow(1 + ke, index + 1), 0);
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

function computeCashFlowDiagnostics(latest: RecastPeriod, prev: RecastPeriod | null, shares: number | null, maintenanceCapexShare: number, maintenanceDepFloor: number): DcfCashFlowDiagnostics {
  const cfo = latest.cf.CFO ?? 0;
  const depreciation = latest.is.operatingCostBridge?.depreciation ?? 0;
  const capex = Math.abs(latest.cf.Capex ?? 0);
  const maintenanceCapex = Math.min(capex, Math.max(depreciation * maintenanceDepFloor, capex * maintenanceCapexShare));
  const growthCapex = Math.max(capex - maintenanceCapex, 0);
  const ownerEarningsTotal = cfo - maintenanceCapex;
  const ownerEarningsPerShare = shares && shares > 0 ? ownerEarningsTotal / shares : null;
  const owcLatest = (latest.bs.Inventory ?? 0) + (latest.bs.TradeReceivables ?? 0) - (latest.bs.TradePayables ?? 0);
  const owcPrev = prev ? (prev.bs.Inventory ?? 0) + (prev.bs.TradeReceivables ?? 0) - (prev.bs.TradePayables ?? 0) : owcLatest;
  const workingCapitalInvestment = Math.max(owcLatest - owcPrev, 0);
  const nopat = latest.is.OI * (1 - latest.is.taxRate);
  const totalReinvestment = growthCapex + workingCapitalInvestment;
  const reinvestmentRate = nopat > 0 ? totalReinvestment / nopat : null;
  const prevNopat = prev ? prev.is.OI * (1 - prev.is.taxRate) : null;
  const deltaNoa = prev ? latest.bs.NOA - prev.bs.NOA : null;
  const incrementalRoic = prev && prevNopat != null && deltaNoa != null && Math.abs(deltaNoa) > 1
    ? (nopat - prevNopat) / deltaNoa
    : null;
  const maintenanceCapexShareOfCapex = capex > 0 ? maintenanceCapex / capex : null;

  return {
    ownerEarningsPerShare,
    ownerEarningsTotal,
    nopat,
    maintenanceCapex,
    growthCapex,
    workingCapitalInvestment,
    totalReinvestment,
    reinvestmentRate,
    incrementalRoic,
    cashConversionRatio: latest.ratios?.cash_conversion_ratio ?? null,
    maintenanceCapexShareOfCapex,
  };
}

function computeQualityScore(latest: RecastPeriod, analysisStatus?: AnalysisStatusSummary | null) {
  const piotroski = latest.quality?.piotroski_total ?? 5;
  const altman = latest.quality?.altman_zprime ?? 2.5;
  const beneish = latest.quality?.beneish_mscore ?? -2.2;
  const cashConversion = latest.ratios?.cash_conversion_ratio ?? 0.8;
  const separation = latest.bs.separationScore ?? latest.ratios?.separationScore ?? 70;
  const spread = latest.ratios?.SPREAD ?? latest.ratios?.CoreSPREAD ?? 0.03;
  const leverage = latest.ratios?.FLEV ?? 0.3;

  let score = 0;
  score += scoreFromRange(piotroski, 3, 9) * 30;
  score += scoreFromRange(altman, 1.6, 4) * 18;
  score += scoreFromRange(-beneish, 1.8, 3) * 12;
  score += scoreFromRange(cashConversion, 0.6, 1.1) * 15;
  score += scoreFromRange(separation, 55, 95) * 15;
  score += scoreFromRange(spread, 0, 0.14) * 7;
  score += scoreFromRange(0.9 - leverage, 0.1, 0.8) * 3;

  if (analysisStatus?.status === "guarded") score -= 6;
  if (analysisStatus?.status === "blocked") score -= 20;
  return clamp(score, 0, 100);
}

function solveImpliedGrowthForTarget(params: {
  ownerEarningsPerShare: number | null;
  targetPrice: number | null;
  ke: number;
  terminalGrowth: number;
  normalizedGrowth: number;
  horizon: number;
  growthFadeAlpha: number;
}) {
  const { ownerEarningsPerShare, targetPrice, ke, terminalGrowth, normalizedGrowth, horizon, growthFadeAlpha } = params;
  if (ownerEarningsPerShare == null || targetPrice == null || targetPrice <= 0) return null;

  let low = -0.25;
  let high = 0.45;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const growthPath = makeFadeArray(mid, growthFadeAlpha, normalizedGrowth, horizon);
    const value = computeOwnerEarningsDcf(ownerEarningsPerShare, growthPath, ke, terminalGrowth);
    if (value == null) return null;
    if (value > targetPrice) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return (low + high) / 2;
}

function describeExpectations(impliedGrowth: number | null, normalizedGrowth: number) {
  if (impliedGrowth == null) {
    return {
      expectationLabel: "Insufficient price or owner-earnings data for reverse DCF.",
      spreadVsNormalizedGrowth: null,
    };
  }
  const spread = impliedGrowth - normalizedGrowth;
  if (impliedGrowth < 0) {
    return {
      expectationLabel: "Market is pricing an outright owner-earnings decline.",
      spreadVsNormalizedGrowth: spread,
    };
  }
  if (impliedGrowth < normalizedGrowth * 0.7) {
    return {
      expectationLabel: "Market is pricing muted growth well below the sector-normal anchor.",
      spreadVsNormalizedGrowth: spread,
    };
  }
  if (impliedGrowth <= normalizedGrowth * 1.15) {
    return {
      expectationLabel: "Market pricing is close to a normalized sector growth path.",
      spreadVsNormalizedGrowth: spread,
    };
  }
  return {
    expectationLabel: "Market already prices an aggressive execution path.",
    spreadVsNormalizedGrowth: spread,
  };
}

type CoreBuildContext = {
  data: RecastPeriod[];
  config: EngineConfig;
  marketData?: LiveMarketDataSnapshot | null;
  analysisStatus?: AnalysisStatusSummary | null;
};

type CoreBuildResult = Omit<ValuationCommandCenterOutput, "backtest">;

function emptyBacktest(reason: string): ValuationBacktestSummary {
  return {
    available: false,
    points: [],
    countsByState: {
      blocked: 0,
      guarded: 0,
      watchlist: 0,
      interesting: 0,
      "high-conviction": 0,
      "screaming-buy": 0,
    },
    investableCount: 0,
    highConvictionCount: 0,
    screamingBuyCount: 0,
    forwardWinRate1Y: null,
    forwardWinRate3Y: null,
    median1Y: null,
    median3Y: null,
    latestComparedToHistory: reason,
  };
}

function closestHistoricalPrice(points: MarketHistoryPoint[], isoDate: string) {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  let candidate: MarketHistoryPoint | null = null;
  for (const point of sorted) {
    if (point.date <= isoDate.slice(0, 10)) {
      candidate = point;
    } else {
      break;
    }
  }
  return candidate;
}

function futureHistoricalPrice(points: MarketHistoryPoint[], isoDate: string, daysForward: number) {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const target = new Date(isoDate);
  target.setUTCDate(target.getUTCDate() + daysForward);
  const targetDay = target.toISOString().slice(0, 10);
  return sorted.find((point) => point.date >= targetDay) ?? null;
}

function summarizeReturns(points: ValuationBacktestPoint[], key: "realized1Y" | "realized3Y") {
  const values = points.map((point) => point[key]).filter((value): value is number => value != null && Number.isFinite(value));
  if (!values.length) {
    return {
      winRate: null,
      medianValue: null,
    };
  }
  return {
    winRate: values.filter((value) => value > 0).length / values.length,
    medianValue: median(values) ?? null,
  };
}

function buildChecklist(args: {
  opportunity: ValuationOpportunityAssessment;
  diagnostics: DcfCashFlowDiagnostics;
  reverseDcf: ReverseDcfDiagnostics;
  marketContext: ValuationMarketContext;
  stressCard: ValuationScenarioCard | null;
  analysisStatus?: AnalysisStatusSummary | null;
}) {
  const { opportunity, diagnostics, reverseDcf, marketContext, stressCard, analysisStatus } = args;
  const whatMustGoRight = [
    `Reinvestment must stay disciplined enough to preserve a stress-case margin of safety near ${formatPct(stressCard?.marginOfSafetyPct, 1)}.`,
    `Owner-earnings conversion needs to hold above the current cash conversion regime of ${formatPct(diagnostics.cashConversionRatio, 1)}.`,
    `The market cannot already be right about a weak long-term trajectory; current reverse DCF still needs to remain below the sector-normal anchor.`,
  ];
  if ((opportunity.expectedCagrBase ?? 0) > 0.15) {
    whatMustGoRight.push("The company needs to compound closer to the base case than the panic case over the next three years.");
  }

  const thesisBreakers = [
    ...(analysisStatus?.status === "guarded" ? ["Confidence degrades from production-ready into guarded or blocked."] : []),
    ...(marketContext.priceToStressValueRatio != null && marketContext.priceToStressValueRatio > 1
      ? ["Current market price already exceeds the stressed intrinsic value."] : []),
    ...(reverseDcf.spreadVsNormalizedGrowth != null && reverseDcf.spreadVsNormalizedGrowth > 0
      ? ["Reverse DCF flips from pessimistic to aggressive market expectations."] : []),
    ...(diagnostics.incrementalRoic != null && diagnostics.incrementalRoic < 0.08
      ? ["Incremental ROIC slips below an acceptable capital-creation threshold."] : []),
    "Dilution, balance-sheet stress, or a renewed accounting-quality warning would invalidate the aggressive buy case.",
  ];

  return {
    whatMustGoRight,
    thesisBreakers,
  } satisfies ValuationChecklist;
}

function buildCoreCommandCenter(context: CoreBuildContext): CoreBuildResult {
  const { data, config, marketData, analysisStatus } = context;
  const shareBasis = resolveShareBasis(data, config);
  const shares = shareBasis.shares ?? null;
  const marketPrice = marketData?.price ?? config.market_price ?? null;
  const riskFreeRate = marketData?.riskFreeRate ?? config.risk_free_rate;
  const latest = data[data.length - 1];
  const prev = data.length >= 2 ? data[data.length - 2] : null;
  const latestRatios = latest.ratios ?? null;
  const { template: sectorTemplate, source: sectorTemplateSource } = resolveValuationSectorTemplate(data, config.sector_template);
  const horizon = 5;

  const diagnostics = computeCashFlowDiagnostics(
    latest,
    prev,
    shares,
    sectorTemplate.maintenanceCapexShare,
    sectorTemplate.maintenanceDepFloor,
  );
  const qualityScore = computeQualityScore(latest, analysisStatus);
  const confidenceState = analysisStatus?.status ?? "unknown";
  const requiredMarginOfSafetyPct = clamp(
    sectorTemplate.baseRequiredMarginOfSafety
      + (sectorTemplate.cyclical ? 0.04 : 0)
      + (qualityScore < 55 ? 0.1 : qualityScore < 70 ? 0.05 : qualityScore > 85 ? -0.03 : 0)
      + (confidenceState === "guarded" ? 0.04 : 0)
      + (confidenceState === "blocked" ? 0.1 : 0),
    0.18,
    0.55,
  );

  const keBase = config.ke > 0 ? config.ke : ke_from_config({ ...config, risk_free_rate: riskFreeRate });
  const kwBase = data.length >= 2
    ? deriveKwFromStructure(data[data.length - 1], data[data.length - 2], keBase, riskFreeRate, config)
    : riskFreeRate;
  const baseSalesGrowth = latestRatios?.Sales_growth ?? config.np_SalesGrowth_median ?? NP_BENCHMARKS.Sales_growth.median;
  const basePm = latestRatios?.CoreSalesPM ?? latestRatios?.PM ?? config.np_PM_median ?? NP_BENCHMARKS.PM.median;
  const baseAto = latestRatios?.ATO ?? config.np_ATO_median ?? NP_BENCHMARKS.ATO.median;
  const flevBase = Math.max(latest.bs.NFO / Math.max(latest.bs.CSE, 1), -0.2);
  const nbcBase = Math.max(latest.is.NFE / Math.max(Math.abs(latest.bs.NFO), 1), 0.01);
  const terminalBase = clamp(
    config.g_terminal_override ?? sectorTemplate.normalizedGrowth * 0.5,
    sectorTemplate.terminalGrowthFloor,
    sectorTemplate.terminalGrowthCap,
  );

  const makeScenario = (
    key: ValuationScenarioCard["key"],
    name: ForecastScenario["name"],
    growthStart: number,
    pmStart: number,
    atoStart: number,
    ke: number,
    kw: number,
    gTerminal: number,
    reinvestmentLift: number,
  ) => {
    const scenario: ForecastScenario = {
      name,
      probability: name === "base" ? 0.4 : name === "bull" ? 0.15 : 0.25,
      horizonT: horizon,
      drivers: {
        sales_growth: makeFadeArray(growthStart, sectorTemplate.growthFadeAlpha, sectorTemplate.normalizedGrowth, horizon),
        core_sales_pm: makeFadeArray(pmStart, sectorTemplate.marginFadeAlpha, NP_BENCHMARKS.PM.median, horizon),
        ato: makeFadeArray(atoStart, sectorTemplate.atoFadeAlpha, NP_BENCHMARKS.ATO.median, horizon),
        flev: Array(horizon).fill(flevBase),
        nbc: Array(horizon).fill(nbcBase),
        g_terminal: gTerminal,
        ke,
        kw,
      },
    };
    const periods = buildScenario(scenario, latest);
    const valuationPeriods = buildValuationPeriodsFromForecast(latest, periods);
    const valuation = computeValuation(valuationPeriods, ke, kw, gTerminal, shareBasis.valuationConfig);
    const ownerDcf = computeOwnerEarningsDcf(diagnostics.ownerEarningsPerShare, scenario.drivers.sales_growth, ke, gTerminal);
    const intrinsicPerShare = computeScenarioIntrinsicPerShare(valuation, ownerDcf);
    const marginOfSafetyPct = marginOfSafety(intrinsicPerShare, marketPrice);
    return {
      key,
      label: key === "stress" ? "Stress case" : key === "base" ? "Base case" : key === "bull" ? "Bull case" : "Historical panic",
      intrinsicPerShare,
      upsidePct: intrinsicPerShare != null && marketPrice != null && marketPrice > 0 ? (intrinsicPerShare - marketPrice) / marketPrice : null,
      marginOfSafetyPct,
      expectedCagr: annualizedReturn(marketPrice, intrinsicPerShare, 3),
      valuation,
      assumptions: {
        ke,
        kw,
        g: gTerminal,
        salesGrowthYear1: scenario.drivers.sales_growth[0] ?? 0,
        corePmYear1: scenario.drivers.core_sales_pm[0] ?? 0,
        reinvestmentRateYear1: diagnostics.reinvestmentRate != null
          ? clamp(diagnostics.reinvestmentRate * reinvestmentLift, 0, 1.2)
          : null,
        incrementalRoicYear1: diagnostics.incrementalRoic != null
          ? clamp(diagnostics.incrementalRoic * (1 - (reinvestmentLift - 1) * 0.2), -0.1, 0.5)
          : null,
      },
    } satisfies ValuationScenarioCard;
  };

  const scenarios: ValuationScenarioCard[] = [
    makeScenario(
      "stress",
      "bear",
      clamp(baseSalesGrowth * 0.35 - 0.01, -0.04, 0.08),
      clamp(basePm * 0.65, 0.02, 0.2),
      clamp(baseAto * 0.88, 0.35, 2),
      keBase + 0.02,
      kwBase + 0.015,
      clamp(sectorTemplate.terminalGrowthFloor, 0.015, 0.03),
      1.15,
    ),
    makeScenario(
      "base",
      "base",
      clamp(baseSalesGrowth, 0.02, Math.max(0.18, sectorTemplate.normalizedGrowth + 0.03)),
      clamp(basePm, 0.04, 0.35),
      clamp(baseAto, 0.4, 2.5),
      keBase,
      kwBase,
      terminalBase,
      1,
    ),
    makeScenario(
      "bull",
      "bull",
      clamp(baseSalesGrowth * 1.2, 0.03, Math.max(0.24, sectorTemplate.normalizedGrowth + 0.08)),
      clamp(basePm * 1.08, 0.05, 0.38),
      clamp(baseAto * 1.02, 0.45, 2.8),
      Math.max(keBase - 0.01, riskFreeRate + 0.04),
      Math.max(kwBase - 0.008, riskFreeRate + 0.03),
      clamp(terminalBase + 0.005, sectorTemplate.terminalGrowthFloor, sectorTemplate.terminalGrowthCap),
      0.9,
    ),
    makeScenario(
      "historical-panic",
      "bear",
      clamp(baseSalesGrowth * 0.15 - 0.02, -0.08, 0.04),
      clamp(basePm * 0.55, 0.01, 0.16),
      clamp(baseAto * 0.82, 0.3, 1.8),
      keBase + 0.03,
      kwBase + 0.0225,
      clamp(sectorTemplate.terminalGrowthFloor, 0.01, 0.025),
      1.2,
    ),
  ];

  const stressCard = scenarios.find((card) => card.key === "stress") ?? null;
  const baseCard = scenarios.find((card) => card.key === "base") ?? null;
  const stressUpsidePct = stressCard?.upsidePct ?? null;
  const baseUpsidePct = baseCard?.upsidePct ?? null;
  const historicalPercentile = marketData?.history?.currentPricePercentile ?? null;

  const impliedOwnerEarningsGrowth = solveImpliedGrowthForTarget({
    ownerEarningsPerShare: diagnostics.ownerEarningsPerShare,
    targetPrice: marketPrice,
    ke: baseCard?.assumptions.ke ?? keBase,
    terminalGrowth: baseCard?.assumptions.g ?? terminalBase,
    normalizedGrowth: sectorTemplate.normalizedGrowth,
    horizon,
    growthFadeAlpha: sectorTemplate.growthFadeAlpha,
  });
  const reverseDcfDescription = describeExpectations(impliedOwnerEarningsGrowth, sectorTemplate.normalizedGrowth);
  const reverseDcf: ReverseDcfDiagnostics = {
    impliedOwnerEarningsGrowth,
    normalizedGrowthAnchor: sectorTemplate.normalizedGrowth,
    expectationLabel: reverseDcfDescription.expectationLabel,
    spreadVsNormalizedGrowth: reverseDcfDescription.spreadVsNormalizedGrowth,
  };

  const historicalCheapnessScore = historicalPercentile != null ? (1 - clamp(historicalPercentile, 0, 1)) * 100 : null;
  const reverseDcfPessimismScore = reverseDcf.spreadVsNormalizedGrowth != null
    ? clamp((sectorTemplate.normalizedGrowth - (sectorTemplate.normalizedGrowth + reverseDcf.spreadVsNormalizedGrowth)) / Math.max(sectorTemplate.normalizedGrowth, 0.01), 0, 1) * 100
    : null;

  const opportunityScore = clamp(
    (qualityScore * 0.28)
      + ((stressCard?.marginOfSafetyPct != null ? scoreFromRange(stressCard.marginOfSafetyPct, 0, requiredMarginOfSafetyPct + 0.12) : 0) * 28)
      + ((baseCard?.marginOfSafetyPct != null ? scoreFromRange(baseCard.marginOfSafetyPct, 0, requiredMarginOfSafetyPct + 0.18) : 0) * 20)
      + ((historicalCheapnessScore ?? 40) * 0.12)
      + ((reverseDcfPessimismScore ?? 35) * 0.12)
      - (analysisStatus?.status === "guarded" ? 8 : analysisStatus?.status === "blocked" ? 25 : 0),
    0,
    100,
  );

  const convictionBucket: ValuationOpportunityAssessment["convictionBucket"] =
    opportunityScore >= 90 && (stressCard?.marginOfSafetyPct ?? -1) >= requiredMarginOfSafetyPct && (historicalPercentile ?? 1) <= sectorTemplate.historicalExtremePercentile
      ? "truck-load zone"
      : opportunityScore >= 78
        ? "high-conviction"
        : opportunityScore >= 62
          ? "accumulate"
          : opportunityScore >= 45
            ? "starter"
            : "research-only";

  const opportunity: ValuationOpportunityAssessment = {
    qualityScore,
    requiredMarginOfSafetyPct,
    baseMarginOfSafetyPct: baseCard?.marginOfSafetyPct ?? null,
    stressMarginOfSafetyPct: stressCard?.marginOfSafetyPct ?? null,
    expectedCagrBase: baseCard?.expectedCagr ?? null,
    expectedCagrStress: stressCard?.expectedCagr ?? null,
    historicalCheapnessScore,
    reverseDcfPessimismScore,
    opportunityScore,
    convictionBucket,
    thesis:
      convictionBucket === "truck-load zone"
        ? "The market price sits in a historically stressed zone while even the stressed DCF still clears the required margin of safety."
        : convictionBucket === "high-conviction"
          ? "The setup offers robust downside protection and a healthy expected return without relying on a heroic base case."
          : convictionBucket === "accumulate"
            ? "The setup is attractive, but some of the upside still depends on normalization rather than deep dislocation."
            : convictionBucket === "starter"
              ? "The setup is worth building a starter position only after monitoring execution and valuation drift."
              : "The setup is analytically usable, but it does not yet qualify as a rare market-led opportunity.",
  };

  const marketContext: ValuationMarketContext = {
    expectedReturnSpreadVsRf: opportunity.expectedCagrStress != null ? opportunity.expectedCagrStress - riskFreeRate : null,
    marketCapFromPrice: marketPrice != null && shares != null ? marketPrice * shares : null,
    enterpriseValueFromPrice: marketPrice != null && shares != null ? marketPrice * shares + latest.bs.NFO : null,
    priceToStressValueRatio: marketPrice != null && (stressCard?.intrinsicPerShare ?? null) != null && (stressCard?.intrinsicPerShare ?? 0) > 0
      ? marketPrice / (stressCard?.intrinsicPerShare ?? 1)
      : null,
  };

  const checklist = buildChecklist({
    opportunity,
    diagnostics,
    reverseDcf,
    marketContext,
    stressCard,
    analysisStatus,
  });

  const killSwitches = [
    ...(analysisStatus?.status === "blocked" ? [analysisStatus.summary] : []),
    ...(marketPrice == null ? ["Current market price is unavailable."] : []),
    ...(marketData?.freshness === "missing" ? ["Live market data is unavailable."] : []),
    ...(diagnostics.ownerEarningsPerShare == null ? ["Owner earnings per share could not be resolved from current data."] : []),
  ];

  const supportingFlags = [
    ...(historicalPercentile != null && historicalPercentile <= sectorTemplate.historicalExtremePercentile
      ? ["Current price sits in a historically dislocated range for this company."]
      : []),
    ...(baseCard?.expectedCagr != null && baseCard.expectedCagr > 0.18
      ? ["Base-case rerating implies an attractive three-year expected CAGR."]
      : []),
    ...(stressCard?.marginOfSafetyPct != null && stressCard.marginOfSafetyPct >= requiredMarginOfSafetyPct
      ? ["Stress-case value still clears the quality-adjusted margin-of-safety hurdle."]
      : []),
    ...(reverseDcf.impliedOwnerEarningsGrowth != null && reverseDcf.impliedOwnerEarningsGrowth < sectorTemplate.normalizedGrowth * 0.75
      ? ["Reverse DCF shows the market is pricing a subdued owner-earnings path."]
      : []),
    ...(qualityScore >= 80 ? ["Accounting quality, balance-sheet resilience, and cash conversion remain strong."] : []),
  ];

  let state: ValuationSignalState = "watchlist";
  let summary = "Current valuation is worth tracking, but it is not yet a rare market-led opportunity.";

  if (killSwitches.length) {
    state = analysisStatus?.status === "blocked" ? "blocked" : "guarded";
    summary = killSwitches[0];
  } else if (
    confidenceState === "production-ready"
    && opportunityScore >= 90
    && (stressCard?.marginOfSafetyPct ?? -1) >= requiredMarginOfSafetyPct
    && (baseCard?.marginOfSafetyPct ?? -1) >= requiredMarginOfSafetyPct + 0.12
    && (historicalPercentile ?? 1) <= sectorTemplate.historicalExtremePercentile
  ) {
    state = "screaming-buy";
    summary = "This qualifies as a rare dislocation: even the stressed case clears the hurdle and the market setup is historically extreme.";
  } else if (
    opportunityScore >= 78
    && (stressCard?.marginOfSafetyPct ?? -1) >= requiredMarginOfSafetyPct * 0.8
    && (baseCard?.marginOfSafetyPct ?? -1) >= requiredMarginOfSafetyPct
  ) {
    state = "high-conviction";
    summary = "The setup clears the quality-adjusted hurdle in both the base and stress cases with attractive expected returns.";
  } else if (
    (baseUpsidePct ?? -1) > sectorTemplate.stressBaseUpside
    && (stressUpsidePct ?? -1) > sectorTemplate.stressProtectedUpside
  ) {
    state = "interesting";
    summary = "The base case is attractive and the stress case still preserves enough upside to stay actionable.";
  }

  const intrinsicValues = scenarios
    .map((card) => card.intrinsicPerShare)
    .filter((value): value is number => value != null && Number.isFinite(value));

  return {
    shareBasis,
    marketPrice,
    riskFreeRate,
    asOf: marketData?.priceAsOf ?? marketData?.fetchedAt ?? null,
    sectorTemplate: {
      id: sectorTemplate.id,
      label: sectorTemplate.label,
      description: sectorTemplate.description,
      source: sectorTemplateSource,
    },
    scenarios,
    diagnostics,
    reverseDcf,
    opportunity,
    checklist,
    marketContext,
    signal: {
      state,
      label:
        state === "screaming-buy"
          ? "Screaming buy"
          : state === "high-conviction"
            ? "High conviction"
            : state === "interesting"
              ? "Interesting"
              : state === "watchlist"
                ? "Watchlist"
                : state === "guarded"
                  ? "Guarded"
                  : "Blocked",
      summary,
      confidenceState,
      stressUpsidePct,
      baseUpsidePct,
      historicalPercentile,
      reverseDcfImpliedGrowth: reverseDcf.impliedOwnerEarningsGrowth,
      requiredMarginOfSafetyPct,
      qualityScore,
      opportunityScore,
      convictionBucket,
      expectedCagrStress: opportunity.expectedCagrStress,
      supportingFlags,
      killSwitches,
    },
    range: {
      floorPerShare: intrinsicValues.length ? Math.min(...intrinsicValues) : null,
      ceilingPerShare: intrinsicValues.length ? Math.max(...intrinsicValues) : null,
    },
  };
}

function buildBacktest(context: CoreBuildContext): ValuationBacktestSummary {
  const historyPoints = context.marketData?.history?.points ?? [];
  if (historyPoints.length < 120 || context.data.length < 4) {
    return emptyBacktest("Historical replay requires a meaningful price history and at least four accounting periods.");
  }

  const points: ValuationBacktestPoint[] = [];
  for (let index = 2; index < context.data.length; index += 1) {
    const subset = context.data.slice(0, index + 1);
    const periodEnd = subset[subset.length - 1].period_end;
    const asOfPrice = closestHistoricalPrice(historyPoints, periodEnd);
    if (!asOfPrice) continue;
    const historySubset = historyPoints.filter((point) => point.date <= asOfPrice.date);
    const historicalSnapshot: LiveMarketDataSnapshot = {
      ...(context.marketData ?? {
        symbol: context.config.market_data_symbol ?? context.config.ticker ?? null,
        provider: "Historical replay",
        fetchedAt: asOfPrice.date,
        price: asOfPrice.close,
        previousClose: null,
        changePct: null,
        marketCap: null,
        enterpriseValue: null,
        sharesOutstanding: null,
        riskFreeRate: context.config.risk_free_rate,
        priceAsOf: asOfPrice.date,
        rateAsOf: asOfPrice.date,
        freshness: "fallback" as const,
        sourceSummary: "Historical replay",
        warnings: [],
        history: null,
      }),
      price: asOfPrice.close,
      priceAsOf: asOfPrice.date,
      history: summarizeHistoricalPrices(historySubset, asOfPrice.close),
    };

    const core = buildCoreCommandCenter({
      ...context,
      data: subset,
      marketData: historicalSnapshot,
      config: {
        ...context.config,
        market_price: asOfPrice.close,
      },
    });

    const realized1YPrice = futureHistoricalPrice(historyPoints, periodEnd, 365);
    const realized3YPrice = futureHistoricalPrice(historyPoints, periodEnd, 365 * 3);
    const realized5YPrice = futureHistoricalPrice(historyPoints, periodEnd, 365 * 5);

    points.push({
      periodEnd,
      state: core.signal.state,
      convictionBucket: core.opportunity.convictionBucket,
      marketPrice: asOfPrice.close,
      baseIntrinsicPerShare: core.scenarios.find((scenario) => scenario.key === "base")?.intrinsicPerShare ?? null,
      stressIntrinsicPerShare: core.scenarios.find((scenario) => scenario.key === "stress")?.intrinsicPerShare ?? null,
      expectedCagrStress: core.opportunity.expectedCagrStress,
      realized1Y: annualizedReturn(asOfPrice.close, realized1YPrice?.close ?? null, 1),
      realized3Y: annualizedReturn(asOfPrice.close, realized3YPrice?.close ?? null, 3),
      realized5Y: annualizedReturn(asOfPrice.close, realized5YPrice?.close ?? null, 5),
    });
  }

  if (!points.length) {
    return emptyBacktest("Historical price points could not be aligned to fiscal period-end dates.");
  }

  const countsByState: Record<ValuationSignalState, number> = {
    blocked: 0,
    guarded: 0,
    watchlist: 0,
    interesting: 0,
    "high-conviction": 0,
    "screaming-buy": 0,
  };
  for (const point of points) countsByState[point.state] += 1;

  const investablePoints = points.filter((point) => ["interesting", "high-conviction", "screaming-buy"].includes(point.state));
  const highConvictionPoints = points.filter((point) => ["high-conviction", "screaming-buy"].includes(point.state));
  const screamingBuyPoints = points.filter((point) => point.state === "screaming-buy");
  const oneYear = summarizeReturns(investablePoints, "realized1Y");
  const threeYear = summarizeReturns(highConvictionPoints.length ? highConvictionPoints : investablePoints, "realized3Y");
  const latestState = points[points.length - 1]?.state ?? "watchlist";
  const strongestHistoricalState = screamingBuyPoints.length
    ? "screaming-buy"
    : highConvictionPoints.length
      ? "high-conviction"
      : investablePoints.length
        ? "interesting"
        : "watchlist";

  return {
    available: true,
    points,
    countsByState,
    investableCount: investablePoints.length,
    highConvictionCount: highConvictionPoints.length,
    screamingBuyCount: screamingBuyPoints.length,
    forwardWinRate1Y: oneYear.winRate,
    forwardWinRate3Y: threeYear.winRate,
    median1Y: oneYear.medianValue,
    median3Y: threeYear.medianValue,
    latestComparedToHistory:
      latestState === strongestHistoricalState
        ? "The current signal matches the strongest historical state seen in the replay window."
        : `The current signal is ${latestState}; the strongest historical state seen was ${strongestHistoricalState}.`,
  };
}

export function buildValuationCommandCenter(params: CoreBuildContext): ValuationCommandCenterOutput {
  const core = buildCoreCommandCenter(params);
  const backtest = buildBacktest(params);
  return {
    ...core,
    backtest,
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
