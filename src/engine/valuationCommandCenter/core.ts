import { LiveMarketDataSnapshot, summarizeHistoricalPrices } from "../marketData";
import { buildBusinessModelProfile } from "../forecastingEngine";
import { AnalysisStatusSummary } from "../analysisStatus";
import { RecastPeriod, EngineConfig } from "../types";
import { resolveCostOfCapitalFromConfig } from "../costOfCapital";
import { resolveShareBasis } from "../shareCountTools";
import { resolveValuationReadiness } from "../valuationPolicy";
import { resolveValuationSectorTemplate } from "../valuationSectorTemplates";
import type { SegmentData } from "../segmentParser";
import type { EquityBetaPack, MacroPack } from "../marketPacks";
import { computeEvEbitdaCrossCheck, updateEvEbitdaWithMarketPrice } from "../evEbitdaCrossCheck";
import { computeIndiaQualitySignals } from "../indiaQualitySignals";
import { buildEarningsQualityCard, buildDechowDichevAndRem } from "../earningsQuality";
import { computeEPV } from "../grahamDoddEPV";
import { computeCashFlowDcf } from "../cashFlowDcf";
import { buildValuationTriangulationEvidence } from "../valuationTriangulation";
import {
  buildAssumptionEvidenceLedger,
  buildEvidenceWeightedSynthesis,
  buildMarketImpliedExpectationLedger,
  evaluateForecastHoldout,
  type HoldoutVintageIndex,
} from "../valuationEvidence";
import { buildBacktest } from "./backtest";
import {
  ValuationSignalState,
  ValuationOpportunityAssessment,
  ValuationMarketContext,
  ValuationCommandCenterOutput,
} from "./types";
import {
  clamp,
  scoreFromRange,
  buildReverseDcfExpectation,
  primaryValueRange,
  sotpValueRange,
  appendCrossCheckWarning,
  summaryWithCrossCheckWarning,
  opportunityMetrics,
  computeCashFlowDiagnostics,
  computeQualityScore,
  persistencePenalty,
  persistenceConvictionCap,
  normalizeHistoricalSeries,
  scoreFreshness,
  scenarioOrderingPenalty,
  buildChecklist,
} from "./helpers";
import {
  buildSotpAssessment,
  buildClassAModels,
  buildScenarioCards,
} from "./builders";

export type CoreBuildContext = {
  data: RecastPeriod[];
  config: EngineConfig;
  marketData?: LiveMarketDataSnapshot | null | undefined;
  analysisStatus?: AnalysisStatusSummary | null | undefined;
  /** Phase C5 — parsed segment data for SOTP valuation (business segments). */
  segmentData?: SegmentData | null | undefined;
  /**
   * Per-period publication vintage, derived from ingestion provenance. Absent
   * when the caller has no fact-level provenance, in which case the holdout
   * reports its no-look-ahead claim as unverified rather than assuming it.
   */
  holdoutVintage?: HoldoutVintageIndex | null | undefined;
  /**
   * Pinned macro pack supplying a dated risk-free rate and ERP.
   *
   * Absent by default, and deliberately so: with no pack the capital-cost
   * assumptions resolve to engine constants tiered `prior`, which is what every
   * existing caller already got. A caller that wants sourced inputs has to say
   * so, and has to say as of when.
   */
  macroPack?: MacroPack | null | undefined;
  /**
   * Pinned regressed betas, looked up by `config.ticker`.
   *
   * Absent by default for the same reason `macroPack` is. Note the two are
   * independent inputs but not independent decisions: supplying one without the
   * other leaves ke part-sourced and part-guessed, and the provenance gate
   * demotes the run either way, so callers should pass both or neither.
   */
  betaPack?: EquityBetaPack | null | undefined;
  /**
   * The run's as-of date, for the pack's staleness and look-ahead checks.
   *
   * Supplied by the caller rather than read off the clock in here. A pack
   * observation whose tier depended on `new Date()` would silently demote from
   * `sourced` to `prior` once it crossed its staleness window, so the same
   * inputs would produce a different provenance claim depending on when you ran
   * them — which is the property the pack exists to provide.
   */
  analysisAsOf?: string | null | undefined;
};

type CoreBuildResult = Omit<ValuationCommandCenterOutput, "backtest">;

export function buildCoreCommandCenter(context: CoreBuildContext): CoreBuildResult {
  const { data, config, marketData, analysisStatus, macroPack, betaPack, analysisAsOf } = context;
  const shareBasis = resolveShareBasis(data, config);
  const valuationReadiness = resolveValuationReadiness(data);
  const weakShareBasis = shareBasis.confidence === "LOW" || shareBasis.confidence === "FAILED";
  const valuationData = data.slice(0, Math.max(2, valuationReadiness.anchorIndex + 1));
  const latest = valuationData[valuationData.length - 1]!;
  const prev = valuationData.length >= 2 ? valuationData[valuationData.length - 2]! : null;
  const latestReported = data[data.length - 1]!;
  // Two distinct share bases:
  //   - `shares` (per-share): the diluted weighted-average count used to convert
  //     rupee aggregates into per-share metrics (P/E, intrinsic per share, etc.).
  //   - `marketCapShares` (market cap): the period-end paid-up count used to
  //     convert spot price into market cap and EV — i.e. the equity outstanding
  //     *today*, not the average over the year. See `shareCountTools.ts` for
  //     the resolver and `docs/reinvestment-runway-and-share-basis-plan.md`.
  const shares = shareBasis.sharesForPerShare ?? shareBasis.shares ?? null;
  const marketCapShares = shareBasis.sharesForMarketCap ?? shareBasis.shares ?? null;
  const marketPrice = marketData?.price ?? config.market_price ?? null;
  // Only a rate that genuinely came from the market snapshot. This used to read
  // `marketData?.riskFreeRate ?? config.risk_free_rate` and hand the result to
  // the resolver, which labelled it "Pinned market snapshot" — so on the primary
  // app path, which passes no market data at all, an engine constant was
  // attributed to a market feed it never touched. The constant is still the
  // eventual fallback; it now arrives through the config branch that says so.
  const liveRiskFreeRate = marketData?.riskFreeRate ?? undefined;
  const marketFreshness = marketData?.freshness ?? (marketPrice != null || marketData?.riskFreeRate != null ? "fallback" : "missing");
  const freshnessScore = scoreFreshness(marketFreshness);
  const marketWarnings = marketData?.warnings ?? [];
  const orderedHistory = normalizeHistoricalSeries(marketData?.history?.points);
  const historySummary = orderedHistory.length ? summarizeHistoricalPrices(orderedHistory, marketPrice) : marketData?.history ?? null;
  const { template: sectorTemplate, source: sectorTemplateSource } = resolveValuationSectorTemplate(valuationData, config.sector_template, config.company_type);
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

  const costOfCapital = resolveCostOfCapitalFromConfig({
    config,
    current: latest,
    previous: prev,
    riskFreeRate: liveRiskFreeRate,
    // `rateAsOf` only. This used to fall back to `fetchedAt`, which dates the
    // HTTP call rather than the rate — and since the resolver tiers a *dated*
    // live rate `sourced`, any snapshot at all was enough to date the rate and
    // outrank a pinned pack observation. The run executor already refuses a rate
    // without `rateAsOf` (MARKET_RATE_DATE_REQUIRED), so the fallback also
    // contradicted the repo's own gate.
    marketAsOf: marketData?.rateAsOf ?? null,
    macroPack,
    betaPack,
    analysisAsOf,
  });
  // The rate the rest of the run must use, so scenarios and the reported
  // risk-free rate cannot drift from the one inside ke and kd. Reads the resolved
  // assumption where there is one; CAPM mode with no pack resolves this to
  // `live ?? config`, which is what this line used to compute directly, and
  // manual-ke mode has no assumption set so it keeps that expression.
  const riskFreeRate = costOfCapital.assumptions?.riskFreeRate.value
    ?? liveRiskFreeRate
    ?? config.risk_free_rate;
  const keBase = costOfCapital.ke;
  const kwBase = costOfCapital.kw;
  const { scenarios, derivedScenarios } = buildScenarioCards({
    config,
    sectorTemplate,
    latest,
    shareBasis,
    diagnostics,
    marketPrice,
    businessModel,
    keBase,
    kwBase,
    riskFreeRate,
    valuationData,
    horizon,
  });

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
  const { sotpResult, conglomerateAssessment } = buildSotpAssessment(segmentData, config, latest, keBase);

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
    marketCapFromPrice: marketPrice != null && marketCapShares != null ? marketPrice * marketCapShares : null,
    enterpriseValueFromPrice: marketPrice != null && marketCapShares != null ? marketPrice * marketCapShares + latest.bs.NFO : null,
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

  // ── Wire Class-A valuation models ──────────────────────────────────
  const { workingCapitalGateResult, cleanSurplusResult, damodaranCapmResult, reverseDcfMonteCarloResult } =
    buildClassAModels(data, config, latest, shares, marketPrice, keBase);

  // ── Poly-paradigm Phase 1.1: independent cash-statement FCFF DCF ────
  const cashFlowDcf = computeCashFlowDcf(valuationData, config, shares, {
    terminalGrowth: baseCard?.assumptions.g ?? sectorTemplate.normalizedGrowth,
    nearTermGrowth: baseCard?.assumptions.salesGrowthYear1 ?? sectorTemplate.normalizedGrowth,
    horizon,
  });
  const valuationTriangulation = buildValuationTriangulationEvidence({
    scenarios,
    cashFlowDcf,
    evEbitda: evEbitdaWithMarket,
    shares,
    periodEnd: latest.period_end,
  });
  const evidenceLedger = buildAssumptionEvidenceLedger({
    scenarios,
    reverseDcf,
    periodEnd: latest.period_end,
    companyId: config.ticker ?? null,
  });
  const forecastHoldout = evaluateForecastHoldout(data, context.holdoutVintage);
  const marketImpliedExpectations = buildMarketImpliedExpectationLedger({
    marketPrice,
    asOf: marketData?.priceAsOf ?? marketData?.fetchedAt ?? null,
    reverseDcf,
  });
  const evEbitdaPerShare = evEbitdaWithMarket.equityFromMedian != null && shares != null && shares > 0
    ? evEbitdaWithMarket.equityFromMedian / shares
    : null;
  const evidenceWeightedSynthesis = buildEvidenceWeightedSynthesis({
    scenarios,
    cashFlowDcf,
    evEbitdaPerShare,
    reverseDcf,
    evidenceLedger,
    forecastHoldout,
    marketPrice,
  });

  return {
    shareBasis,
    valuationReadiness,
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
    conglomerate: conglomerateAssessment,
    evEbitda: evEbitdaWithMarket,
    indiaQuality,
    earningsQuality,
    // Packs handed down, not re-derived: EPV is the no-growth floor for the
    // same issuer this build is valuing, so it has to discount at the rate the
    // rest of this object was built with.
    epv: computeEPV(data, shareBasis.valuationConfig, { macroPack, betaPack, analysisAsOf }),
    workingCapitalGate: workingCapitalGateResult,
    cleanSurplus: cleanSurplusResult,
    damodaranCapm: damodaranCapmResult,
    reverseDcfMonteCarlo: reverseDcfMonteCarloResult,
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
      ? sotpValueRange(sotpResult, shareBasis, latest.bs.NFO)
      : primaryValueRange(scenarios),
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
