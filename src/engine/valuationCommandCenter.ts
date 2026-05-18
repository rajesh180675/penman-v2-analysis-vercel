import { computeValuation, deriveKwFromStructure } from "./PenmanNissimEngine";
import { LiveMarketDataFreshness, LiveMarketDataSnapshot, MarketHistoryPoint, summarizeHistoricalPrices } from "./marketData";
import { buildBusinessModelProfile, buildScenario, buildValuationPeriodsFromForecast, derivePersistenceForecastScenario } from "./forecastingEngine";
import { AnalysisStatusSummary } from "./analysisStatus";
import { RecastPeriod, EngineConfig, ForecastScenario, ForecastPolicySurface, ValuationResult, ke_from_config, BusinessModelProfile } from "./types";
import { resolveShareBasis } from "./shareCountTools";
import { ValuationReadiness, resolveValuationReadiness } from "./valuationPolicy";
import { resolveValuationSectorTemplate } from "./valuationSectorTemplates";
import { buildSOTPValuation, SOTP_PRESETS, SOTPResult } from "./sotpValuation";
import { runSOTPFromSegmentData, segmentDataToDefinitions, EnhancedSOTPResult } from "./segmentSOTPBridge";
import type { SegmentData } from "./segmentParser";
import { computeEvEbitdaCrossCheck, updateEvEbitdaWithMarketPrice, EvEbitdaCrossCheck } from "./evEbitdaCrossCheck";
import { computeIndiaQualitySignals, IndiaQualitySignals } from "./indiaQualitySignals";
import { buildEarningsQualityCard, buildDechowDichevAndRem, EarningsQualityCard } from "./earningsQuality";

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
  scenario: ForecastScenario;
  intrinsicPerShare: number | null;
  upsidePct: number | null;
  marginOfSafetyPct: number | null;
  expectedCagr: number | null;
  valuation: ValuationResult;
  forecastPolicy?: ForecastPolicySurface;
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
  maintenanceCapexShareAssumption: number;
}

export interface NarrativeBandEntry {
  terminalROIC: number;
  impliedGrowth: number;
  intrinsicValue: number;
}

export interface ReverseDcfDiagnostics {
  impliedOwnerEarningsGrowth: number | null;
  impliedTerminalROIC: number | null;
  impliedKE: number | null;
  normalizedGrowthAnchor: number;
  expectationLabel: string;
  narrativeSpace: NarrativeBandEntry[];
  spreadVsNormalizedGrowth: number | null;
  marketExpectationLabel: string;
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
  persistenceNarrative: string;
}

export interface ValuationChecklist {
  whatMustGoRight: string[];
  thesisBreakers: string[];
  forecastDiscipline: string[];
}

export interface ValuationMarketContext {
  expectedReturnSpreadVsRf: number | null;
  marketCapFromPrice: number | null;
  enterpriseValueFromPrice: number | null;
  priceToStressValueRatio: number | null;
  freshness: LiveMarketDataFreshness;
  sourceSummary: string;
  livePriceAsOf: string | null;
  liveRateAsOf: string | null;
  warningCount: number;
  valuationAnchorPeriod: string | null;
  latestReportedPeriod: string | null;
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
  valuationReadiness: ValuationReadiness;
  marketPrice: number | null;
  riskFreeRate: number;
  asOf: string | null;
  sectorTemplate: {
    id: string;
    label: string;
    description: string;
    source: "user" | "auto";
  };
  businessModel: BusinessModelProfile;
  scenarios: ValuationScenarioCard[];
  diagnostics: DcfCashFlowDiagnostics;
  reverseDcf: ReverseDcfDiagnostics;
  sotp: SOTPResult | null;
  /** Phase C5 — conglomerate assessment from segment data or presets. */
  conglomerate: ConglomerateAssessment | null;
  evEbitda: EvEbitdaCrossCheck;
  indiaQuality: IndiaQualitySignals;
  opportunity: ValuationOpportunityAssessment;
  checklist: ValuationChecklist;
  marketContext: ValuationMarketContext;
  backtest: ValuationBacktestSummary;
  signal: ValuationSignal;
  earningsQuality: EarningsQualityCard;
  range: {
    floorPerShare: number | null;
    ceilingPerShare: number | null;
  };
}

/** Phase C5 — Conglomerate assessment derived from segment data or SOTP presets. */
export interface ConglomerateAssessment {
  isConglomerate: boolean;
  segmentCount: number;
  distinctSectorTemplates: number;
  dominantSegmentPct: number;
  dominantSegmentName: string;
  dataSource: "parsed" | "preset" | "none";
  /** Advisory: for diversified conglomerates, SOTP is preferred over single-entity V_RE. */
  sotpPreferred: boolean;
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
    ownerEarningsDcf,
  ];
  return median(modelValues);
}

function computeCrossCheckSpread(valuation: ValuationResult) {
  const primaryValues = [
    valuation.perShare?.intrinsic_re_per_share ?? null,
    valuation.perShare?.intrinsic_reoi_per_share ?? null,
  ].filter((value): value is number => value != null && Number.isFinite(value));

  const crossCheckValues = [
    valuation.perShare?.intrinsic_fcff_per_share ?? null,
    valuation.perShare?.intrinsic_fcfe_per_share ?? null,
  ].filter((value): value is number => value != null && Number.isFinite(value));

  if (!primaryValues.length || !crossCheckValues.length) return null;
  return median(crossCheckValues)! - median(primaryValues)!;
}

function buildNarrativeSpacePerShare(params: {
  targetPrice: number | null;
  kw: number;
  cse0: number;
  noaT: number;
  shares: number | null;
  normalizedGrowth: number;
}): NarrativeBandEntry[] {
  const { targetPrice, kw, cse0, noaT, shares, normalizedGrowth } = params;
  if (targetPrice == null || targetPrice <= 0 || noaT === 0 || shares == null || shares <= 0) return [];
  const results: NarrativeBandEntry[] = [];
  const roicMin = Math.max(kw - 0.05, -0.05);
  const roicMax = Math.max(kw + 0.30, 0.15);
  const roicStep = Math.min(0.05, (roicMax - roicMin) / 12);
  for (let roic = roicMin; roic <= roicMax; roic += roicStep) {
    const equityValue = cse0 + (roic - kw) * noaT / kw;
    const perShareValue = equityValue / shares;
    if (!Number.isFinite(perShareValue) || perShareValue <= 0) continue;
    if (Math.abs(perShareValue - targetPrice) / Math.max(targetPrice, 1) <= 0.10) {
      results.push({
        terminalROIC: Math.round(roic * 1000) / 1000,
        impliedGrowth: normalizedGrowth,
        intrinsicValue: Math.round(perShareValue * 100) / 100,
      });
    }
  }
  return results;
}

function describeKeExpectation(impliedKe: number | null, ke: number) {
  if (impliedKe == null) return null;
  if (impliedKe > ke + 0.05) return "Market pricing implies a materially higher required return than the base cost of equity.";
  if (impliedKe < ke - 0.03) return "Market pricing implies a lower required return than the base cost of equity.";
  return "Market pricing implies a required return close to the base cost of equity.";
}

function describeTerminalRoicExpectation(impliedTerminalROIC: number | null, kw: number) {
  if (impliedTerminalROIC == null) return null;
  if (impliedTerminalROIC > kw + 0.08) return "Market pricing assumes terminal returns meaningfully above the operating capital charge.";
  if (impliedTerminalROIC < kw) return "Market pricing assumes terminal returns below the operating capital charge.";
  return "Market pricing implies terminal returns close to the operating capital charge.";
}

function extendExpectationLabel(base: string, additions: Array<string | null>) {
  const cleanAdditions = additions.filter((value): value is string => Boolean(value));
  return cleanAdditions.length ? `${base} ${cleanAdditions.join(" ")}` : base;
}

function solveImpliedKeFromOwnerEarnings(params: {
  targetPrice: number | null;
  ownerEarningsPerShare: number | null;
  growthPath: number[];
  terminalGrowth: number;
  low?: number;
  high?: number;
}) {
  const { targetPrice, ownerEarningsPerShare, growthPath, terminalGrowth } = params;
  if (targetPrice == null || targetPrice <= 0 || ownerEarningsPerShare == null || ownerEarningsPerShare <= 0) return null;
  let low = params.low ?? Math.max(terminalGrowth + 0.01, 0.04);
  let high = params.high ?? 0.40;
  let lowValue = computeOwnerEarningsDcf(ownerEarningsPerShare, growthPath, low, terminalGrowth);
  let highValue = computeOwnerEarningsDcf(ownerEarningsPerShare, growthPath, high, terminalGrowth);
  if (lowValue == null || highValue == null) return null;
  if (lowValue < targetPrice || highValue > targetPrice) return null;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const value = computeOwnerEarningsDcf(ownerEarningsPerShare, growthPath, mid, terminalGrowth);
    if (value == null) return null;
    if (value > targetPrice) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function solveImpliedTerminalRoicFromValue(params: {
  targetPrice: number | null;
  shares: number | null;
  cse0: number;
  noaT: number;
  kw: number;
}) {
  const { targetPrice, shares, cse0, noaT, kw } = params;
  if (targetPrice == null || targetPrice <= 0 || shares == null || shares <= 0 || noaT <= 0) return null;
  const equityValue = targetPrice * shares;
  const impliedRoic = kw + ((equityValue - cse0) * kw) / noaT;
  if (!Number.isFinite(impliedRoic) || impliedRoic < -0.1 || impliedRoic > 2.0) return null;
  return impliedRoic;
}

function primaryValuationPerShare(valuation: ValuationResult) {
  return median([
    valuation.perShare?.intrinsic_re_per_share ?? null,
    valuation.perShare?.intrinsic_reoi_per_share ?? null,
  ]);
}

function isSuspiciousCrossCheckSpread(spread: number | null) {
  return spread != null && Math.abs(spread) > 0.5;
}

function crossCheckGuardSummary() {
  return "FCFF/FCFE cross-checks remain diagnostic only because they diverge materially from the primary RE / ReOI valuation family.";
}

function deriveBaseGrowthPath(card: ValuationScenarioCard | null, fallback: number) {
  if (card?.scenario.drivers.sales_growth?.length) return card.scenario.drivers.sales_growth;
  return Array.from({ length: 5 }, () => fallback);
}

function applyPrimaryScenarioMetrics(card: ValuationScenarioCard, marketPrice: number | null) {
  const primaryValue = primaryValuationPerShare(card.valuation);
  return {
    ...card,
    intrinsicPerShare: primaryValue,
    upsidePct: primaryValue != null && marketPrice != null && marketPrice > 0 ? (primaryValue - marketPrice) / marketPrice : null,
    marginOfSafetyPct: marginOfSafety(primaryValue, marketPrice),
    expectedCagr: annualizedReturn(marketPrice, primaryValue, 3),
  } satisfies ValuationScenarioCard;
}

function normalizeScenarioCards(cards: ValuationScenarioCard[], marketPrice: number | null) {
  return cards.map((card) => applyPrimaryScenarioMetrics(card, marketPrice));
}

function buildReverseDcfExpectation(args: {
  marketPrice: number | null;
  diagnostics: DcfCashFlowDiagnostics;
  baseCard: ValuationScenarioCard | null;
  keBase: number;
  kwBase: number;
  cse0: number;
  noaT: number;
  shares: number | null;
  normalizedGrowth: number;
  terminalGrowth: number;
}) {
  const impliedOwnerEarningsGrowth = solveImpliedGrowthForTarget({
    ownerEarningsPerShare: args.diagnostics.ownerEarningsPerShare,
    targetPrice: args.marketPrice,
    ke: args.keBase,
    terminalGrowth: args.terminalGrowth,
    normalizedGrowth: args.normalizedGrowth,
    horizon: deriveBaseGrowthPath(args.baseCard, args.normalizedGrowth).length,
    growthFadeAlpha: 0.7,
  });

  const impliedTerminalROIC = solveImpliedTerminalRoicFromValue({
    targetPrice: args.marketPrice,
    shares: args.shares,
    cse0: args.cse0,
    noaT: args.noaT,
    kw: args.kwBase,
  });

  const impliedKE = solveImpliedKeFromOwnerEarnings({
    targetPrice: args.marketPrice,
    ownerEarningsPerShare: args.diagnostics.ownerEarningsPerShare,
    growthPath: deriveBaseGrowthPath(args.baseCard, args.normalizedGrowth),
    terminalGrowth: args.terminalGrowth,
  });

  const reverseDcfDescription = describeExpectations(impliedOwnerEarningsGrowth, args.normalizedGrowth);
  const crossCheckSpread = args.baseCard ? computeCrossCheckSpread(args.baseCard.valuation) : null;
  const expectationLabel = extendExpectationLabel(
    reverseDcfDescription.expectationLabel,
    [
      describeTerminalRoicExpectation(impliedTerminalROIC, args.kwBase),
      describeKeExpectation(impliedKE, args.keBase),
      isSuspiciousCrossCheckSpread(crossCheckSpread) ? crossCheckGuardSummary() : null,
    ],
  );

  return {
    impliedOwnerEarningsGrowth,
    impliedTerminalROIC,
    impliedKE,
    normalizedGrowthAnchor: args.normalizedGrowth,
    expectationLabel,
    narrativeSpace: buildNarrativeSpacePerShare({
      targetPrice: args.marketPrice,
      kw: args.kwBase,
      cse0: args.cse0,
      noaT: args.noaT,
      shares: args.shares,
      normalizedGrowth: args.normalizedGrowth,
    }),
    marketExpectationLabel: marketExpectationLabel(impliedOwnerEarningsGrowth, impliedTerminalROIC, impliedKE, args.keBase, args.normalizedGrowth),
    spreadVsNormalizedGrowth: reverseDcfDescription.spreadVsNormalizedGrowth,
  } satisfies ReverseDcfDiagnostics;
}

function primaryValueRange(cards: ValuationScenarioCard[]) {
  const values = cards.map((card) => card.intrinsicPerShare).filter((value): value is number => value != null && Number.isFinite(value));
  return {
    floorPerShare: values.length ? Math.min(...values) : null,
    ceilingPerShare: values.length ? Math.max(...values) : null,
  };
}

function appendCrossCheckWarning(flags: string[], cards: ValuationScenarioCard[]) {
  const warnings = cards
    .map((card) => ({ key: card.key, spread: computeCrossCheckSpread(card.valuation) }))
    .filter((entry) => isSuspiciousCrossCheckSpread(entry.spread))
    .map((entry) => `${entry.key} FCFF/FCFE cross-checks diverge materially from primary RE / ReOI valuation.`);
  return warnings.length ? [...flags, ...warnings] : flags;
}

function summaryWithCrossCheckWarning(summary: string, cards: ValuationScenarioCard[]) {
  return cards.some((card) => isSuspiciousCrossCheckSpread(computeCrossCheckSpread(card.valuation)))
    ? `${summary} ${crossCheckGuardSummary()}`
    : summary;
}

function opportunityMetrics(card: ValuationScenarioCard | null, marketPrice: number | null) {
  const primaryValue = card ? primaryValuationPerShare(card.valuation) : null;
  return {
    upsidePct: primaryValue != null && marketPrice != null && marketPrice > 0 ? (primaryValue - marketPrice) / marketPrice : null,
    marginOfSafetyPct: marginOfSafety(primaryValue, marketPrice),
    expectedCagr: annualizedReturn(marketPrice, primaryValue, 3),
  };
}
function computeCashFlowDiagnostics(latest: RecastPeriod, prev: RecastPeriod | null, shares: number | null, maintenanceCapexShare: number, maintenanceDepFloor: number): DcfCashFlowDiagnostics {
  const cfo = latest.cf.CFO ?? 0;
  const depreciation = latest.is.operatingCostBridge?.depreciation ?? 0;
  const capex = Math.abs(latest.cf.Capex ?? 0);
  const salesGrowth = latest.ratios?.Sales_growth ?? 0;
  const cashConversionRatio = latest.ratios?.cash_conversion_ratio ?? null;
  const normalizedMaintenanceShare = clamp(
    maintenanceCapexShare
      + (cashConversionRatio != null && cashConversionRatio < 0.75 ? 0.08 : 0)
      + (salesGrowth > 0.12 ? -0.04 : salesGrowth < 0.03 ? 0.04 : 0),
    0.45,
    0.92,
  );
  const maintenanceCapex = Math.min(capex, Math.max(depreciation * maintenanceDepFloor, capex * normalizedMaintenanceShare));
  const growthCapex = Math.max(capex - maintenanceCapex, 0);
  const ownerEarningsTotal = cfo - maintenanceCapex;
  const ownerEarningsPerShare = shares && shares > 0 ? ownerEarningsTotal / shares : null;
  const owcLatest = (latest.bs.Inventory ?? 0) + (latest.bs.TradeReceivables ?? 0) - (latest.bs.TradePayables ?? 0);
  const owcPrev = prev ? (prev.bs.Inventory ?? 0) + (prev.bs.TradeReceivables ?? 0) - (prev.bs.TradePayables ?? 0) : owcLatest;
  const workingCapitalInvestment = Math.max(owcLatest - owcPrev, 0);
  const nopat = latest.is.OI;
  const totalReinvestment = growthCapex + workingCapitalInvestment;
  const reinvestmentRate = nopat > 0 ? totalReinvestment / nopat : null;
  const prevNopat = prev ? prev.is.OI : null;
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
    cashConversionRatio,
    maintenanceCapexShareOfCapex,
    maintenanceCapexShareAssumption: normalizedMaintenanceShare,
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

function persistencePenalty(persistenceScore: number) {
  if (persistenceScore >= 75) return 0;
  if (persistenceScore >= 60) return 0.03;
  if (persistenceScore >= 45) return 0.07;
  return 0.12;
}

function persistenceConvictionCap(persistenceScore: number): ValuationSignalState {
  if (persistenceScore >= 75) return "screaming-buy";
  if (persistenceScore >= 60) return "high-conviction";
  if (persistenceScore >= 45) return "interesting";
  return "watchlist";
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


/** Generate high-level label describing what the market is pricing. */
function marketExpectationLabel(impliedGrowth: number | null, impliedROIC: number | null, impliedKE: number | null, ke: number, normalizedGrowth: number) {
  if (impliedGrowth == null) return "Insufficient data";
  if (impliedGrowth < 0 && impliedROIC != null && impliedROIC < ke) return "Value trap — declining growth with poor returns";
  if (impliedGrowth > normalizedGrowth * 1.5 && impliedROIC != null && impliedROIC > 0.25) return "Aggressive growth + quality priced in";
  if (impliedGrowth <= normalizedGrowth * 0.5 && impliedKE != null && impliedKE > ke + 0.05) return "Market prices high risk, low growth";
  if (impliedGrowth > normalizedGrowth * 1.2) return "Growth priced in — execution risk high";
  if (impliedGrowth < normalizedGrowth * 0.8) return "Pessimistic — market assumes deterioration";
  return "Normalization priced — close to sector anchor";
}

type CoreBuildContext = {
  data: RecastPeriod[];
  config: EngineConfig;
  marketData?: LiveMarketDataSnapshot | null;
  analysisStatus?: AnalysisStatusSummary | null;
  /** Phase C5 — parsed segment data for SOTP valuation (business segments). */
  segmentData?: SegmentData | null;
};

type CoreBuildResult = Omit<ValuationCommandCenterOutput, "backtest">;

function normalizeHistoricalSeries(points: MarketHistoryPoint[] | null | undefined) {
  if (!points?.length) return [];
  return [...points].sort((left, right) => right.date.localeCompare(left.date));
}

function scoreFreshness(freshness: LiveMarketDataFreshness | null | undefined) {
  if (freshness === "live") return 1;
  if (freshness === "stale") return 0.6;
  if (freshness === "fallback") return 0.35;
  return 0;
}

function scenarioOrderingPenalty(args: {
  stress: ValuationScenarioCard | null;
  base: ValuationScenarioCard | null;
  panic: ValuationScenarioCard | null;
}) {
  const { stress, base, panic } = args;
  let penalty = 0;
  if ((stress?.intrinsicPerShare ?? Number.POSITIVE_INFINITY) > (base?.intrinsicPerShare ?? Number.POSITIVE_INFINITY)) penalty += 10;
  if ((panic?.intrinsicPerShare ?? Number.POSITIVE_INFINITY) > (stress?.intrinsicPerShare ?? Number.POSITIVE_INFINITY)) penalty += 8;
  if ((stress?.expectedCagr ?? Number.POSITIVE_INFINITY) > (base?.expectedCagr ?? Number.POSITIVE_INFINITY)) penalty += 5;
  return penalty;
}

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
  const stressForecastPolicy = stressCard?.forecastPolicy;
  const whatMustGoRight = [
    `Reinvestment must stay disciplined enough to preserve a stress-case margin of safety near ${formatPct(stressCard?.marginOfSafetyPct, 1)}.`,
    `Owner-earnings conversion needs to hold above the current cash conversion regime of ${formatPct(diagnostics.cashConversionRatio, 1)}.`,
    `The market cannot already be right about a weak long-term trajectory; current reverse DCF still needs to remain below the sector-normal anchor.`,
  ];
  const forecastDiscipline = [
    stressForecastPolicy?.workingCapitalPressure === "high"
      ? "Working-capital pressure is elevated, so any upside case requires materially better cash conversion than the current regime."
      : "Working-capital drag is not currently the main fragility in the forecast path.",
    stressForecastPolicy?.reinvestmentBurden === "heavy"
      ? "Incremental capital needs are heavy, so forecast upside should be judged against reinvestment strain, not revenue alone."
      : "Reinvestment burden remains manageable enough that growth can be judged with normal fade discipline.",
    stressForecastPolicy?.balanceSheetFlexibility === "tight"
      ? "Balance-sheet flexibility is tight, so the business cannot be valued as if financing is frictionless."
      : "Balance-sheet flexibility is adequate enough that execution, not financing, remains the main forecast variable.",
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
    forecastDiscipline,
  } satisfies ValuationChecklist;
}

function buildCoreCommandCenter(context: CoreBuildContext): CoreBuildResult {
  const { data, config, marketData, analysisStatus } = context;
  const shareBasis = resolveShareBasis(data, config);
  const valuationReadiness = resolveValuationReadiness(data);
  const weakShareBasis = shareBasis.confidence === "LOW" || shareBasis.confidence === "FAILED";
  const valuationData = data.slice(0, Math.max(2, valuationReadiness.anchorIndex + 1));
  const latest = valuationData[valuationData.length - 1];
  const prev = valuationData.length >= 2 ? valuationData[valuationData.length - 2] : null;
  const latestReported = data[data.length - 1];
  const shares = shareBasis.shares ?? null;
  const marketPrice = marketData?.price ?? config.market_price ?? null;
  const riskFreeRate = marketData?.riskFreeRate ?? config.risk_free_rate;
  const marketFreshness = marketData?.freshness ?? (marketPrice != null || marketData?.riskFreeRate != null ? "fallback" : "missing");
  const freshnessScore = scoreFreshness(marketFreshness);
  const marketWarnings = marketData?.warnings ?? [];
  const orderedHistory = normalizeHistoricalSeries(marketData?.history?.points);
  const historySummary = orderedHistory.length ? summarizeHistoricalPrices(orderedHistory, marketPrice) : marketData?.history ?? null;
  const { template: sectorTemplate, source: sectorTemplateSource } = resolveValuationSectorTemplate(valuationData, config.sector_template);
  const horizon = 5;

  const diagnostics = computeCashFlowDiagnostics(
    latest,
    prev,
    shares,
    sectorTemplate.maintenanceCapexShare,
    sectorTemplate.maintenanceDepFloor,
  );
  const businessModel = buildBusinessModelProfile(valuationData);
  const qualityScore = computeQualityScore(latest, analysisStatus);
  const confidenceState = analysisStatus?.status ?? "unknown";
  const persistencePenaltyPct = persistencePenalty(businessModel.persistenceScore);
  const requiredMarginOfSafetyPct = clamp(
    sectorTemplate.baseRequiredMarginOfSafety
      + (sectorTemplate.cyclical ? 0.04 : 0)
      + (qualityScore < 55 ? 0.1 : qualityScore < 70 ? 0.05 : qualityScore > 85 ? -0.03 : 0)
      + persistencePenaltyPct
      + (confidenceState === "guarded" ? 0.04 : 0)
      + (confidenceState === "blocked" ? 0.1 : 0)
      + (valuationReadiness.status !== "production-ready" ? 0.04 : 0)
      + (marketFreshness === "stale" ? 0.03 : marketFreshness === "fallback" ? 0.05 : marketFreshness === "missing" ? 0.08 : 0),
    0.18,
    0.6,
  );

  const keBase = config.ke > 0 ? config.ke : ke_from_config({ ...config, risk_free_rate: riskFreeRate });
  const kwBase = valuationData.length >= 2
    ? deriveKwFromStructure(valuationData[valuationData.length - 1], valuationData[valuationData.length - 2], keBase, riskFreeRate, config)
    : riskFreeRate;
  const makeScenario = (
    key: ValuationScenarioCard["key"],
    scenario: ForecastScenario,
    reinvestmentLift: number,
  ) => {
    const terminalGrowth = clamp(
      config.g_terminal_override ?? scenario.drivers.g_terminal,
      sectorTemplate.terminalGrowthFloor,
      sectorTemplate.terminalGrowthCap,
    );
    const scenarioWithTerminal = {
      ...scenario,
      drivers: {
        ...scenario.drivers,
        g_terminal: terminalGrowth,
      },
    } satisfies ForecastScenario;
    const periods = buildScenario(scenarioWithTerminal, latest);
    const valuationPeriods = buildValuationPeriodsFromForecast(latest, periods);
    const valuation = computeValuation(
      valuationPeriods,
      scenarioWithTerminal.drivers.ke,
      scenarioWithTerminal.drivers.kw,
      terminalGrowth,
      shareBasis.valuationConfig,
    );
    const ownerDcf = computeOwnerEarningsDcf(diagnostics.ownerEarningsPerShare, scenarioWithTerminal.drivers.sales_growth, scenarioWithTerminal.drivers.ke, terminalGrowth);
    const intrinsicPerShare = computeScenarioIntrinsicPerShare(valuation, ownerDcf);
    const marginOfSafetyPct = marginOfSafety(intrinsicPerShare, marketPrice);
    return {
      key,
      label: key === "stress" ? "Stress case" : key === "base" ? "Base case" : key === "bull" ? "Bull case" : "Historical panic",
      scenario: scenarioWithTerminal,
      intrinsicPerShare,
      upsidePct: intrinsicPerShare != null && marketPrice != null && marketPrice > 0 ? (intrinsicPerShare - marketPrice) / marketPrice : null,
      marginOfSafetyPct,
      expectedCagr: annualizedReturn(marketPrice, intrinsicPerShare, 3),
      valuation,
      forecastPolicy: scenarioWithTerminal.forecastPolicy,
      assumptions: {
        ke: scenarioWithTerminal.drivers.ke,
        kw: scenarioWithTerminal.drivers.kw,
        g: terminalGrowth,
        salesGrowthYear1: scenarioWithTerminal.drivers.sales_growth[0] ?? 0,
        corePmYear1: scenarioWithTerminal.drivers.core_sales_pm[0] ?? 0,
        reinvestmentRateYear1: diagnostics.reinvestmentRate != null
          ? clamp(diagnostics.reinvestmentRate * reinvestmentLift, 0, 1.2)
          : null,
        incrementalRoicYear1: diagnostics.incrementalRoic != null
          ? clamp(diagnostics.incrementalRoic * (1 - (reinvestmentLift - 1) * 0.2), -0.1, 0.5)
          : null,
      },
    } satisfies ValuationScenarioCard;
  };

  const derivedScenarios = {
    stress: derivePersistenceForecastScenario({
      scenarioKey: "stress",
      periods: valuationData,
      latest,
      businessModel,
      horizon,
      template: sectorTemplate,
      riskInputs: { ke: keBase, kw: kwBase, riskFreeRate },
    }),
    base: derivePersistenceForecastScenario({
      scenarioKey: "base",
      periods: valuationData,
      latest,
      businessModel,
      horizon,
      template: sectorTemplate,
      riskInputs: { ke: keBase, kw: kwBase, riskFreeRate },
    }),
    bull: derivePersistenceForecastScenario({
      scenarioKey: "bull",
      periods: valuationData,
      latest,
      businessModel,
      horizon,
      template: sectorTemplate,
      riskInputs: { ke: keBase, kw: kwBase, riskFreeRate },
    }),
    historicalPanic: derivePersistenceForecastScenario({
      scenarioKey: "historical-panic",
      periods: valuationData,
      latest,
      businessModel,
      horizon,
      template: sectorTemplate,
      riskInputs: { ke: keBase, kw: kwBase, riskFreeRate },
    }),
  };

  const scenarios: ValuationScenarioCard[] = normalizeScenarioCards([
    makeScenario("stress", derivedScenarios.stress, 1.15),
    makeScenario("base", derivedScenarios.base, 1),
    makeScenario("bull", derivedScenarios.bull, 0.9),
    makeScenario("historical-panic", derivedScenarios.historicalPanic, 1.2),
  ], marketPrice);

  const stressCard = scenarios.find((card) => card.key === "stress") ?? null;
  const baseCard = scenarios.find((card) => card.key === "base") ?? null;
  const panicCard = scenarios.find((card) => card.key === "historical-panic") ?? null;
  const scenarioPenalty = scenarioOrderingPenalty({ stress: stressCard, base: baseCard, panic: panicCard });
  const stressUpsidePct = opportunityMetrics(stressCard, marketPrice).upsidePct;
  const baseUpsidePct = opportunityMetrics(baseCard, marketPrice).upsidePct;
  const historicalPercentile = historySummary?.currentPricePercentile ?? null;
  const replayCoverageScore = orderedHistory.length >= 260 ? 1 : orderedHistory.length >= 120 ? 0.6 : 0.2;
  const ownerEarningsResolved = diagnostics.ownerEarningsPerShare != null && !weakShareBasis;
  const confidencePenalty = (analysisStatus?.status === "guarded" ? 8 : analysisStatus?.status === "blocked" ? 25 : 0)
    + (valuationReadiness.status !== "production-ready" ? 10 : 0)
    + (ownerEarningsResolved ? 0 : 10)
    + (weakShareBasis ? 14 : 0)
    + (data.length < 4 ? 8 : 0)
    + (data.length < 3 ? 10 : 0)
    + (data.length < 2 ? 25 : 0)
    + (100 - businessModel.persistenceScore) * 0.18
    + (1 - freshnessScore) * 18
    + scenarioPenalty;

  const perShareBlocked = weakShareBasis || data.length < 2;
  const perShareGuarded = !perShareBlocked && (shareBasis.confidence === "MEDIUM" || data.length < 4);
  const rareSignalSupport = freshnessScore >= 0.6 && replayCoverageScore >= 0.6;
  const strongSignalSupport = freshnessScore >= 0.35;
  const confidenceCeilingState: ValuationSignalState =
    analysisStatus?.status === "blocked"
      ? "blocked"
      : analysisStatus?.status === "guarded" || valuationReadiness.status !== "production-ready"
        ? "guarded"
        : freshnessScore < 0.35
          ? "watchlist"
          : "screaming-buy";
  const confidenceCeilingRank = confidenceCeilingState === "blocked"
    ? 0
    : confidenceCeilingState === "guarded"
      ? 1
      : confidenceCeilingState === "watchlist"
        ? 2
        : 5;
  const rankToState = (rank: number): ValuationSignalState => (rank <= 0
    ? "blocked"
    : rank === 1
      ? "guarded"
      : rank === 2
        ? "watchlist"
        : rank === 3
          ? "interesting"
          : rank === 4
            ? "high-conviction"
            : "screaming-buy");
  const clampStateRank = (rank: number) => rankToState(Math.min(rank, confidenceCeilingRank));
  const staleOrFallbackMessage = marketFreshness === "stale"
    ? "Live market inputs are stale, so aggressive signal states stay capped until refreshed."
    : marketFreshness === "fallback"
      ? "Live market inputs are running on fallback values, so the valuation remains research-grade only."
      : marketFreshness === "missing"
        ? "Live market inputs are unavailable, so the command center cannot escalate beyond guarded research."
        : null;

  const reverseDcf = buildReverseDcfExpectation({
    marketPrice,
    diagnostics,
    baseCard,
    keBase,
    kwBase,
    cse0: latest.bs.CSE,
    noaT: latest.bs.NOA,
    shares,
    normalizedGrowth: sectorTemplate.normalizedGrowth,
    terminalGrowth: baseCard?.assumptions.g ?? derivedScenarios.base.drivers.g_terminal,
  });

  // ── SOTP Valuation (Phase 2.2 + C5) ──────────────────────────
  // Priority: parsed segment data > preset > null
  const { segmentData } = context;
  let sotpResult: SOTPResult | null = null;
  let conglomerateAssessment: ConglomerateAssessment | null = null;

  if (segmentData && segmentData.segmentationType === "business" && segmentData.segments.length >= 2) {
    // Phase C5: use actual parsed segment data
    const enhanced = runSOTPFromSegmentData(segmentData, latest, keBase);
    sotpResult = enhanced;
    const { definitions } = segmentDataToDefinitions(segmentData);
    const distinctTemplates = new Set(definitions.map(d => d.sectorTemplate));
    const maxShare = definitions.length > 0 ? Math.max(...definitions.map(d => d.operatingProfitShare)) : 0;
    const dominantDef = definitions.reduce((a, b) => a.operatingProfitShare > b.operatingProfitShare ? a : b, definitions[0]);
    const isConglomerate = definitions.length >= 3 && distinctTemplates.size >= 2;
    conglomerateAssessment = {
      isConglomerate,
      segmentCount: definitions.length,
      distinctSectorTemplates: distinctTemplates.size,
      dominantSegmentPct: maxShare,
      dominantSegmentName: dominantDef?.name ?? "",
      dataSource: "parsed",
      sotpPreferred: isConglomerate && distinctTemplates.size >= 2,
    };
  } else {
    // Fallback: preset-based SOTP
    const sotpPresetKey = config.sotp_preset ?? null;
    if (sotpPresetKey && sotpPresetKey in SOTP_PRESETS) {
      const presetDefs = SOTP_PRESETS[sotpPresetKey];
      sotpResult = buildSOTPValuation(latest, presetDefs, keBase);
      const distinctTemplates = new Set(presetDefs.map(d => d.sectorTemplate));
      const maxShare = Math.max(...presetDefs.map(d => d.operatingProfitShare));
      const dominantDef = presetDefs.reduce((a, b) => a.operatingProfitShare > b.operatingProfitShare ? a : b, presetDefs[0]);
      const isConglomerate = presetDefs.length >= 3 && distinctTemplates.size >= 2;
      conglomerateAssessment = {
        isConglomerate,
        segmentCount: presetDefs.length,
        distinctSectorTemplates: distinctTemplates.size,
        dominantSegmentPct: maxShare,
        dominantSegmentName: dominantDef?.name ?? "",
        dataSource: "preset",
        sotpPreferred: isConglomerate && distinctTemplates.size >= 2,
      };
    }
  }

  // ── EV/EBITDA Cross-Check (Phase 2.4) ────────────────────────
  const evEbitda = computeEvEbitdaCrossCheck(latest, config.ev_ebitda_peers ?? []);
  const evEbitdaWithMarket = marketPrice != null && shares != null && shares > 0
    ? updateEvEbitdaWithMarketPrice(evEbitda, marketPrice * shares, latest.bs.NFO)
    : evEbitda;

  // ── India Quality Signals (Phase 2.3) ────────────────────────
  const indiaQuality = computeIndiaQualitySignals({ current: latest, previous: prev });

  // ── Earnings Quality (Phase 5.1-5.3) ─────────────────────────
  const { ddResult, remResult } = buildDechowDichevAndRem(data);
  const earningsQuality = buildEarningsQualityCard(
    ddResult,
    remResult,
    latest.ratios?.dirty_surplus_pct_cse ?? null,
    latest.ratios?.cash_conversion_ratio ?? null,
    latest.ratios?.accrual_ratio_bs ?? null,
  );

  const historicalCheapnessScore = historicalPercentile != null ? (1 - clamp(historicalPercentile, 0, 1)) * 100 : null;
  const reverseDcfPessimismScore = reverseDcf.spreadVsNormalizedGrowth != null
    ? clamp((sectorTemplate.normalizedGrowth - (sectorTemplate.normalizedGrowth + reverseDcf.spreadVsNormalizedGrowth)) / Math.max(sectorTemplate.normalizedGrowth, 0.01), 0, 1) * 100
    : null;

  const opportunityScore = clamp(
    (qualityScore * 0.28)
      + ((stressCard?.marginOfSafetyPct != null ? scoreFromRange(stressCard.marginOfSafetyPct, 0, requiredMarginOfSafetyPct + 0.12) : 0) * 28)
      + ((baseCard?.marginOfSafetyPct != null ? scoreFromRange(baseCard.marginOfSafetyPct, 0, requiredMarginOfSafetyPct + 0.18) : 0) * 20)
      + ((historicalCheapnessScore ?? 40) * 0.08)
      + ((reverseDcfPessimismScore ?? 35) * 0.08)
      + (freshnessScore * 10)
      + (replayCoverageScore * 6)
      - confidencePenalty,
    0,
    100,
  );

  const persistenceConvictionCeiling = businessModel.persistenceScore >= 75
    ? 4
    : businessModel.persistenceScore >= 60
      ? 3
      : businessModel.persistenceScore >= 45
        ? 2
        : 1;
  const convictionBucketRank = opportunityScore >= 90 && (stressCard?.marginOfSafetyPct ?? -1) >= requiredMarginOfSafetyPct && (historicalPercentile ?? 1) <= sectorTemplate.historicalExtremePercentile
    ? 4
    : opportunityScore >= 78
      ? 3
      : opportunityScore >= 62
        ? 2
        : opportunityScore >= 45
          ? 1
          : 0;
  const convictionBucket: ValuationOpportunityAssessment["convictionBucket"] =
    Math.min(convictionBucketRank, persistenceConvictionCeiling) >= 4
      ? "truck-load zone"
      : Math.min(convictionBucketRank, persistenceConvictionCeiling) >= 3
        ? "high-conviction"
        : Math.min(convictionBucketRank, persistenceConvictionCeiling) >= 2
          ? "accumulate"
          : Math.min(convictionBucketRank, persistenceConvictionCeiling) >= 1
            ? "starter"
            : "research-only";

  const opportunity: ValuationOpportunityAssessment = {
    qualityScore,
    requiredMarginOfSafetyPct,
    baseMarginOfSafetyPct: opportunityMetrics(baseCard, marketPrice).marginOfSafetyPct,
    stressMarginOfSafetyPct: opportunityMetrics(stressCard, marketPrice).marginOfSafetyPct,
    expectedCagrBase: opportunityMetrics(baseCard, marketPrice).expectedCagr,
    expectedCagrStress: opportunityMetrics(stressCard, marketPrice).expectedCagr,
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
    persistenceNarrative:
      stressCard?.forecastPolicy?.workingCapitalPressure === "high"
        ? "Persistence remains constrained by weak cash conversion and working-capital drag, so upside depends on a real improvement in business discipline rather than multiple expansion alone."
        : stressCard?.forecastPolicy?.reinvestmentBurden === "heavy"
          ? "Persistence remains constrained by heavy reinvestment needs, so growth only deserves credit if it compounds without consuming disproportionate capital."
          : stressCard?.forecastPolicy?.balanceSheetFlexibility === "tight"
            ? "Persistence remains constrained by financing tightness, so valuation assumes the business cannot extend an aggressive path for long."
            : businessModel.persistenceScore >= 65
              ? "Persistence looks durable enough that company evidence, not just template priors, can drive the valuation within guardrails."
              : "Persistence remains mixed, so valuation still assumes measured fade toward anchored economics.",
  };

  const marketContext: ValuationMarketContext = {
    expectedReturnSpreadVsRf: opportunity.expectedCagrStress != null ? opportunity.expectedCagrStress - riskFreeRate : null,
    marketCapFromPrice: marketPrice != null && shares != null ? marketPrice * shares : null,
    enterpriseValueFromPrice: marketPrice != null && shares != null ? marketPrice * shares + latest.bs.NFO : null,
    priceToStressValueRatio: marketPrice != null && (stressCard?.intrinsicPerShare ?? null) != null && (stressCard?.intrinsicPerShare ?? 0) > 0
      ? marketPrice / (stressCard?.intrinsicPerShare ?? 1)
      : null,
    freshness: marketFreshness,
    sourceSummary: marketData?.sourceSummary ?? "Using manual/config market inputs.",
    livePriceAsOf: marketData?.priceAsOf ?? null,
    liveRateAsOf: marketData?.rateAsOf ?? null,
    warningCount: marketWarnings.length,
    valuationAnchorPeriod: valuationReadiness.anchorPeriod,
    latestReportedPeriod: latestReported.period_end,
  };

  const replaySummary = orderedHistory.length >= 260
    ? "Historical replay has enough price history to help discipline rare-signal labels."
    : orderedHistory.length >= 120
      ? "Historical replay is usable but still thin for aggressive-signal calibration."
      : "Historical replay coverage is thin, so rare-signal calibration remains provisional.";

  const valuationReadinessSummary = perShareBlocked
    ? "Per-share valuation is blocked because share-count evidence or history depth is not defensible enough yet."
    : perShareGuarded
      ? `Per-share valuation remains guarded because share-count confidence is ${shareBasis.confidence.toLowerCase()} and/or history depth is still thin.`
      : valuationReadiness.status === "production-ready"
        ? `Valuation uses the latest reported anchor period ${valuationReadiness.anchorPeriod ?? latest.period_end}.`
        : valuationReadiness.fallbackUsed
          ? `Valuation falls back to anchor period ${valuationReadiness.anchorPeriod ?? latest.period_end} because the latest reported period is not clean enough for full-confidence terminal assumptions.`
          : valuationReadiness.reasons[0] ?? "Valuation remains guarded because the current anchor is not fully clean.";

  const marketFreshnessSummary = staleOrFallbackMessage
    ?? (marketWarnings.length
      ? `Market overlay includes ${marketWarnings.length} provider warning${marketWarnings.length === 1 ? "" : "s"}.`
      : "Live market overlay is current enough to support signal evaluation.");

  const checklist = buildChecklist({
    opportunity,
    diagnostics,
    reverseDcf,
    marketContext,
    stressCard,
    analysisStatus,
  });

  checklist.whatMustGoRight.unshift(valuationReadinessSummary, marketFreshnessSummary);
  checklist.thesisBreakers.unshift(replaySummary);
  checklist.forecastDiscipline.unshift(opportunity.persistenceNarrative);

  const killSwitches = [
    ...(analysisStatus?.status === "blocked" ? [analysisStatus.summary] : []),
    ...(perShareBlocked ? [valuationReadinessSummary] : []),
    ...(valuationReadiness.status !== "production-ready" && confidenceState === "blocked" ? [valuationReadiness.reasons[0] ?? "Valuation anchor is not production-ready."] : []),
    ...(marketPrice == null ? ["Current market price is unavailable."] : []),
    ...(marketFreshness === "missing" ? ["Live market data is unavailable."] : []),
    ...(diagnostics.ownerEarningsPerShare == null ? ["Owner earnings per share could not be resolved from current data."] : []),
  ];

  const supportingFlags = [
    ...(baseCard?.forecastPolicy?.terminalAnchorSource === "company-evidence"
      ? ["Base-case terminal assumptions are being led by company evidence rather than template priors."]
      : []),
    ...(stressCard?.forecastPolicy?.workingCapitalPressure === "high"
      ? ["Forecast policy detects high working-capital pressure and keeps downside assumptions tight."]
      : []),
    ...(stressCard?.forecastPolicy?.reinvestmentBurden === "heavy"
      ? ["Forecast policy penalizes heavy reinvestment burden before allowing conviction to rise."]
      : []),
    ...(stressCard?.forecastPolicy?.balanceSheetFlexibility === "tight"
      ? ["Forecast policy recognizes tight balance-sheet flexibility and prevents frictionless upside assumptions."]
      : []),
    ...(historicalPercentile != null && historicalPercentile <= sectorTemplate.historicalExtremePercentile
      ? ["Current price sits in a historically dislocated range for this company."]
      : []),
    ...(baseCard?.expectedCagr != null && baseCard.expectedCagr > 0.18
      ? ["Base-case rerating implies an attractive three-year expected CAGR."]
      : []),
    ...appendCrossCheckWarning([], scenarios),
    ...(stressCard?.marginOfSafetyPct != null && stressCard.marginOfSafetyPct >= requiredMarginOfSafetyPct
      ? ["Stress-case value still clears the quality-adjusted margin-of-safety hurdle."]
      : []),
    ...(reverseDcf.impliedOwnerEarningsGrowth != null && reverseDcf.impliedOwnerEarningsGrowth < sectorTemplate.normalizedGrowth * 0.75
      ? ["Reverse DCF shows the market is pricing a subdued owner-earnings path."]
      : []),
    ...(qualityScore >= 80 ? ["Accounting quality, balance-sheet resilience, and cash conversion remain strong."] : []),
    ...(valuationReadiness.fallbackUsed ? [`Valuation is anchored to prior clean period ${valuationReadiness.anchorPeriod ?? "—"}.`] : []),
    ...(marketFreshness === "live" ? ["Live market overlay is current and timestamped."] : []),
  ];

  let state: ValuationSignalState = "watchlist";
  let summary = "Current valuation is worth tracking, but it is not yet a rare market-led opportunity.";

  if (killSwitches.length) {
    state = analysisStatus?.status === "blocked" ? "blocked" : "guarded";
    summary = killSwitches[0];
  } else if (
    confidenceState === "production-ready"
    && rareSignalSupport
    && opportunityScore >= 92
    && (stressCard?.marginOfSafetyPct ?? -1) >= requiredMarginOfSafetyPct
    && (baseCard?.marginOfSafetyPct ?? -1) >= requiredMarginOfSafetyPct + 0.12
    && (historicalPercentile ?? 1) <= sectorTemplate.historicalExtremePercentile
    && (reverseDcf.impliedOwnerEarningsGrowth ?? Infinity) <= sectorTemplate.normalizedGrowth * 0.8
  ) {
    state = clampStateRank(5);
    summary = state === "screaming-buy"
      ? "This qualifies as a rare dislocation: even the stressed case clears the hurdle and the market setup is historically extreme."
      : valuationReadinessSummary;
  } else if (
    strongSignalSupport
    && opportunityScore >= 80
    && (stressCard?.marginOfSafetyPct ?? -1) >= requiredMarginOfSafetyPct * 0.8
    && (baseCard?.marginOfSafetyPct ?? -1) >= requiredMarginOfSafetyPct
    && (reverseDcf.impliedOwnerEarningsGrowth ?? Infinity) <= sectorTemplate.normalizedGrowth * 1.05
  ) {
    state = clampStateRank(4);
    summary = state === "high-conviction"
      ? summaryWithCrossCheckWarning("The setup clears the quality-adjusted hurdle in both the base and stress cases with attractive expected returns.", scenarios)
      : marketFreshnessSummary;
  } else if (
    (baseUpsidePct ?? -1) > sectorTemplate.stressBaseUpside
    && (stressUpsidePct ?? -1) > sectorTemplate.stressProtectedUpside
  ) {
    state = clampStateRank(3);
    summary = state === "interesting"
      ? summaryWithCrossCheckWarning("The base case is attractive and the stress case still preserves enough upside to stay actionable.", scenarios)
      : replaySummary;
  }

  if (scenarioPenalty > 0 && state !== "blocked" && state !== "guarded") {
    state = clampStateRank(Math.max((state === "screaming-buy" ? 5 : state === "high-conviction" ? 4 : state === "interesting" ? 3 : 2) - 1, 2));
    summary = "Scenario ordering needs review because the conservative cases are not sufficiently below the base case.";
  }

  const persistenceCeilingState = persistenceConvictionCap(businessModel.persistenceScore);
  const persistenceCeilingRank = persistenceCeilingState === "watchlist"
    ? 2
    : persistenceCeilingState === "interesting"
      ? 3
      : persistenceCeilingState === "high-conviction"
        ? 4
        : 5;
  if (state !== "blocked" && state !== "guarded") {
    const currentRank = state === "screaming-buy" ? 5 : state === "high-conviction" ? 4 : state === "interesting" ? 3 : 2;
    if (currentRank > persistenceCeilingRank) {
      state = rankToState(persistenceCeilingRank);
      summary = businessModel.persistenceScore < 45
        ? "Business-model persistence is weak, so conviction stays capped until margins, cash conversion, and reinvestment quality prove more durable."
        : "Persistence evidence is mixed, so aggressive conviction stays capped despite apparent upside.";
    }
  }

  if (valuationReadiness.status !== "production-ready" && state !== "blocked") {
    state = clampStateRank(Math.min(state === "screaming-buy" ? 5 : state === "high-conviction" ? 4 : state === "interesting" ? 3 : 2, 1));
    summary = valuationReadinessSummary;
  }

  if (staleOrFallbackMessage && state !== "blocked" && state !== "guarded") {
    state = clampStateRank(Math.min(state === "screaming-buy" ? 5 : state === "high-conviction" ? 4 : state === "interesting" ? 3 : 2, marketFreshness === "stale" ? 3 : 2));
    summary = staleOrFallbackMessage;
  }

  return {
    shareBasis,
    valuationReadiness,
    marketPrice,
    riskFreeRate,
    asOf: marketData?.priceAsOf ?? marketData?.fetchedAt ?? null,
    sectorTemplate: {
      id: sectorTemplate.id,
      label: sectorTemplate.label,
      description: sectorTemplate.description,
      source: sectorTemplateSource,
    },
    businessModel,
    scenarios,
    diagnostics,
    reverseDcf,
    sotp: sotpResult,
    conglomerate: conglomerateAssessment,
    evEbitda: evEbitdaWithMarket,
    indiaQuality,
    earningsQuality,
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
      summary: summaryWithCrossCheckWarning(summary, scenarios),
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
      supportingFlags: appendCrossCheckWarning(supportingFlags, scenarios),
      killSwitches,
    },
    range: primaryValueRange(scenarios),
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
