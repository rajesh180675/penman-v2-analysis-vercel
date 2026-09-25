/**
 * PVRE calibration scoring — Milestone C.
 *
 * Quantifies whether PVRE's predicted intrinsic-value distribution is
 * *calibrated* against observed prices: do the quantiles we publish imply the
 * right hit-rates against the market across vintages?
 *
 * This complements (not duplicates) `valuationEvidence/forecastHoldout.ts`:
 *  - that module backtests POINT forecasts of fundamentals on historical
 *    sub-windows and reports MAPE per metric;
 *  - this module backtests the DISTRIBUTION of intrinsic value vs the price
 *    the market actually traded at on each vintage date.
 *
 * Output is a coverage table ("what fraction of vintages had market price lie
 * inside our published 80% CI") and a CRPS-style probabilistic score. Perfect
 * calibration means ~80% of vintages inside the 80% CI — not that the CI
 * brackets today's price exactly.
 */
import type { PvreOutput, QuantileSummary } from "./types";

export interface PvreVintageCalibrationRow {
  readonly asOfDate: string;
  readonly marketPrice: number;
  /** quantile of the market price within the predicted intrinsic distribution
   * — 0 = market far below our lowest draw (we'd call it screamingly cheap);
   * 1 = market far above our highest draw (we'd call it extremely expensive) */
  readonly priceQuantile: number | null;
  readonly in80Ci: boolean | null;
  readonly in50Ci: boolean | null;
}

export interface PvreCalibrationScore {
  /** fraction of vintages where market price lay within the published 80% CI */
  readonly coverage80: number | null;
  readonly coverage50: number | null;
  readonly meanPinballLoss80: number | null;
  readonly meanPinballLoss50: number | null;
  readonly rowCount: number;
  readonly label: "well-calibrated" | "overconfident" | "underconfident" | "insufficient-data";
  readonly reason: string;
}

const MIN_ROWS = 4;

function pinballLoss(tau: number, y: number, q: number): number {
  const d = y - q;
  return d >= 0 ? tau * d : (tau - 1) * d;
}

/** Score many vintage-dated snapshots of (predicted distribution, market price). */
export function scorePvreCalibration(
  rows: readonly {
    asOfDate: string;
    marketPrice: number;
    pvre: PvreOutput;
  }[],
): PvreCalibrationScore {
  const scored: PvreVintageCalibrationRow[] = [];
  // Each scored row keeps ITS OWN distribution. Looking the quantiles up again
  // by asOfDate paired every same-date run (distinct seeds/iterations are a
  // permitted snapshot shape) with the FIRST run's quantiles, mis-scoring the
  // pinball losses — and crashed when that first run had no distribution.
  const available: Array<{ row: PvreVintageCalibrationRow; q: QuantileSummary }> = [];
  for (const row of rows) {
    const q = row.pvre.intrinsic;
    if (q == null || !Number.isFinite(row.marketPrice)) {
      scored.push({
        asOfDate: row.asOfDate,
        marketPrice: row.marketPrice,
        priceQuantile: null,
        in80Ci: null,
        in50Ci: null,
      });
      continue;
    }
    const scoredRow: PvreVintageCalibrationRow = {
      asOfDate: row.asOfDate,
      marketPrice: row.marketPrice,
      priceQuantile: quantileOfPrice(q, row.marketPrice),
      in80Ci: row.marketPrice >= q.q05 && row.marketPrice <= q.q95,
      in50Ci: row.marketPrice >= q.q25 && row.marketPrice <= q.q75,
    };
    scored.push(scoredRow);
    available.push({ row: scoredRow, q });
  }
  if (available.length < MIN_ROWS) {
    return {
      coverage80: null,
      coverage50: null,
      meanPinballLoss80: null,
      meanPinballLoss50: null,
      rowCount: scored.length,
      label: "insufficient-data",
      reason: `Need ≥${MIN_ROWS} dated vintage rows with market price + PVRE distribution; have ${available.length}.`,
    };
  }
  const cov80 = fractionTrue(available.map(({ row }) => row.in80Ci));
  const cov50 = fractionTrue(available.map(({ row }) => row.in50Ci));
  const mpb80 = meanOrNull(
    available.map(({ row, q }) => (
      pinballLoss(0.05, row.marketPrice, q.q05) + pinballLoss(0.95, row.marketPrice, q.q95)
    ) / 2),
  );
  const mpb50 = meanOrNull(
    available.map(({ row, q }) => (
      pinballLoss(0.25, row.marketPrice, q.q25) + pinballLoss(0.75, row.marketPrice, q.q75)
    ) / 2),
  );
  const label: PvreCalibrationScore["label"] =
    cov80 == null ? "insufficient-data"
    : cov80 <= 0.5 ? "overconfident"      // CI misses at least half the time → too narrow
    : cov80 > 0.95 ? "underconfident"     // CI nearly always brackets → too wide
    : "well-calibrated";
  return {
    coverage80: cov80,
    coverage50: cov50,
    meanPinballLoss80: mpb80,
    meanPinballLoss50: mpb50,
    rowCount: scored.length,
    label,
    reason:
      `coverage80=${fmt(cov80)} (target ~0.80), coverage50=${fmt(cov50)} (target ~0.50) ` +
      `across ${available.length} vintages.`,
  };
}

function fmt(v: number | null): string {
  return v == null ? "?" : (v * 100).toFixed(0) + "%";
}

function fractionTrue(xs: readonly (boolean | null)[]): number | null {
  const usable = xs.filter((x): x is boolean => x != null);
  if (!usable.length) return null;
  return usable.filter(Boolean).length / usable.length;
}

function meanOrNull(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function quantileOfPrice(q: QuantileSummary, price: number): number | null {
  // Approximate: interpolate the inverse CDF between the five published
  // quantile points. Returns null when price sits beyond q05/q95 range where
  // interpolation is forced to flat-extrapolate.
  const pts: ReadonlyArray<readonly [number, number]> = [
    [0.05, q.q05],
    [0.25, q.q25],
    [0.5, q.q50],
    [0.75, q.q75],
    [0.95, q.q95],
  ];
  if (price < q.q05 || price > q.q95) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [pLo, vLo] = pts[i]!;
    const [pHi, vHi] = pts[i + 1]!;
    if (price >= vLo && price <= vHi) {
      if (vHi === vLo) return pLo;
      return pLo + ((price - vLo) / (vHi - vLo)) * (pHi - pLo);
    }
  }
  return null;
}
