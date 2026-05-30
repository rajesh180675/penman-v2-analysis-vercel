/**
 * Cyclicality Detection — Phase I robustness
 *
 * Tata Steel FY2022 EBITDA margin: 25%+
 * Tata Steel FY2024 EBITDA margin: 8%
 *
 * A naive Penman-Nissim valuation snaps to whichever period is latest
 * and produces wildly different intrinsic values depending on where
 * the user happens to upload data. For commodity / cyclical businesses,
 * this is a major source of error — yet only matters for companies that
 * are actually cyclical (TCS shouldn't get flagged just because it had
 * one weak quarter).
 *
 * This module:
 *   1. Identifies whether a company is structurally cyclical based on
 *      the historical coefficient of variation of its margin/ROIC series.
 *   2. If cyclical, classifies the latest period as peak / trough /
 *      mid-cycle relative to historical distribution.
 *   3. Provides a normalised metric (median over the cycle) the caller
 *      can use as a sanity-check anchor.
 *
 * Skip-with-reason when:
 *   - Fewer than 5 periods (no cycle observation possible)
 *   - All periods have null/non-finite metric values
 *
 * NOT a full cyclical normalisation — doesn't replace the latest period
 * with the median in the recast. Just flags that valuation outputs
 * should be interpreted with cycle-position awareness.
 */

import type { RecastPeriod } from "./types";

/**
 * Cyclicality classification.
 *  - "non-cyclical": margin/ROIC series has CV < 0.20, no flag needed
 *  - "cyclical-peak": company is cyclical and latest period is at peak
 *  - "cyclical-trough": company is cyclical and latest period is at trough
 *  - "cyclical-midcycle": company is cyclical but latest is mid-range
 *  - "insufficient-data": <5 periods or no usable values
 */
export type CyclicalityClass =
  | "non-cyclical"
  | "cyclical-peak"
  | "cyclical-trough"
  | "cyclical-midcycle"
  | "insufficient-data";

export interface CyclicalityAssessment {
  classification: CyclicalityClass;
  /** Coefficient of variation of the chosen metric (CoreSalesPM or RNOA). */
  cv: number | null;
  /** Latest period's metric value. */
  latestValue: number | null;
  /** Median across history. Useful as cycle-normalised anchor. */
  medianValue: number | null;
  /** Latest's z-score vs historical (null when stdev≈0 or insufficient data). */
  zScore: number | null;
  /** Number of periods that contributed to the analysis. */
  periodsObserved: number;
  /** Which metric drove the classification: "core-pm" or "rnoa". */
  metricUsed: "core-pm" | "rnoa" | "none";
  /** Human-readable reason describing the classification. */
  reason: string;
  /** Pessimistic/optimistic anchors for cycle-aware valuation framing. */
  troughValue: number | null;
  peakValue: number | null;
}

/** CV threshold above which a series is considered "structurally cyclical". */
const CYCLICAL_CV_THRESHOLD = 0.20;

/** Z-score threshold to classify peak/trough vs mid-cycle. */
const PEAK_TROUGH_Z_THRESHOLD = 0.75;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/**
 * Extract a cyclical metric series. Prefer CoreSalesPM (operating margin),
 * fall back to RNOA. Returns null when neither has ≥5 valid observations.
 */
function pickMetricSeries(
  periods: RecastPeriod[],
): { values: number[]; metric: "core-pm" | "rnoa" } | null {
  const sorted = [...periods].sort(
    (a, b) =>
      new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );

  const corePM = sorted
    .map((p) => p.ratios?.CoreSalesPM)
    .filter((v): v is number => v != null && Number.isFinite(v));

  if (corePM.length >= 5) return { values: corePM, metric: "core-pm" };

  const rnoa = sorted
    .map((p) => p.ratios?.RNOA)
    .filter((v): v is number => v != null && Number.isFinite(v));

  if (rnoa.length >= 5) return { values: rnoa, metric: "rnoa" };

  return null;
}

/**
 * Compute cyclicality assessment for a recast period series.
 *
 * Returns a structured result with classification, CV, z-score, and
 * peak/trough/median anchors. Caller uses this to decide whether to
 * surface cycle-position warnings in the UI and to provide alternative
 * cycle-normalised valuation anchors.
 */
export function assessCyclicality(
  periods: RecastPeriod[] | null | undefined,
  companyType?: string | null | undefined,
): CyclicalityAssessment {
  // Phase D2: explicit override from company_type dropdown
  if (companyType === "cyclical") {
    // Still compute actual stats for anchoring, but force classification
    const fallback = assessCyclicalityInternal(periods);
    return {
      ...fallback,
      classification: fallback.classification === "insufficient-data" ? "insufficient-data" : fallback.classification === "non-cyclical" ? "cyclical-midcycle" : fallback.classification,
      reason: fallback.classification === "insufficient-data"
        ? fallback.reason
        : `Explicit company_type=cyclical (computed CV=${fallback.cv?.toFixed(2) ?? "n/a"})`,
    };
  }

  return assessCyclicalityInternal(periods);
}

function assessCyclicalityInternal(
  periods: RecastPeriod[] | null | undefined,
): CyclicalityAssessment {
  if (!periods || periods.length < 5) {
    return {
      classification: "insufficient-data",
      cv: null,
      latestValue: null,
      medianValue: null,
      zScore: null,
      periodsObserved: periods?.length ?? 0,
      metricUsed: "none",
      reason: `Need ≥5 periods to assess cyclicality, got ${periods?.length ?? 0}`,
      troughValue: null,
      peakValue: null,
    };
  }

  const series = pickMetricSeries(periods);
  if (!series) {
    return {
      classification: "insufficient-data",
      cv: null,
      latestValue: null,
      medianValue: null,
      zScore: null,
      periodsObserved: periods.length,
      metricUsed: "none",
      reason: "Neither CoreSalesPM nor RNOA has ≥5 valid observations",
      troughValue: null,
      peakValue: null,
    };
  }

  const { values, metric } = series;
  const med = median(values);
  const sd = stdDev(values);
  const latest = values[values.length - 1]!;

  // Use absolute median for CV when median is small (e.g. RNOA could be near 0)
  // to avoid divide-by-near-zero blowups.
  const cv = med != null && Math.abs(med) > 1e-6 && sd != null
    ? sd / Math.abs(med)
    : null;

  const trough = quantile(values, 0.10);
  const peak = quantile(values, 0.90);

  // Non-cyclical: CV below threshold means margins are stable.
  if (cv == null || cv < CYCLICAL_CV_THRESHOLD) {
    return {
      classification: "non-cyclical",
      cv,
      latestValue: latest,
      medianValue: med,
      zScore: null,
      periodsObserved: values.length,
      metricUsed: metric,
      reason: `CV of ${metric} is ${cv != null ? (cv * 100).toFixed(0) + "%" : "n/a"} — below ${CYCLICAL_CV_THRESHOLD * 100}% cyclicality threshold`,
      troughValue: trough,
      peakValue: peak,
    };
  }

  // Cyclical: classify latest period's position.
  const zScore = sd != null && sd > 0 && med != null ? (latest - med) / sd : null;

  let classification: CyclicalityClass = "cyclical-midcycle";
  let reasonExtra = "";
  if (zScore != null && zScore > PEAK_TROUGH_Z_THRESHOLD) {
    classification = "cyclical-peak";
    reasonExtra = `; latest ${metric} is ${zScore.toFixed(1)} σ above median — likely peak-cycle`;
  } else if (zScore != null && zScore < -PEAK_TROUGH_Z_THRESHOLD) {
    classification = "cyclical-trough";
    reasonExtra = `; latest ${metric} is ${(-zScore).toFixed(1)} σ below median — likely trough-cycle`;
  } else {
    reasonExtra = `; latest ${metric} is near median — mid-cycle`;
  }

  return {
    classification,
    cv,
    latestValue: latest,
    medianValue: med,
    zScore,
    periodsObserved: values.length,
    metricUsed: metric,
    reason: `CV of ${metric} is ${(cv * 100).toFixed(0)}% — above ${CYCLICAL_CV_THRESHOLD * 100}% cyclicality threshold${reasonExtra}`,
    troughValue: trough,
    peakValue: peak,
  };
}
