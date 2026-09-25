/**
 * Forecast accountability — scoring what the app predicted against what then
 * happened.
 *
 * Every number the engine shows is traceable; none of them has ever been
 * checked against an outcome. This module does that, and always against a
 * naive benchmark: a forecast that cannot beat "nothing changes" is not
 * adding information, however well-traced it is.
 */

export const ACCOUNTABILITY_SCHEMA_VERSION = "2026-09-forecast-accountability-v1" as const;

/** What is scored. Each is scale-free so companies of every size pool together. */
export type AccountabilityMetric =
  /** ln(forecast sales / actual sales). */
  | "sales-log-error"
  /**
   * Core RNOA on opening NOA, forecast − actual, in fraction points. Scored
   * only where opening NOA is at least 10% of sales on both sides: on a
   * near-zero base (negative working capital) RNOA runs to ±1,000%+ and one
   * company swamps the pooled mean.
   */
  | "core-rnoa-error"
  /** (forecast OI − actual core OI) / actual sales: the robust operating metric. */
  | "core-oi-margin-error"
  /** (forecast CNI − actual CNI) / actual opening CSE: an ROE-point error. */
  | "cni-roe-point-error";

export const ACCOUNTABILITY_METRICS: readonly AccountabilityMetric[] = [
  "sales-log-error",
  "core-oi-margin-error",
  "core-rnoa-error",
  "cni-roe-point-error",
];

/** Benchmarks a forecast must beat to count as information. */
export type NaiveBenchmark =
  /** Levels and ratios stay where they are. */
  | "random-walk"
  /** Trailing-3-year sales CAGR continues; RNOA and ROE revert to their 3-year mean. */
  | "trailing-trend";

export const NAIVE_BENCHMARKS: readonly NaiveBenchmark[] = ["random-walk", "trailing-trend"];

/** One forecasted quantity for one future year, with its actual and the naive predictions. */
export interface ScoredObservation {
  readonly metric: AccountabilityMetric;
  /** Years ahead of the forecast origin (1 = the year after the cutoff). */
  readonly horizon: number;
  readonly model: number;
  readonly naive: Readonly<Record<NaiveBenchmark, number>>;
}

/** One forecast made from data cut at `cutoffPeriod`, scored against later actuals. */
export interface ForecastOrigin {
  readonly cutoffPeriod: string;
  /** Periods of history the forecast was allowed to see. */
  readonly historyLength: number;
  readonly observations: readonly ScoredObservation[];
}

export interface CompanyWalkForward {
  readonly schemaVersion: typeof ACCOUNTABILITY_SCHEMA_VERSION;
  readonly ticker: string;
  readonly companyType: string;
  readonly origins: readonly ForecastOrigin[];
  /** Why origins were skipped (too little history, forecast failure, …). */
  readonly skipped: readonly { readonly cutoffPeriod: string; readonly reason: string }[];
}

export interface MetricHorizonSummary {
  readonly metric: AccountabilityMetric;
  readonly horizon: number;
  readonly n: number;
  /** Mean absolute error of the model. */
  readonly modelMae: number;
  /** Median absolute error — robust to the few extreme observations. */
  readonly modelMdae: number;
  /** Mean signed error (forecast − actual): positive = optimistic. */
  readonly modelBias: number;
  readonly naiveMae: Readonly<Record<NaiveBenchmark, number>>;
  readonly naiveMdae: Readonly<Record<NaiveBenchmark, number>>;
  /**
   * 1 − MAE_model / MAE_naive. Positive = the model beats that benchmark;
   * 0.2 = 20% less error. Negative = the benchmark is better.
   */
  readonly skill: Readonly<Record<NaiveBenchmark, number>>;
  /** 1 − MdAE_model / MdAE_naive: the same comparison on medians. */
  readonly medianSkill: Readonly<Record<NaiveBenchmark, number>>;
  /** Share of observations where the model's error is smaller than random walk's. */
  readonly winRateVsRandomWalk: number;
}

export interface AccountabilitySummary {
  readonly schemaVersion: typeof ACCOUNTABILITY_SCHEMA_VERSION;
  readonly companies: number;
  readonly origins: number;
  readonly rows: readonly MetricHorizonSummary[];
}
