/**
 * Economic Moat Scoring — statistical helpers (median, std dev, AR(1) phi,
 * CAP fade estimation, trend). Shared by industrial and bank scorers.
 */

import { CAPEstimate } from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function medianOf(values: number[]): number | null {
  const clean = values.filter(v => Number.isFinite(v));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function stdDev(values: number[]): number | null {
  const clean = values.filter(v => Number.isFinite(v));
  if (clean.length < 2) return null;
  const mean = clean.reduce((s, v) => s + v, 0) / clean.length;
  const variance = clean.reduce((s, v) => s + (v - mean) ** 2, 0) / (clean.length - 1);
  return Math.sqrt(variance);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Clamp AR(1) phi to a stable, economically defensible range [0, 0.95].
 * - Negative phi (oscillatory) is clamped to 0 — AR(1) fade math assumes monotone decay.
 * - phi >= 1 produces infinite/non-finite CAP; cap at 0.95.
 *
 * Project rule (CLAUDE.md S-9.4C): phi must be clamped before any fade calc
 * (review C7). Single source of truth here so callers can't bypass.
 */
function clampPhi(phi: number | null): number | null {
  if (phi == null || !Number.isFinite(phi)) return null;
  return Math.max(0, Math.min(0.95, phi));
}

/**
 * Estimate AR(1) phi from a time series using OLS.
 * phi = Cov(x_t, x_{t-1}) / Var(x_{t-1})
 */
export function estimatePhi(series: number[]): number | null {
  if (series.length < 4) return null;
  const x = series.slice(0, -1);
  const y = series.slice(1);
  const n = x.length;
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  const cov = x.reduce((s, v, i) => s + (v - meanX) * (y[i]! - meanY), 0);
  const varX = x.reduce((s, v) => s + (v - meanX) ** 2, 0);
  if (varX < 1e-10) return null;
  const phi = cov / varX;
  // Negative phi indicates oscillatory behavior (cyclical industries).
  // We do not clamp here; callers should check phi range before using for fade.
  return phi;
}

/**
 * Estimate CAP: years until RNOA fades to kw using AR(1) model.
 * RNOA_t = kw + (RNOA_0 - kw) * phi^t
 * Solve for t: t = log(threshold / spread_0) / log(phi)
 * where threshold = 0.01 (within 1% of kw)
 */
export function estimateCAP(
  latestRNOA: number,
  kw: number,
  phi: number | null,
  rnoaSeries: number[],
): CAPEstimate {
  const spread0 = latestRNOA - kw;
  const phiClamped = clampPhi(phi);

  if (spread0 <= 0) {
    return {
      years: 0,
      phi: phiClamped,
      latestRNOA,
      kw,
      confidence: "high",
      method: "ar1-fade",
    };
  }

  if (phiClamped != null && phiClamped > 0 && phiClamped < 1) {
    // t = log(0.01 / spread0) / log(phi)
    const threshold = 0.01;
    const t = Math.log(threshold / spread0) / Math.log(phiClamped);
    const years = t > 0 ? Math.round(Math.min(t, 50)) : null;
    return {
      years,
      phi: phiClamped,
      latestRNOA,
      kw,
      confidence: rnoaSeries.length >= 7 ? "high" : "medium",
      method: "ar1-fade",
    };
  }

  // Fallback: linear extrapolation from last 3 periods
  if (rnoaSeries.length >= 3) {
    const recent = rnoaSeries.slice(-3);
    const slope = (recent[2]! - recent[0]!) / 2;
    if (slope < 0 && spread0 > 0) {
      const years = Math.round(Math.min(spread0 / Math.abs(slope), 50));
      return {
        years,
        phi: null,
        latestRNOA,
        kw,
        confidence: "low",
        method: "linear-extrapolation",
      };
    }
  }

  return {
    years: null,
    phi: phiClamped,
    latestRNOA,
    kw,
    confidence: "low",
    method: "insufficient-data",
  };
}

export function computeTrend(
  values: Array<number | null>,
): "strengthening" | "stable" | "eroding" | "insufficient-data" {
  const clean = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (clean.length < 4) return "insufficient-data";
  const mid = Math.floor(clean.length / 2);
  const firstHalf  = clean.slice(0, mid);
  const secondHalf = clean.slice(mid);
  const avgFirst  = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  const delta = avgSecond - avgFirst;
  if (delta > 0.01)  return "strengthening";
  if (delta < -0.01) return "eroding";
  return "stable";
}
