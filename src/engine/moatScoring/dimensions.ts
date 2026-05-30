/**
 * Economic Moat Scoring — per-dimension scorers and moat-width classification.
 */

import { RecastPeriod } from "../types";
import { MoatDimension, MoatWidth } from "./types";
import { medianOf, stdDev, clamp } from "./stats";

// ─── Dimension Scorers ────────────────────────────────────────────────────────

/**
 * Dimension 1: RNOA Persistence
 * Score based on: median RNOA vs kw, % of periods above kw, consistency
 */
export function scoreRNOAPersistence(
  periods: RecastPeriod[],
  kw: number,
): MoatDimension {
  const rawValues: MoatDimension["rawValues"] = [];
  const rnoaValues: number[] = [];

  for (const p of periods) {
    const rnoa = p.ratios?.RNOA ?? null;
    rawValues.push({ period: p.period_end, value: rnoa });
    if (rnoa != null && Number.isFinite(rnoa)) rnoaValues.push(rnoa);
  }

  const evidence: string[] = [];
  if (!rnoaValues.length) {
    return { name: "RNOA Persistence", score: 0, weight: 0.30, evidence: ["No RNOA data"], rawValues };
  }

  const medRNOA = medianOf(rnoaValues)!;
  const pctAbove = rnoaValues.filter(v => v > kw).length / rnoaValues.length;
  const sd = stdDev(rnoaValues) ?? 0;

  // Score components:
  // 1. Median RNOA vs kw: 0–50 pts
  const spreadScore = clamp((medRNOA - kw) / 0.15 * 50, 0, 50);
  // 2. % periods above kw: 0–30 pts
  const consistencyScore = pctAbove * 30;
  // 3. Low volatility bonus: 0–20 pts (lower std dev = more stable)
  const volatilityScore = clamp((1 - sd / 0.10) * 20, 0, 20);

  const score = Math.round(spreadScore + consistencyScore + volatilityScore);

  evidence.push(`Median RNOA: ${(medRNOA * 100).toFixed(1)}% vs kw: ${(kw * 100).toFixed(1)}%`);
  evidence.push(`${Math.round(pctAbove * 100)}% of periods above cost of capital`);
  evidence.push(`RNOA std dev: ${(sd * 100).toFixed(1)}%`);

  return { name: "RNOA Persistence", score: clamp(score, 0, 100), weight: 0.30, evidence, rawValues };
}

/**
 * Dimension 2: SPREAD Durability
 * Score based on: median SPREAD, % of periods with positive SPREAD, SPREAD trend
 */
export function scoreSPREADDurability(
  periods: RecastPeriod[],
): MoatDimension {
  const rawValues: MoatDimension["rawValues"] = [];
  const spreadValues: number[] = [];

  for (const p of periods) {
    const spread = p.ratios?.SPREAD ?? null;
    rawValues.push({ period: p.period_end, value: spread });
    if (spread != null && Number.isFinite(spread)) spreadValues.push(spread);
  }

  const evidence: string[] = [];
  if (!spreadValues.length) {
    return { name: "SPREAD Durability", score: 0, weight: 0.25, evidence: ["No SPREAD data"], rawValues };
  }

  const medSpread = medianOf(spreadValues)!;
  const pctPositive = spreadValues.filter(v => v > 0).length / spreadValues.length;
  const pctStrong   = spreadValues.filter(v => v > 0.05).length / spreadValues.length;

  // Score: median SPREAD (0–40), % positive (0–35), % strong (0–25)
  const medScore    = clamp(medSpread / 0.10 * 40, 0, 40);
  const posScore    = pctPositive * 35;
  const strongScore = pctStrong * 25;

  const score = Math.round(medScore + posScore + strongScore);

  evidence.push(`Median SPREAD: ${(medSpread * 100).toFixed(1)}%`);
  evidence.push(`${Math.round(pctPositive * 100)}% of periods with positive SPREAD`);
  evidence.push(`${Math.round(pctStrong * 100)}% of periods with SPREAD > 5%`);

  return { name: "SPREAD Durability", score: clamp(score, 0, 100), weight: 0.25, evidence, rawValues };
}

/**
 * Dimension 3: Margin Stability
 * Score based on: median CoreSalesPM, coefficient of variation (lower = better)
 */
export function scoreMarginStability(periods: RecastPeriod[]): MoatDimension {
  const rawValues: MoatDimension["rawValues"] = [];
  const pmValues: number[] = [];

  for (const p of periods) {
    const pm = p.ratios?.CoreSalesPM ?? null;
    rawValues.push({ period: p.period_end, value: pm });
    if (pm != null && Number.isFinite(pm)) pmValues.push(pm);
  }

  const evidence: string[] = [];
  if (!pmValues.length) {
    return { name: "Margin Stability", score: 0, weight: 0.20, evidence: ["No CoreSalesPM data"], rawValues };
  }

  const medPM = medianOf(pmValues)!;
  const sd    = stdDev(pmValues) ?? 0;
  const cv    = Math.abs(medPM) > 0.001 ? sd / Math.abs(medPM) : 1;

  // Score: median PM level (0–50), stability (0–50)
  const levelScore    = clamp(medPM / 0.20 * 50, 0, 50);
  const stabilityScore = clamp((1 - cv) * 50, 0, 50);

  const score = Math.round(levelScore + stabilityScore);

  evidence.push(`Median CoreSalesPM: ${(medPM * 100).toFixed(1)}%`);
  evidence.push(`Coefficient of variation: ${(cv * 100).toFixed(0)}% (lower = more stable)`);
  if (medPM > 0.15) evidence.push("High-margin business — pricing power signal");
  if (cv < 0.15)    evidence.push("Very stable margins — durable competitive position");

  return { name: "Margin Stability", score: clamp(score, 0, 100), weight: 0.20, evidence, rawValues };
}

/**
 * Dimension 4: Reinvestment Quality
 * Score based on: incremental RNOA (ΔNOA → ΔCOREOI), ROIC on new investment
 * Incremental RNOA = ΔCoreOI / ΔNOA (year-over-year)
 *
 * Calibration (review W7): aligned with capitalAllocationScoring.ts:scoreReinvestmentROIC.
 *   score = clamp(med / (2*kw) * 100, 0, 100)
 *   med = 0   → 0
 *   med = kw  → 50  (was ~40 in the old formula)
 *   med = 2kw → 100
 * The previous split (level 0–60 + pctAbove 0–40) produced ~40 at iROIC=kw,
 * disagreeing with capalloc's 50 for the same input. Both modules now share
 * one shape so reviewers see consistent scores across the moat and capital
 * allocation reports.
 */
export function scoreReinvestmentQuality(
  periods: RecastPeriod[],
  kw: number,
): MoatDimension {
  const rawValues: MoatDimension["rawValues"] = [];
  const incRNOAValues: number[] = [];

  const sorted = [...periods].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime()
  );

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i]!;
    const prev = sorted[i - 1]!;

    // Review W11: `?? 0` lets a NaN/undefined NOA collapse silently to 0,
    // producing a fake dNOA = -prevNOA and a phantom incremental RNOA.
    // Mirror the capitalAllocation C6 fix: only proceed when both endpoints
    // are explicitly finite numbers.
    const prevNOAraw = prev.bs?.NOA;
    const currNOAraw = curr.bs?.NOA;
    const prevCoreOIraw = prev.cu?.CoreOI;
    const currCoreOIraw = curr.cu?.CoreOI;

    const prevNOA = (prevNOAraw != null && Number.isFinite(prevNOAraw)) ? prevNOAraw : null;
    const currNOA = (currNOAraw != null && Number.isFinite(currNOAraw)) ? currNOAraw : null;
    const prevCoreOI = (prevCoreOIraw != null && Number.isFinite(prevCoreOIraw)) ? prevCoreOIraw : null;
    const currCoreOI = (currCoreOIraw != null && Number.isFinite(currCoreOIraw)) ? currCoreOIraw : null;

    if (prevNOA == null || currNOA == null || prevCoreOI == null || currCoreOI == null) {
      rawValues.push({ period: curr.period_end, value: null });
      continue;
    }

    const dNOA    = currNOA - prevNOA;
    const dCoreOI = currCoreOI - prevCoreOI;

    if (Math.abs(dNOA) > 1) {  // avoid division by near-zero
      const incRNOA = dCoreOI / dNOA; // use signed dNOA to capture shrink/grow
      if (Number.isFinite(incRNOA) && Math.abs(incRNOA) < 5) {
        incRNOAValues.push(incRNOA);
        rawValues.push({ period: curr.period_end, value: incRNOA });
      } else {
        rawValues.push({ period: curr.period_end, value: null });
      }
    } else {
      rawValues.push({ period: curr.period_end, value: null });
    }
  }

  const evidence: string[] = [];
  if (!incRNOAValues.length) {
    return { name: "Reinvestment Quality", score: 50, weight: 0.15, evidence: ["Insufficient data for incremental RNOA"], rawValues };
  }

  const medIncRNOA = medianOf(incRNOAValues)!;
  const pctAbove   = incRNOAValues.filter(v => v > kw).length / incRNOAValues.length;

  // Single-shape calibration (W7): med=kw → 50, med=2kw → 100, med<=0 → 0.
  // Guard against a degenerate kw <= 0 (would NaN the ratio).
  const score = (kw > 0)
    ? clamp((medIncRNOA / (2 * kw)) * 100, 0, 100)
    : (medIncRNOA > 0 ? 100 : 0);

  evidence.push(`Median incremental RNOA: ${(medIncRNOA * 100).toFixed(1)}% vs kw: ${(kw * 100).toFixed(1)}%`);
  evidence.push(`${Math.round(pctAbove * 100)}% of reinvestment years earned above kw`);
  if (medIncRNOA > kw * 1.5) evidence.push("Reinvestment earns well above cost of capital — compounding machine");

  return { name: "Reinvestment Quality", score: clamp(Math.round(score), 0, 100), weight: 0.15, evidence, rawValues };
}

/**
 * Dimension 5: ATO Stability
 * Asset turnover stability signals operational efficiency moat.
 * Highly stable ATO = process/scale advantage.
 */
export function scoreATOStability(periods: RecastPeriod[]): MoatDimension {
  const rawValues: MoatDimension["rawValues"] = [];
  const atoValues: number[] = [];

  for (const p of periods) {
    const ato = p.ratios?.ATO ?? null;
    rawValues.push({ period: p.period_end, value: ato });
    if (ato != null && Number.isFinite(ato) && ato > 0) atoValues.push(ato);
  }

  const evidence: string[] = [];
  if (!atoValues.length) {
    return { name: "ATO Stability", score: 50, weight: 0.10, evidence: ["No ATO data"], rawValues };
  }

  const medATO = medianOf(atoValues)!;
  const sd     = stdDev(atoValues) ?? 0;
  const cv     = medATO > 0 ? sd / medATO : 1;

  // Score: stability (0–70), level bonus for asset-light (0–30)
  const stabilityScore = clamp((1 - cv * 2) * 70, 0, 70);
  const levelScore     = medATO > 1.5 ? 30 : medATO > 0.8 ? 15 : 0;

  const score = Math.round(stabilityScore + levelScore);

  evidence.push(`Median ATO: ${medATO.toFixed(2)}x`);
  evidence.push(`ATO coefficient of variation: ${(cv * 100).toFixed(0)}%`);
  if (medATO > 2.0) evidence.push("High asset turnover — capital-light model");
  if (cv < 0.10)    evidence.push("Very stable asset utilization — operational moat");

  return { name: "ATO Stability", score: clamp(score, 0, 100), weight: 0.10, evidence, rawValues };
}

// ─── Moat Width Classification ────────────────────────────────────────────────

/**
 * Classify moat width per the doc-header rules (review W1).
 *
 * Minimum-period requirements protect against premature claims of durability:
 *   - "wide"   requires totalPeriods >= 7  (full cycle observation)
 *   - "narrow" requires totalPeriods >= 4  (multi-year confirmation)
 *   - <3 periods returns "insufficient-data" outright
 *
 * Without these gates, a 3-period sample could be labelled "wide" on the
 * back of a single boom-year SPREAD spike, contradicting the framework's
 * intent ("durable" = sustained across years).
 */
export function classifyMoatWidth(
  compositeScore: number,
  periodsAboveCOC: number,
  periodsWithStrongSpread: number,
  totalPeriods: number,
): MoatWidth {
  if (totalPeriods < 3) return "insufficient-data";

  const pctAbove  = periodsAboveCOC / totalPeriods;
  const pctStrong = periodsWithStrongSpread / totalPeriods;

  // "Wide" requires both score+strong-spread evidence AND >=7 periods
  if (compositeScore >= 75 && pctStrong >= 0.70 && totalPeriods >= 7) return "wide";
  // "Narrow" requires evidence AND >=4 periods
  if (compositeScore >= 55 && pctAbove >= 0.50 && totalPeriods >= 4)  return "narrow";
  return "none";
}
