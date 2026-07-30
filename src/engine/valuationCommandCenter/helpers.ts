import { LiveMarketDataFreshness, MarketHistoryPoint } from "../marketData";
import { AnalysisStatusSummary } from "../analysisStatus";
import { RecastPeriod, ValuationResult } from "../types";
import { resolveShareBasis, toPerShare } from "../shareCountTools";
import { SOTPResult } from "../sotpValuation";
import {
  solveImpliedKeFromOwnerEarnings,
  solveImpliedTerminalRoicFromValue,
  solveImpliedGrowthForTarget,
} from "./solvers";
import { formatPct } from "./formatters";
import {
  ValuationScenarioCard,
  DcfCashFlowDiagnostics,
  NarrativeBandEntry,
  ReverseDcfDiagnostics,
  ValuationOpportunityAssessment,
  ValuationChecklist,
  ValuationMarketContext,
  ValuationBacktestPoint,
  ValuationBacktestSummary,
  ValuationSignalState,
} from "./types";

export function median(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!filtered.length) return null;
  const middle = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 0 ? (filtered[middle - 1]! + filtered[middle]!) / 2 : filtered[middle]!;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function annualizedReturn(from: number | null, to: number | null, years = 3) {
  if (from == null || to == null || from <= 0 || to <= 0) return null;
  return Math.pow(to / from, 1 / years) - 1;
}

export function marginOfSafety(intrinsicPerShare: number | null, marketPrice: number | null) {
  if (intrinsicPerShare == null || marketPrice == null || intrinsicPerShare <= 0) return null;
  return 1 - marketPrice / intrinsicPerShare;
}

export function scoreFromRange(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  return clamp((value - min) / Math.max(max - min, 1e-9), 0, 1);
}



export function computeScenarioIntrinsicPerShare(valuation: ValuationResult, ownerEarningsDcf: number | null) {
  const accrualFamilyValue = median([
    valuation.perShare?.intrinsic_re_per_share ?? null,
    valuation.perShare?.intrinsic_reoi_per_share ?? null,
  ]);
  return median([
    accrualFamilyValue,
    ownerEarningsDcf,
  ]);
}

export function computeCrossCheckSpread(valuation: ValuationResult) {
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

export function buildNarrativeSpacePerShare(params: {
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

export function describeKeExpectation(impliedKe: number | null, ke: number) {
  if (impliedKe == null) return null;
  if (impliedKe > ke + 0.05) return "Market pricing implies a materially higher required return than the base cost of equity.";
  if (impliedKe < ke - 0.03) return "Market pricing implies a lower required return than the base cost of equity.";
  return "Market pricing implies a required return close to the base cost of equity.";
}

export function describeTerminalRoicExpectation(impliedTerminalROIC: number | null, kw: number) {
  if (impliedTerminalROIC == null) return null;
  if (impliedTerminalROIC > kw + 0.08) return "Market pricing assumes terminal returns meaningfully above the operating capital charge.";
  if (impliedTerminalROIC < kw) return "Market pricing assumes terminal returns below the operating capital charge.";
  return "Market pricing implies terminal returns close to the operating capital charge.";
}

export function extendExpectationLabel(base: string, additions: Array<string | null>) {
  const cleanAdditions = additions.filter((value): value is string => Boolean(value));
  return cleanAdditions.length ? `${base} ${cleanAdditions.join(" ")}` : base;
}




export function primaryValuationPerShare(valuation: ValuationResult) {
  return median([
    valuation.perShare?.intrinsic_re_per_share ?? null,
    valuation.perShare?.intrinsic_reoi_per_share ?? null,
  ]);
}

export function isSuspiciousCrossCheckSpread(spread: number | null) {
  return spread != null && Math.abs(spread) > 0.5;
}

export function crossCheckGuardSummary() {
  return "FCFF/FCFE cross-checks remain diagnostic only because they diverge materially from the primary RE / ReOI valuation family.";
}

export function deriveBaseGrowthPath(card: ValuationScenarioCard | null, fallback: number) {
  if (card?.scenario.drivers.sales_growth?.length) return card.scenario.drivers.sales_growth;
  return Array.from({ length: 5 }, () => fallback);
}

export function applyPrimaryScenarioMetrics(card: ValuationScenarioCard, marketPrice: number | null) {
  const primaryValue = primaryValuationPerShare(card.valuation);
  return {
    ...card,
    intrinsicPerShare: primaryValue,
    upsidePct: primaryValue != null && marketPrice != null && marketPrice > 0 ? (primaryValue - marketPrice) / marketPrice : null,
    marginOfSafetyPct: marginOfSafety(primaryValue, marketPrice),
    expectedCagr: annualizedReturn(marketPrice, primaryValue, 3),
  } satisfies ValuationScenarioCard;
}

export function normalizeScenarioCards(cards: ValuationScenarioCard[], marketPrice: number | null) {
  return cards.map((card) => applyPrimaryScenarioMetrics(card, marketPrice));
}

export function buildReverseDcfExpectation(args: {
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

export function primaryValueRange(cards: ValuationScenarioCard[]) {
  const values = cards.map((card) => card.intrinsicPerShare).filter((value): value is number => value != null && Number.isFinite(value));
  return {
    floorPerShare: values.length ? Math.min(...values) : null,
    ceilingPerShare: values.length ? Math.max(...values) : null,
  };
}

/**
 * SOTP equity value per share, after the conglomerate discount.
 *
 * `discountedSum` is a whole-entity (enterprise) figure, so NFO is
 * subtracted to reach the common-equity claim a share price represents.
 * Both operands are ₹ crore and `shares` is crore shares, so the quotient
 * is already ₹/share — no 1e7 (see `types/units.ts:96`).
 *
 * Callers must pass the NFO of the period the SOTP was built at. That is the
 * *anchor* period, which `resolveValuationReadiness` moves off the newest
 * period when the terminal one is contaminated (`valuationPolicy.ts:145-166`);
 * pairing this sum with a different period's net debt mixes vintages.
 */
export function sotpEquityPerShare(
  sotp: SOTPResult,
  shareBasis: ReturnType<typeof resolveShareBasis>,
  nfo: number,
): number | null {
  return toPerShare(sotp.discountedSum - nfo, shareBasis.shares);
}

/** Phase C5: when SOTP is preferred, derive value range from SOTP EV. */
export function sotpValueRange(sotp: SOTPResult, shareBasis: ReturnType<typeof resolveShareBasis>, nfo: number) {
  const shares = shareBasis.shares ?? null;
  if (!shares || shares <= 0) return { floorPerShare: null, ceilingPerShare: null };
  // Floor: discounted sum (after conglomerate discount) - NFO. Same quantity
  // the radar plots, so it shares one definition.
  // Ceiling: undiscounted sum (no conglomerate discount) - NFO
  const equityCeiling = sotp.operatingSum - nfo;
  return {
    floorPerShare: sotpEquityPerShare(sotp, shareBasis, nfo),
    ceilingPerShare: equityCeiling / shares,
  };
}

export function appendCrossCheckWarning(flags: string[], cards: ValuationScenarioCard[]) {
  const warnings = cards
    .map((card) => ({ key: card.key, spread: computeCrossCheckSpread(card.valuation) }))
    .filter((entry) => isSuspiciousCrossCheckSpread(entry.spread))
    .map((entry) => `${entry.key} FCFF/FCFE cross-checks diverge materially from primary RE / ReOI valuation.`);
  return warnings.length ? [...flags, ...warnings] : flags;
}

export function summaryWithCrossCheckWarning(summary: string, cards: ValuationScenarioCard[]) {
  return cards.some((card) => isSuspiciousCrossCheckSpread(computeCrossCheckSpread(card.valuation)))
    ? `${summary} ${crossCheckGuardSummary()}`
    : summary;
}

export function opportunityMetrics(card: ValuationScenarioCard | null, marketPrice: number | null) {
  const primaryValue = card ? primaryValuationPerShare(card.valuation) : null;
  return {
    upsidePct: primaryValue != null && marketPrice != null && marketPrice > 0 ? (primaryValue - marketPrice) / marketPrice : null,
    marginOfSafetyPct: marginOfSafety(primaryValue, marketPrice),
    expectedCagr: annualizedReturn(marketPrice, primaryValue, 3),
  };
}
export function computeCashFlowDiagnostics(latest: RecastPeriod, prev: RecastPeriod | null, shares: number | null, maintenanceCapexShare: number, maintenanceDepFloor: number): DcfCashFlowDiagnostics {
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

export function computeQualityScore(latest: RecastPeriod, analysisStatus?: AnalysisStatusSummary | null) {
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

export function persistencePenalty(persistenceScore: number) {
  if (persistenceScore >= 75) return 0;
  if (persistenceScore >= 60) return 0.03;
  if (persistenceScore >= 45) return 0.07;
  return 0.12;
}

export function persistenceConvictionCap(persistenceScore: number): ValuationSignalState {
  if (persistenceScore >= 75) return "screaming-buy";
  if (persistenceScore >= 60) return "high-conviction";
  if (persistenceScore >= 45) return "interesting";
  return "watchlist";
}



export function describeExpectations(impliedGrowth: number | null, normalizedGrowth: number) {
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
export function marketExpectationLabel(impliedGrowth: number | null, impliedROIC: number | null, impliedKE: number | null, ke: number, normalizedGrowth: number) {
  if (impliedGrowth == null) return "Insufficient data";
  if (impliedGrowth < 0 && impliedROIC != null && impliedROIC < ke) return "Value trap — declining growth with poor returns";
  if (impliedGrowth > normalizedGrowth * 1.5 && impliedROIC != null && impliedROIC > 0.25) return "Aggressive growth + quality priced in";
  if (impliedGrowth <= normalizedGrowth * 0.5 && impliedKE != null && impliedKE > ke + 0.05) return "Market prices high risk, low growth";
  if (impliedGrowth > normalizedGrowth * 1.2) return "Growth priced in — execution risk high";
  if (impliedGrowth < normalizedGrowth * 0.8) return "Pessimistic — market assumes deterioration";
  return "Normalization priced — close to sector anchor";
}

export function normalizeHistoricalSeries(points: MarketHistoryPoint[] | null | undefined) {
  if (!points?.length) return [];
  return [...points].sort((left, right) => right.date.localeCompare(left.date));
}

export function scoreFreshness(freshness: LiveMarketDataFreshness | null | undefined) {
  if (freshness === "live") return 1;
  if (freshness === "stale") return 0.6;
  if (freshness === "fallback") return 0.35;
  return 0;
}

export function scenarioOrderingPenalty(args: {
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

export function emptyBacktest(reason: string): ValuationBacktestSummary {
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

export function closestHistoricalPrice(points: MarketHistoryPoint[], isoDate: string) {
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

export function futureHistoricalPrice(points: MarketHistoryPoint[], isoDate: string, daysForward: number) {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const target = new Date(isoDate);
  target.setUTCDate(target.getUTCDate() + daysForward);
  const targetDay = target.toISOString().slice(0, 10);
  return sorted.find((point) => point.date >= targetDay) ?? null;
}

export function summarizeReturns(points: ValuationBacktestPoint[], key: "realized1Y" | "realized3Y") {
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

export function buildChecklist(args: {
  opportunity: ValuationOpportunityAssessment;
  diagnostics: DcfCashFlowDiagnostics;
  reverseDcf: ReverseDcfDiagnostics;
  marketContext: ValuationMarketContext;
  stressCard: ValuationScenarioCard | null;
  analysisStatus?: AnalysisStatusSummary | null | undefined;
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
