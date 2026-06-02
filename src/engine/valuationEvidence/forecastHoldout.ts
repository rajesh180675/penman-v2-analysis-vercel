import type { RecastPeriod } from "../types";
import type {
  ForecastHoldoutFold,
  ForecastHoldoutMetric,
  ForecastHoldoutMetricError,
  ForecastHoldoutSummary,
} from "./types";

const MIN_PERIODS = 6;
const MIN_TRAIN_PERIODS = 4;
const CONFIRMED_MPE = 0.15;
const FAILED_MPE = 0.30;

const METRICS: Array<{ metric: ForecastHoldoutMetric; weight: number; extractor: (p: RecastPeriod) => number | null | undefined }> = [
  { metric: "sales", weight: 0.18, extractor: (p) => p.is.Sales },
  { metric: "core_margin", weight: 0.14, extractor: (p) => p.ratios?.CoreSalesPM ?? (p.is.Sales ? p.is.OI / p.is.Sales : null) },
  { metric: "rnoa", weight: 0.14, extractor: (p) => p.ratios?.RNOA },
  { metric: "cfo", weight: 0.12, extractor: (p) => p.cf.CFO },
  { metric: "capex", weight: 0.10, extractor: (p) => Math.abs(p.cf.Capex ?? NaN) },
  { metric: "fcf_cash", weight: 0.12, extractor: (p) => p.cf.FCF_cash },
  { metric: "cse", weight: 0.10, extractor: (p) => p.bs.CSE },
  { metric: "noa", weight: 0.10, extractor: (p) => p.bs.NOA },
];

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function metricValues(train: RecastPeriod[], metric: ForecastHoldoutMetric): number[] {
  const def = METRICS.find((item) => item.metric === metric)!;
  return train.map((period) => finiteOrNull(def.extractor(period))).filter((value): value is number => value != null);
}

function predictNext(train: RecastPeriod[], metric: ForecastHoldoutMetric): number | null {
  const values = metricValues(train, metric);
  if (values.length < 2) return null;

  if (metric === "core_margin" || metric === "rnoa") {
    return median(values.slice(-3));
  }

  const growths: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1]!;
    const cur = values[i]!;
    if (Math.abs(prev) < 1e-9) continue;
    growths.push((cur - prev) / Math.abs(prev));
  }
  const g = median(growths.slice(-3));
  if (g == null) return null;
  return values[values.length - 1]! * (1 + g);
}

function metricStatus(pct: number | null): ForecastHoldoutMetricError["status"] {
  if (pct == null || !Number.isFinite(pct)) return "unavailable";
  if (pct >= FAILED_MPE) return "failed";
  if (pct >= CONFIRMED_MPE) return "degraded";
  return "confirmed";
}

function compareMetric(train: RecastPeriod[], test: RecastPeriod, metric: ForecastHoldoutMetric): ForecastHoldoutMetricError {
  const def = METRICS.find((item) => item.metric === metric)!;
  const actual = finiteOrNull(def.extractor(test));
  const predicted = predictNext(train, metric);
  const absoluteError = actual != null && predicted != null ? Math.abs(actual - predicted) : null;
  const percentageError = absoluteError != null && actual != null && Math.abs(actual) > 1e-9
    ? absoluteError / Math.abs(actual)
    : null;
  return {
    metric,
    actual,
    predicted,
    absoluteError,
    percentageError,
    status: metricStatus(percentageError),
  };
}

function aggregateStatus(weightedMape: number | null): ForecastHoldoutSummary["aggregate"]["status"] {
  if (weightedMape == null) return "unavailable";
  if (weightedMape >= FAILED_MPE) return "failed";
  if (weightedMape >= CONFIRMED_MPE) return "degraded";
  return "confirmed";
}

function confidencePenaltyPct(status: ForecastHoldoutSummary["aggregate"]["status"], weightedMape: number | null): number {
  if (status === "confirmed") return 0;
  if (status === "degraded") return Math.min(0.2, Math.max(0.1, weightedMape ?? 0.15));
  if (status === "failed") return Math.min(0.35, Math.max(0.25, weightedMape ?? 0.3));
  return 0.15;
}

function valuationRangeWideningPct(status: ForecastHoldoutSummary["aggregate"]["status"], weightedMape: number | null): number {
  if (status === "confirmed") return Math.min(0.05, weightedMape ?? 0.03);
  if (status === "degraded") return Math.min(0.2, Math.max(0.1, weightedMape ?? 0.15));
  if (status === "failed") return Math.min(0.4, Math.max(0.25, weightedMape ?? 0.3));
  return 0.15;
}

export function evaluateForecastHoldout(periods: RecastPeriod[] | null | undefined): ForecastHoldoutSummary {
  const ordered = [...(periods ?? [])].sort((a, b) => a.period_end.localeCompare(b.period_end));
  if (ordered.length < MIN_PERIODS) {
    return {
      available: false,
      reason: `Forecast holdout requires at least ${MIN_PERIODS} periods with ${MIN_TRAIN_PERIODS} train periods; received ${ordered.length}.`,
      folds: [],
      aggregate: {
        metricMape: {},
        weightedMape: null,
        status: "unavailable",
        confidencePenaltyPct: 0.15,
        valuationRangeWideningPct: 0.15,
      },
    };
  }

  const folds: ForecastHoldoutFold[] = [];
  for (let testIndex = MIN_TRAIN_PERIODS; testIndex < ordered.length; testIndex += 1) {
    const train = ordered.slice(0, testIndex);
    const test = ordered[testIndex]!;
    folds.push({
      trainWindow: {
        from: train[0]!.period_end,
        to: train[train.length - 1]!.period_end,
        periods: train.length,
      },
      testPeriod: test.period_end,
      metrics: METRICS.map((item) => compareMetric(train, test, item.metric)),
    });
  }

  const metricMape: Partial<Record<ForecastHoldoutMetric, number>> = {};
  for (const def of METRICS) {
    const errors = folds
      .flatMap((fold) => fold.metrics)
      .filter((item) => item.metric === def.metric)
      .map((item) => item.percentageError)
      .filter((value): value is number => value != null && Number.isFinite(value));
    const metricMedian = median(errors);
    if (metricMedian != null) metricMape[def.metric] = metricMedian;
  }

  let weightedNumerator = 0;
  let weightDenominator = 0;
  for (const def of METRICS) {
    const mape = metricMape[def.metric];
    if (mape == null || !Number.isFinite(mape)) continue;
    weightedNumerator += mape * def.weight;
    weightDenominator += def.weight;
  }
  const weightedMape = weightDenominator > 0 ? weightedNumerator / weightDenominator : null;
  const status = aggregateStatus(weightedMape);

  return {
    available: status !== "unavailable",
    folds,
    aggregate: {
      metricMape,
      weightedMape,
      status,
      confidencePenaltyPct: confidencePenaltyPct(status, weightedMape),
      valuationRangeWideningPct: valuationRangeWideningPct(status, weightedMape),
    },
  };
}
