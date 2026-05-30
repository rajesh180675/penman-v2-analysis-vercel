/**
 * Economic Moat Scoring — industrial company scorer (RNOA/SPREAD-based).
 */

import { RecastPeriod, EngineConfig, deriveKwFromConfig } from "../types";
import type { ITServicesSignal } from "../itServicesDetector";
import { MoatScoreResult } from "./types";
import { medianOf, estimatePhi, estimateCAP, computeTrend } from "./stats";
import {
  scoreRNOAPersistence,
  scoreSPREADDurability,
  scoreMarginStability,
  scoreReinvestmentQuality,
  scoreATOStability,
  classifyMoatWidth,
} from "./dimensions";

// ─── Main Function ────────────────────────────────────────────────────────────

/**
 * Compute economic moat score for an industrial company.
 *
/**
 * Compute composite moat score from recast periods.
 *
 * @param periods    Sorted recast periods (oldest → newest)
 * @param config     Engine config (provides ke, kw)
 * @param kwOverride Optional structurally-derived kw to use instead of the
 *                   80/20 fallback in `deriveKwFromConfig`. v3Analytics passes
 *                   the same kw it uses for terminal-value math so the moat
 *                   score stays consistent across modules (review C8, S-9.4C).
 */
export function computeMoatScore(
  periods: RecastPeriod[],
  config: EngineConfig,
  kwOverride?: number | null | undefined,
  itServices?: ITServicesSignal | null | undefined,
): MoatScoreResult | null {
  if (!periods || periods.length < 3) return null;

  const notes: string[] = [];
  // S-9.4C: prefer caller override, then the period's structural kw (stamped
  // by the pipeline from deriveKwFromStructure), then the config-derived
  // 80/20 fallback. v3Analytics passes the structural kw via override; the
  // period.kwStructural rung handles independent callers (legacy entry
  // points, scoring tools) that don't.
  const sortedForKw = [...periods].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime()
  );
  const latestForKw = sortedForKw[sortedForKw.length - 1];
  const kw = (kwOverride != null && Number.isFinite(kwOverride) && kwOverride > 0)
    ? kwOverride
    : (latestForKw?.kwStructural != null && Number.isFinite(latestForKw.kwStructural) && latestForKw.kwStructural > 0
      ? latestForKw.kwStructural
      : deriveKwFromConfig(config));

  const sorted = [...periods].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime()
  );

  // Phase E3 — IT-services: RNOA/ATO decomposition is unreliable for
  // human-capital businesses (NOA is structurally tiny → RNOA inflated).
  // Surface the math but flag dataSufficient=false so the UI can warn.
  if (itServices?.isITServices) {
    notes.unshift(
      `IT-services fingerprint detected (${itServices.reason}). ` +
      `RNOA is structurally inflated (tiny NOA denominator) and ATO is not a ` +
      `meaningful efficiency signal. Moat width classification is unreliable — ` +
      `focus on margin durability and revenue growth instead.`
    );
  }

  // ── Compute dimensions ───────────────────────────────────────────────────
  const d1 = scoreRNOAPersistence(sorted, kw);
  const d2 = scoreSPREADDurability(sorted);
  const d3 = scoreMarginStability(sorted);
  const d4 = scoreReinvestmentQuality(sorted, kw);
  const d5 = scoreATOStability(sorted);

  const dimensions = [d1, d2, d3, d4, d5];

  // ── Composite score (weighted average) ──────────────────────────────────
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const compositeScore = Math.round(
    dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight
  );

  // ── SPREAD statistics ────────────────────────────────────────────────────
  const spreadValues = sorted
    .map(p => p.ratios?.SPREAD)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const periodsAboveCostOfCapital = spreadValues.filter(v => v > 0).length;
  const periodsWithStrongSpread   = spreadValues.filter(v => v > 0.05).length;
  const totalPeriods = sorted.length;

  // ── RNOA series for CAP ──────────────────────────────────────────────────
  const rnoaSeries = sorted
    .map(p => p.ratios?.RNOA)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const latestRNOA = rnoaSeries.length > 0 ? rnoaSeries[rnoaSeries.length - 1] : null;
  const phi = estimatePhi(rnoaSeries);

  const cap = latestRNOA != null
    ? estimateCAP(latestRNOA, kw, phi, rnoaSeries)
    : { years: null, phi: null, latestRNOA: null, kw, confidence: "low" as const, method: "insufficient-data" as const };

  // ── Summary stats ────────────────────────────────────────────────────────
  const medianRNOA   = medianOf(rnoaSeries);
  const medianSPREAD = medianOf(spreadValues);
  const pmValues = sorted
    .map(p => p.ratios?.CoreSalesPM)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const medianCorePM = medianOf(pmValues);

  const moatWidth = classifyMoatWidth(
    compositeScore,
    periodsAboveCostOfCapital,
    periodsWithStrongSpread,
    totalPeriods,
  );

  const moatTrend = computeTrend(sorted.map(p => p.ratios?.SPREAD ?? null));

  if (rnoaSeries.length < 5) notes.push("Fewer than 5 periods with RNOA — moat assessment less reliable");
  if (phi != null && phi > 0.95) notes.push("Very high RNOA persistence (phi > 0.95) — may reflect data quality issue");

  // Phase I robustness — count periods with positive RNOA. The moat
  // framework's premise is RNOA durability above cost of capital;
  // for loss-makers (Paytm pre-FY2024) the score is meaningless even
  // though the math doesn't blow up. Surface this explicitly so the UI
  // can render a skip-with-reason instead of a misleading "narrow moat"
  // classification.
  const positiveRNOAPeriods = rnoaSeries.filter((r) => r > 0).length;
  // Phase E3: IT-services companies have structurally inflated RNOA —
  // flag dataSufficient=false so the UI renders a skip-with-reason.
  const itServicesBlocked = Boolean(itServices?.isITServices);
  const dataSufficient = positiveRNOAPeriods >= 3 && !itServicesBlocked;
  const skipReason = itServicesBlocked
    ? `IT-services company — RNOA is structurally inflated (tiny NOA denominator). Moat width classification unreliable. Focus on margin durability and revenue growth.`
    : dataSufficient
      ? null
      : positiveRNOAPeriods === 0
        ? `No periods with positive RNOA — moat framework requires evidence of returns above cost of capital`
        : `Only ${positiveRNOAPeriods} period(s) of ${rnoaSeries.length} with positive RNOA — moat assessment low-confidence (need ≥3)`;

  if (!dataSufficient && skipReason) notes.unshift(skipReason);

  return {
    compositeScore,
    moatWidth,
    dimensions,
    cap,
    periodsAboveCostOfCapital,
    periodsWithStrongSpread,
    totalPeriods,
    medianRNOA,
    medianSPREAD,
    medianCorePM,
    moatTrend,
    notes,
    dataSufficient,
    skipReason,
    positiveRNOAPeriods,
  };
}
