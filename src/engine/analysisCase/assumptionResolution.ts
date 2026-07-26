/* ================================================================
   Stage 9 — assumption resolution (P6, narrowed native extraction)

   `docs/architecture/plans/2026-07-20-legacy-to-native-migration.md` §7.2
   splits the valuation command-center monolith into four native stages
   (9 assumption-resolution → 10 forecast → 11 model-execution → 12 synthesis).
   This module is the Stage 9 cut, and only that.

   Why this is the cheapest honest first cut: the three resolvers Stage 9 needs
   (`resolveCostOfCapitalFromConfig`, `resolveShareBasis`,
   `resolveValuationReadiness`) are already standalone pure functions. What was
   NOT native is who calls them — `buildRunAssumptionCandidates` in
   `analysisRun/legacyExecutor.ts` read `ke`/`kw` back off
   `commandCenter.costOfCapital`, so the run's assumption set could only exist
   after the monolith had already valued the company.

   WHAT THIS STAGE DELIBERATELY DOES NOT DO
   The plan also assigns `g_terminal`, `salesGrowthYear1`, `corePmYear1` and
   `assetTurnoverYear1` to Stage 9. Those are not extractable yet and are not
   faked here: the monolith's base-case terminal growth is
   `clamp(config.g_terminal_override ?? scenario.drivers.g_terminal, floor, cap)`
   where `scenario.drivers` is produced by `buildScenarioCards`, i.e. forecast
   work that belongs to Stage 10. Moving those candidates requires the Stage 10
   extraction, so they stay forecast-derived and the caller merges them in.
   Claiming them here would mean re-deriving growth by a second, unvalidated
   route and calling the result the same assumption.

   PARITY CONTRACT
   Every value below is computed by the same expression, in the same order,
   from the same inputs as `valuationCommandCenter/core.ts` lines 71-131. That
   is what makes it a strangler step rather than a second opinion:
   `assumptionResolution.spec.ts` asserts the native output equals the
   monolith's `costOfCapital`, `shareBasis`, `valuationReadiness`,
   `riskFreeRate` and `marketPrice` on the golden fixtures.
================================================================ */

import type { ContentRef } from "../analysisRun";
import { resolveCostOfCapitalFromConfig, type CostOfCapitalResult } from "../costOfCapital";
import type { LiveMarketDataSnapshot } from "../marketData";
import { resolveShareBasis, type ResolvedShareBasis } from "../shareCountTools";
import type { EngineConfig, RecastPeriod } from "../types";
import { resolveValuationReadiness, type ValuationReadiness } from "../valuationPolicy";
import type { MacroPack } from "../marketPacks";
import type { AssumptionCandidate } from "./assumptions";
import type { UnifiedAnalysisWindow } from "./window";

export const ASSUMPTION_RESOLUTION_STAGE_VERSION = "2026-07-assumption-resolution-v1" as const;

/**
 * Fitness of the share basis for per-share output. Mirrors the monolith's
 * `weakShareBasis` / `perShareBlocked` / `perShareGuarded` triple
 * (core.ts:75, 167-168) rather than a new policy, so a caller can adopt the
 * stage without changing what gets blocked.
 */
export type PerShareBasisStatus = "confirmed" | "guarded" | "blocked";

export interface AssumptionResolutionInput {
  /**
   * The recast periods the run selected. Pass exactly what the command center
   * receives — the anchor slice below is taken from this array, so a different
   * period set silently produces a different cost of capital.
   */
  readonly periods: readonly RecastPeriod[];
  readonly window: UnifiedAnalysisWindow;
  readonly config: EngineConfig;
  readonly marketSnapshot?: LiveMarketDataSnapshot | null | undefined;
  /**
   * Pinned macro pack, forwarded to the capital-cost resolver. Absent by
   * default, matching `CoreBuildContext` — the parity spec compares this stage
   * against the monolith, so the two must default the same way or they diverge
   * on every fixture.
   */
  readonly macroPack?: MacroPack | null | undefined;
  /** Run as-of date for the pack's staleness and look-ahead checks. */
  readonly analysisAsOf?: string | null | undefined;
  readonly factRef: ContentRef<"fact-set">;
  readonly policyRef: ContentRef<"policy-bundle">;
  readonly marketRef?: ContentRef<"market-snapshot"> | null | undefined;
}

export interface AssumptionResolutionOutput {
  readonly stageVersion: typeof ASSUMPTION_RESOLUTION_STAGE_VERSION;
  readonly costOfCapital: CostOfCapitalResult;
  readonly shareBasis: ResolvedShareBasis;
  readonly valuationReadiness: ValuationReadiness;
  /**
   * The anchor-truncated periods the capital cost was measured on. The monolith
   * does not value off the latest reported period when that period is
   * contaminated; it values off the readiness anchor, so the beta relever and
   * the capital weights must see the same truncated history.
   */
  readonly anchorPeriods: readonly RecastPeriod[];
  readonly riskFreeRate: number;
  readonly marketPrice: number | null;
  readonly marketAsOf: string | null;
  readonly perShareStatus: PerShareBasisStatus;
  readonly status: "confirmed" | "guarded" | "blocked";
  readonly blockers: readonly string[];
  /**
   * Capital-cost candidates (`ke`, `kw`). Growth candidates are still
   * forecast-derived — see the header note.
   */
  readonly capitalCandidates: readonly AssumptionCandidate<unknown>[];
  /**
   * The market-price observation, when the run has a content-addressed market
   * snapshot to cite. Kept separate from `capitalCandidates` so a caller
   * splicing in forecast-derived growth candidates can reproduce the exact
   * legacy ordering: an assumption set's element order feeds `assumptionSetId`
   * and therefore each run's `reproducibilityHash`, so reordering would make
   * previously stored runs stop matching a re-run of identical data.
   */
  readonly marketCandidates: readonly AssumptionCandidate<unknown>[];
}

function pointDistribution(value: number) {
  return { family: "point" as const, parameters: { value } };
}

/**
 * Blocked on LOW as well as FAILED. The plan names only `FAILED`, but the
 * shipped monolith already treats LOW as per-share-blocking
 * (`weakShareBasis`, core.ts:75); relaxing that here would make the native
 * stage the more permissive of the two, which is the wrong direction for a
 * fail-closed ladder.
 */
function perShareStatusFor(
  shareBasis: ResolvedShareBasis,
  periodCount: number,
): PerShareBasisStatus {
  const weak = shareBasis.confidence === "LOW" || shareBasis.confidence === "FAILED";
  if (weak || periodCount < 2) return "blocked";
  if (shareBasis.confidence === "MEDIUM" || periodCount < 4) return "guarded";
  return "confirmed";
}

export function resolveAnalysisAssumptions(
  input: AssumptionResolutionInput,
): AssumptionResolutionOutput {
  // resolveShareBasis / resolveValuationReadiness predate the readonly
  // boundary and still take mutable arrays; copy rather than widen their
  // signatures, which would let a future caller mutate a run's periods.
  const periods = [...input.periods];
  const shareBasis = resolveShareBasis(periods, input.config);
  const valuationReadiness = resolveValuationReadiness(periods);

  // Same anchor truncation as core.ts:76 — at least two periods, otherwise up
  // to and including the readiness anchor.
  const anchorPeriods = periods.slice(0, Math.max(2, valuationReadiness.anchorIndex + 1));
  const latest = anchorPeriods[anchorPeriods.length - 1] ?? null;
  const previous = anchorPeriods.length >= 2 ? anchorPeriods[anchorPeriods.length - 2]! : null;

  const marketSnapshot = input.marketSnapshot ?? null;
  // Only a rate that actually came from the snapshot, mirroring core.ts. Passing
  // `?? config.risk_free_rate` here made the resolver label an engine constant
  // "Pinned market snapshot", which is a market attribution for a number no
  // market produced.
  const liveRiskFreeRate = marketSnapshot?.riskFreeRate ?? undefined;
  const marketPrice = marketSnapshot?.price ?? input.config.market_price ?? null;
  // `rateAsOf` only — `fetchedAt` dates the request, not the rate. See core.ts.
  const marketAsOf = marketSnapshot?.rateAsOf ?? null;

  const costOfCapital = resolveCostOfCapitalFromConfig({
    config: input.config,
    current: latest,
    previous,
    riskFreeRate: liveRiskFreeRate,
    marketAsOf,
    macroPack: input.macroPack,
    analysisAsOf: input.analysisAsOf,
  });
  // The rate the run reports, taken from the resolved assumption so it cannot
  // disagree with the one inside ke. Falls back for manual-ke mode, which
  // reports no assumption set.
  const riskFreeRate = costOfCapital.assumptions?.riskFreeRate.value
    ?? liveRiskFreeRate
    ?? input.config.risk_free_rate;

  const included = input.window.includedPeriods;
  const periodWindow = included.length
    ? { from: included[0]!, to: included[included.length - 1]!, observations: included.length }
    : null;
  const confidence = costOfCapital.status === "confirmed"
    ? "high" as const
    : costOfCapital.status === "guarded"
      ? "medium" as const
      : "unavailable" as const;

  const capitalCandidates: AssumptionCandidate<unknown>[] = [
    {
      assumptionId: "cost-of-equity",
      key: "ke",
      value: costOfCapital.ke,
      unit: "FRACTION",
      mode: "derived",
      evidenceRefs: [input.factRef, input.policyRef],
      periodWindow,
      range: null,
      distribution: pointDistribution(costOfCapital.ke),
      confidence,
      reviewerState: "system",
      required: true,
    },
    {
      assumptionId: "operating-capital-cost",
      key: "kw",
      value: costOfCapital.kw,
      unit: "FRACTION",
      mode: "derived",
      evidenceRefs: [input.factRef, input.policyRef],
      periodWindow,
      range: null,
      distribution: pointDistribution(costOfCapital.kw),
      confidence,
      reviewerState: "system",
      required: true,
    },
  ];

  // No market ref means the run has no content-addressed market snapshot to
  // cite, so the price is not admissible as evidence even when a config
  // fallback produced a number.
  const marketCandidates: AssumptionCandidate<unknown>[] = [];
  if (input.marketRef && marketPrice != null) {
    marketCandidates.push({
      assumptionId: "market-price-observation",
      key: "market_price",
      value: marketPrice,
      unit: "INR_PER_SHARE",
      mode: "market-implied",
      evidenceRefs: [input.marketRef],
      periodWindow: null,
      range: null,
      distribution: pointDistribution(marketPrice),
      confidence: "high",
      reviewerState: "system",
      required: false,
    });
  }

  const perShareStatus = perShareStatusFor(shareBasis, periods.length);
  const blockers: string[] = [];
  if (perShareStatus === "blocked") {
    blockers.push(
      `Share basis is ${shareBasis.confidence.toLowerCase()} on ${periods.length} recast period(s), so per-share assumptions cannot be resolved.`,
    );
  }
  if (costOfCapital.status === "blocked") {
    blockers.push("Cost of capital is blocked, so no discount-rate assumption can be resolved.");
  }
  const status: AssumptionResolutionOutput["status"] = blockers.length > 0
    ? "blocked"
    : perShareStatus === "guarded" || costOfCapital.status === "guarded"
      ? "guarded"
      : "confirmed";

  return {
    stageVersion: ASSUMPTION_RESOLUTION_STAGE_VERSION,
    costOfCapital,
    shareBasis,
    valuationReadiness,
    anchorPeriods,
    riskFreeRate,
    marketPrice,
    marketAsOf,
    perShareStatus,
    status,
    blockers,
    capitalCandidates,
    marketCandidates,
  };
}
