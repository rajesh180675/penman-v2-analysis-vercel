/**
 * The valuation page's read model (command-center decomposition step 4,
 * docs/architecture/plans/2026-10-30-command-center-decomposition.md).
 *
 * From the valuation basis and the outputs of the models (models.ts) and
 * synthesis (synthesis.ts) stages, it assembles what the valuation page reads:
 * the opportunity assessment, the signal and its kill switches, the market
 * context, the checklist and the value range, in `ValuationCommandCenterOutput`'s
 * shape. It values nothing of its own: every number it reports is a stage's,
 * or a score or label computed from them. Each is computed exactly as it was
 * in `buildCoreCommandCenter`, so the command center's output is unchanged.
 */
import type { AnalysisStatusSummary } from "../analysisStatus";
import type { CostOfCapitalResult } from "../costOfCapital";
import type { buildBusinessModelProfile } from "../forecastingEngine";
import type { buildEarningsQualityCard } from "../earningsQuality";
import type { computeIndiaQualitySignals } from "../indiaQualitySignals";
import type { LiveMarketDataSnapshot, summarizeHistoricalPrices } from "../marketData";
import type { ResolvedShareBasis } from "../shareCountTools";
import type { RecastPeriod } from "../types";
import type { ValuationReadiness } from "../valuationPolicy";
import type { resolveValuationSectorTemplate } from "../valuationSectorTemplates";
import type { CoreBuildContext } from "./core";
import {
  appendCrossCheckWarning,
  buildChecklist,
  clamp,
  opportunityMetrics,
  persistenceConvictionCap,
  primaryValueRange,
  scenarioOrderingPenalty,
  scoreFromRange,
  sotpEquityPerShare,
  sotpValueRange,
  summaryWithCrossCheckWarning,
  type computeCashFlowDiagnostics,
  type normalizeHistoricalSeries,
} from "./helpers";
import type { ValuationModelsOutput } from "./models";
import type { ValuationSynthesisOutput } from "./synthesis";
import type {
  ValuationCommandCenterOutput,
  ValuationMarketContext,
  ValuationOpportunityAssessment,
  ValuationSignalState,
} from "./types";

/** What `buildCoreCommandCenter` resolves before the stages run, and the read model reads. */
export interface ValuationReadModelBasis {
  readonly shareBasis: ResolvedShareBasis;
  readonly valuationReadiness: ValuationReadiness;
  readonly weakShareBasis: boolean;
  readonly data: RecastPeriod[];
  readonly latest: RecastPeriod;
  readonly latestReported: RecastPeriod;
  readonly shares: number | null;
  readonly marketCapShares: number | null;
  readonly marketPrice: number | null;
  readonly carvedStake: number;
  readonly quotedSharesCr: number | null;
  readonly shareCountChange: number | null;
  readonly marketFreshness: NonNullable<LiveMarketDataSnapshot["freshness"]> | "fallback" | "missing";
  readonly freshnessScore: number;
  readonly marketWarnings: readonly string[];
  readonly orderedHistory: ReturnType<typeof normalizeHistoricalSeries>;
  readonly historySummary: ReturnType<typeof summarizeHistoricalPrices> | LiveMarketDataSnapshot["history"] | null;
  readonly sectorTemplate: ReturnType<typeof resolveValuationSectorTemplate>["template"];
  readonly sectorTemplateSource: ReturnType<typeof resolveValuationSectorTemplate>["source"];
  readonly diagnostics: ReturnType<typeof computeCashFlowDiagnostics>;
  readonly businessModel: ReturnType<typeof buildBusinessModelProfile>;
  readonly qualityScore: number;
  readonly confidenceState: AnalysisStatusSummary["status"] | "unknown";
  readonly requiredMarginOfSafetyPct: number;
  readonly costOfCapital: CostOfCapitalResult;
  readonly riskFreeRate: number;
  readonly priceDate: string | null;
  readonly yearsToPriceDate: number;
}

export function buildValuationReadModel(args: {
  readonly context: CoreBuildContext;
  readonly basis: ValuationReadModelBasis;
  readonly models: ValuationModelsOutput;
  readonly synthesis: ValuationSynthesisOutput;
  readonly quality: {
    readonly indiaQuality: ReturnType<typeof computeIndiaQualitySignals>;
    readonly earningsQuality: ReturnType<typeof buildEarningsQualityCard>;
  };
}): Omit<ValuationCommandCenterOutput, "backtest"> {
  const { context, models, synthesis } = args;
  const { marketData, analysisStatus } = context;
  const {
    shareBasis, valuationReadiness, weakShareBasis, data, latest, latestReported, shares, marketCapShares,
    marketPrice, carvedStake, quotedSharesCr, shareCountChange, marketFreshness, freshnessScore, marketWarnings,
    orderedHistory, historySummary, sectorTemplate, sectorTemplateSource, diagnostics, businessModel,
    qualityScore, confidenceState, requiredMarginOfSafetyPct, costOfCapital, riskFreeRate, priceDate,
    yearsToPriceDate,
  } = args.basis;
  const { scenarios, reverseDcf, sotpResult, conglomerateAssessment, cashFlowDcf, epv } = models;
  const evEbitdaWithMarket = models.evEbitda;
  const { valuationTriangulation, evidenceLedger, forecastHoldout, marketImpliedExpectations, evidenceWeightedSynthesis } = synthesis;
  const { indiaQuality, earningsQuality } = args.quality;

  const stressCard = scenarios.find((card) => card.key === "stress") ?? null;
  const baseCard = scenarios.find((card) => card.key === "base") ?? null;
  const panicCard = scenarios.find((card) => card.key === "historical-panic") ?? null;
  const scenarioPenalty = scenarioOrderingPenalty({ stress: stressCard, base: baseCard, panic: panicCard, marketPrice });
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
    // Today's price on today's count, where the quote reports it.
    marketCapFromPrice: marketPrice != null && (quotedSharesCr ?? marketCapShares) != null ? marketPrice * (shareCountChange != null ? quotedSharesCr! : marketCapShares!) : null,
    enterpriseValueFromPrice: marketPrice != null && (quotedSharesCr ?? marketCapShares) != null ? marketPrice * (shareCountChange != null ? quotedSharesCr! : marketCapShares!) + latest.bs.NFO - carvedStake : null,
    priceToStressValueRatio: marketPrice != null && (stressCard?.valueAtPriceDate ?? null) != null && (stressCard?.valueAtPriceDate ?? 0) > 0
      ? marketPrice / (stressCard?.valueAtPriceDate ?? 1)
      : null,
    freshness: marketFreshness,
    sourceSummary: marketData?.sourceSummary ?? "Using manual/config market inputs.",
    livePriceAsOf: marketData?.priceAsOf ?? null,
    liveRateAsOf: marketData?.rateAsOf ?? null,
    warningCount: marketWarnings.length,
    valuationAnchorPeriod: valuationReadiness.anchorPeriod,
    latestReportedPeriod: latestReported.period_end,
    priceDate,
    yearsToPriceDate,
    sharesAtValuationDate: shares,
    sharesAtPriceDate: shareCountChange != null ? quotedSharesCr : null,
    sharesAtPriceDateSource: shareCountChange != null ? marketData?.sharesOutstandingSource ?? "the price's quote" : null,
    shareCountChange,
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
    baseReratingCagr: opportunityMetrics(baseCard, marketPrice).reratingCagr,
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
    ...((opportunityMetrics(baseCard, marketPrice).reratingCagr ?? 0) > 0.18
      ? ["Base-case rerating alone implies more than 18% a year over three years."]
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
    summary = killSwitches[0]!;
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
    // The period every figure below was built from (:107) — the anchor, which is
    // not the newest reported period when that one is contaminated. Reported so
    // surfaces read it instead of re-deriving `data[data.length - 1]`.
    anchorPeriod: latest,
    basisPeriods: data,
    marketPrice,
    riskFreeRate,
    costOfCapital,
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
    lendingArm: context.lendingArm ?? null,
    annualizedPeriods: context.annualizedPeriods ?? [],
    // `latest` is the anchor period (:107), which is the period sotpResult was
    // built from — so these are the NFO and MI that sum is allowed to be
    // bridged with. Both come from one period, or the bridge mixes vintages.
    // A carved stake bridges as a financial asset at value: NFO less the stake.
    sotpPerShare: sotpResult ? sotpEquityPerShare(sotpResult, shareBasis, latest.bs.NFO - carvedStake, latest.bs.MI) : null,
    conglomerate: conglomerateAssessment,
    evEbitda: evEbitdaWithMarket,
    indiaQuality,
    earningsQuality,
    // Packs handed down, not re-derived: EPV is the no-growth floor for the
    // same issuer this build is valuing, so it has to discount at the rate the
    // rest of this object was built with.
    epv,
    workingCapitalGate: models.workingCapitalGate,
    cleanSurplus: models.cleanSurplus,
    damodaranCapm: models.damodaranCapm,
    reverseDcfMonteCarlo: models.reverseDcfMonteCarlo,
    cashFlowDcf,
    evidenceLedger,
    forecastHoldout,
    marketImpliedExpectations,
    evidenceWeightedSynthesis,
    valuationTriangulation,
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
    range: conglomerateAssessment?.sotpPreferred && sotpResult
      ? sotpValueRange(sotpResult, shareBasis, latest.bs.NFO - carvedStake, latest.bs.MI)
      : primaryValueRange(scenarios),
  };
}
