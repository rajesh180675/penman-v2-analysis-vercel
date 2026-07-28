/**
 * Pack freshness — does a pinned pack still say what it claims to say?
 *
 * Every pinned observation carries a staleness window, and the resolver honours
 * it: past the limit, `resolveMacroObservation` and `resolveEquityBeta` return
 * `unusable` and the assumption falls back to an engine constant tiered `prior`.
 * That fallback is correct behaviour — it is the honest answer once an
 * observation is too old to defend.
 *
 * What it is not is *visible*. Nothing in the codebase changes when a window
 * lapses, so a run silently stops being sourced: `ke` moves, the provenance
 * tiers drop to `prior`, and the ke-provenance gate starts blocking
 * production-ready on inputs that were fine the day before. No commit caused
 * it and no test failed. This module is what makes that arrival loud, early
 * enough to refresh the pack instead of discovering it from a moved valuation.
 *
 * Checked against the same constants the resolver reads (`MACRO_STALENESS_DAYS`,
 * `BETA_STALENESS_DAYS`) rather than a second copy of the limits, so the guard
 * cannot drift from the behaviour it is guarding.
 *
 * Note which dates are checked: the per-observation `asOf` and the
 * per-constituent `windowEnd`, because those are what the resolver measures.
 * The pack-level `asOf` — the assembly date — is deliberately NOT checked. It
 * would look like the right field and guard nothing, since no staleness
 * decision anywhere reads it.
 */

import { BETA_STALENESS_DAYS, type EquityBetaPack } from "./equityBetaPack";
import { MACRO_STALENESS_DAYS, type MacroObservationKey, type MacroPack } from "./macroPack";

/**
 * How much warning to give before a window lapses.
 *
 * This makes the check fail while the pack is still *valid*, which is
 * deliberate: a guard that fires the day an observation expires has already
 * shipped one run's worth of silently-unsourced valuations. Seven days is
 * enough lead time to re-fetch and land a refresh PR without being so wide
 * that a short-window observation (the 30-day risk-free rate) spends most of
 * its life red.
 *
 * The consequence, stated plainly: this check can turn CI red on a date rather
 * than on a change, and the PR that discovers it will be unrelated to the pack.
 * That is the accepted cost. The alternative is a check that only fires after
 * the discount rate has already moved.
 */
export const PACK_FRESHNESS_LEAD_DAYS = 7;

export type PackFreshnessSeverity =
  /** Past its window. The resolver is already falling back to a prior. */
  | "expired"
  /** Still usable, but lapses within the lead time. Refresh now. */
  | "expiring"
  /** Dated after the analysis date, which the resolver rejects as look-ahead. */
  | "look-ahead";

export interface PackFreshnessFinding {
  readonly severity: PackFreshnessSeverity;
  /** Human-readable subject, e.g. `macro riskFreeRate` or `beta window`. */
  readonly label: string;
  /** The date actually measured — an observation `asOf` or a `windowEnd`. */
  readonly asOf: string;
  /** Age in days at the analysis date. Negative means look-ahead. */
  readonly ageDays: number;
  readonly limitDays: number;
  readonly detail: string;
}

function daysBetween(fromIsoDate: string, toIsoDate: string): number | null {
  const from = Date.parse(fromIsoDate);
  const to = Date.parse(toIsoDate);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

function assess(
  label: string,
  asOf: string,
  limitDays: number,
  analysisAsOf: string,
  leadDays: number,
  extra: string,
): PackFreshnessFinding | null {
  const ageDays = daysBetween(asOf, analysisAsOf);
  if (ageDays == null) {
    return {
      severity: "expired",
      label,
      asOf,
      ageDays: Number.NaN,
      limitDays,
      detail: `${label} carries an unparseable date "${asOf}"${extra}.`,
    };
  }
  if (ageDays < 0) {
    return {
      severity: "look-ahead",
      label,
      asOf,
      ageDays,
      limitDays,
      detail: `${label} is dated ${asOf}, after the analysis date ${analysisAsOf}; the resolver rejects that as look-ahead${extra}.`,
    };
  }
  const headroom = limitDays - ageDays;
  if (headroom < 0) {
    return {
      severity: "expired",
      label,
      asOf,
      ageDays,
      limitDays,
      detail: `${label} is ${ageDays} days old (dated ${asOf}); the limit is ${limitDays}. It already resolves as a prior${extra}.`,
    };
  }
  if (headroom <= leadDays) {
    return {
      severity: "expiring",
      label,
      asOf,
      ageDays,
      limitDays,
      detail: `${label} lapses in ${headroom} day${headroom === 1 ? "" : "s"} (dated ${asOf}, limit ${limitDays})${extra}.`,
    };
  }
  return null;
}

/**
 * Findings for both pinned packs, worst first. Empty means both are good for at
 * least `leadDays` more days.
 *
 * A `null` observation produces no finding. `INDIA_MACRO_PACK.longRunNominalGrowth`
 * is null on purpose — a perpetual growth ceiling is a structural judgment
 * nobody publishes as an observation — so it resolves as a stated prior by
 * design, and reporting it here would be a permanent unfixable failure.
 */
export function checkPackFreshness(input: {
  readonly macroPack?: MacroPack | null | undefined;
  readonly betaPack?: EquityBetaPack | null | undefined;
  /** Analysis date to measure against, `YYYY-MM-DD`. */
  readonly analysisAsOf: string;
  readonly leadDays?: number | undefined;
}): readonly PackFreshnessFinding[] {
  const leadDays = input.leadDays ?? PACK_FRESHNESS_LEAD_DAYS;
  const findings: PackFreshnessFinding[] = [];

  const macro = input.macroPack;
  if (macro) {
    const keys: readonly MacroObservationKey[] = ["riskFreeRate", "equityRiskPremium", "longRunNominalGrowth"];
    for (const key of keys) {
      const observation = macro[key];
      if (!observation) continue;
      const finding = assess(`macro ${key}`, observation.asOf, MACRO_STALENESS_DAYS[key], input.analysisAsOf, leadDays, "");
      if (finding) findings.push(finding);
    }
  }

  const beta = input.betaPack;
  if (beta) {
    // Grouped by window end rather than reported per ticker. The generator
    // stamps one window across every constituent, so per-ticker findings would
    // print the same date 33 times and bury anything else in the output.
    const byWindowEnd = new Map<string, string[]>();
    for (const constituent of beta.constituents) {
      const tickers = byWindowEnd.get(constituent.windowEnd) ?? [];
      tickers.push(constituent.ticker);
      byWindowEnd.set(constituent.windowEnd, tickers);
    }
    for (const [windowEnd, tickers] of byWindowEnd) {
      const extra = ` — ${tickers.length} constituent${tickers.length === 1 ? "" : "s"}`;
      const finding = assess("beta window", windowEnd, BETA_STALENESS_DAYS, input.analysisAsOf, leadDays, extra);
      if (finding) findings.push(finding);
    }
  }

  const rank: Record<PackFreshnessSeverity, number> = { "look-ahead": 0, expired: 1, expiring: 2 };
  return [...findings].sort((a, b) => rank[a.severity] - rank[b.severity] || a.asOf.localeCompare(b.asOf));
}
