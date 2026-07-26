import type { RecastPeriod } from "../types";
import type {
  ForecastHoldoutFold,
  ForecastHoldoutMetric,
  ForecastHoldoutMetricError,
  ForecastHoldoutSummary,
  HoldoutVintageIndex,
  NoLookAheadDisclosure,
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
  const benchmarkPredicted = metricValues(train, metric).at(-1) ?? null;
  const absoluteError = actual != null && predicted != null ? Math.abs(actual - predicted) : null;
  const percentageError = absoluteError != null && actual != null && Math.abs(actual) > 1e-9
    ? absoluteError / Math.abs(actual)
    : null;
  const benchmarkPercentageError = benchmarkPredicted != null && actual != null && Math.abs(actual) > 1e-9
    ? Math.abs(actual - benchmarkPredicted) / Math.abs(actual)
    : null;
  return {
    metric,
    actual,
    predicted,
    absoluteError,
    percentageError,
    benchmarkPredicted,
    benchmarkPercentageError,
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

/**
 * Ordering discipline is free — `evaluateForecastHoldout` trains on
 * `slice(0, testIndex)`, so a training window can never reach the test period.
 * Vintage discipline has to be earned, and a single dated export cannot earn it:
 * every period in it was observed on the same later date, so a figure restated
 * after the fact is indistinguishable from what was originally filed. Training
 * on restated numbers inflates apparent skill, which is exactly the error a
 * holdout exists to rule out.
 *
 * Returns `unverified` with a reason rather than downgrading the whole holdout:
 * the error metrics are still informative, they just cannot be called
 * out-of-sample.
 */
function assessNoLookAhead(
  coveredPeriodEnds: readonly string[],
  vintage: HoldoutVintageIndex | null | undefined,
): NoLookAheadDisclosure {
  const unverified = (reason: string): NoLookAheadDisclosure => ({
    status: "unverified",
    policy: "strict-prior-period-training",
    orderingDiscipline: "confirmed",
    vintageDiscipline: "unverified",
    reason,
  });

  if (!vintage) {
    return unverified("No per-filing vintage index supplied; training values are as-restated-today, not as-published-then.");
  }
  if (vintage.kind !== "per-filing") {
    return unverified(
      `Periods were observed as "${vintage.kind}", so every figure shares one observation date and a restatement cannot be distinguished from an original filing.`,
    );
  }

  const byPeriod = new Map(vintage.periods.map((entry) => [entry.periodEnd, entry]));
  const covered = coveredPeriodEnds.map((periodEnd) => byPeriod.get(periodEnd));
  const missing = coveredPeriodEnds.filter((periodEnd) => !byPeriod.get(periodEnd)?.filingAsOf);
  if (missing.length) {
    return unverified(`No filing date for ${missing.length} of ${coveredPeriodEnds.length} periods (${missing.slice(0, 3).join(", ")}).`);
  }

  for (const entry of covered) {
    if (!entry?.filingAsOf) continue;
    if (entry.filingAsOf < entry.periodEnd) {
      return unverified(`Period ${entry.periodEnd} claims a filing date of ${entry.filingAsOf}, which precedes the period it reports.`);
    }
  }

  for (let index = 1; index < covered.length; index += 1) {
    const prev = covered[index - 1]?.filingAsOf;
    const cur = covered[index]?.filingAsOf;
    if (prev && cur && cur <= prev) {
      return unverified(`Filing dates are not strictly increasing at ${covered[index]?.periodEnd} (${prev} → ${cur}); vintages appear collapsed.`);
    }
  }

  return {
    status: "confirmed",
    policy: "per-filing-vintage",
    orderingDiscipline: "confirmed",
    vintageDiscipline: "confirmed",
  };
}

export function evaluateForecastHoldout(
  periods: RecastPeriod[] | null | undefined,
  vintage?: HoldoutVintageIndex | null,
): ForecastHoldoutSummary {
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
        calibrationStatus: "unavailable",
        sampleSize: 0,
        minimumTrainPeriods: MIN_TRAIN_PERIODS,
        benchmark: { name: "last-observation-carried-forward", weightedMape: null, skillVsBenchmark: null },
        // No folds ran, so there is nothing to make a vintage claim about.
        noLookAhead: assessNoLookAhead([], vintage),
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
  const benchmarkMetricMape: Partial<Record<ForecastHoldoutMetric, number>> = {};
  for (const def of METRICS) {
    const errors = folds
      .flatMap((fold) => fold.metrics)
      .filter((item) => item.metric === def.metric)
      .map((item) => item.percentageError)
      .filter((value): value is number => value != null && Number.isFinite(value));
    const metricMedian = median(errors);
    if (metricMedian != null) metricMape[def.metric] = metricMedian;
    const benchmarkErrors = folds
      .flatMap((fold) => fold.metrics)
      .filter((item) => item.metric === def.metric)
      .map((item) => item.benchmarkPercentageError)
      .filter((value): value is number => value != null && Number.isFinite(value));
    const benchmarkMedian = median(benchmarkErrors);
    if (benchmarkMedian != null) benchmarkMetricMape[def.metric] = benchmarkMedian;
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
  let benchmarkNumerator = 0;
  let benchmarkDenominator = 0;
  for (const def of METRICS) {
    const mape = benchmarkMetricMape[def.metric];
    if (mape == null || !Number.isFinite(mape)) continue;
    benchmarkNumerator += mape * def.weight;
    benchmarkDenominator += def.weight;
  }
  const benchmarkWeightedMape = benchmarkDenominator > 0 ? benchmarkNumerator / benchmarkDenominator : null;
  const skillVsBenchmark = weightedMape != null && benchmarkWeightedMape != null && benchmarkWeightedMape > 1e-12
    ? (benchmarkWeightedMape - weightedMape) / benchmarkWeightedMape
    : null;
  const status = aggregateStatus(weightedMape);
  const calibrationStatus = status === "failed"
    ? "failed" as const
    : status === "unavailable"
      ? "unavailable" as const
      : status === "confirmed" && folds.length >= 3 && (skillVsBenchmark ?? -1) > 0
        ? "calibrated" as const
        : "degraded" as const;

  return {
    available: status !== "unavailable",
    folds,
    aggregate: {
      metricMape,
      weightedMape,
      status,
      confidencePenaltyPct: confidencePenaltyPct(status, weightedMape),
      valuationRangeWideningPct: valuationRangeWideningPct(status, weightedMape),
      calibrationStatus,
      sampleSize: folds.length,
      minimumTrainPeriods: MIN_TRAIN_PERIODS,
      benchmark: {
        name: "last-observation-carried-forward",
        weightedMape: benchmarkWeightedMape,
        skillVsBenchmark,
      },
      // Disclosed, not enforced. `calibrationStatus` deliberately still reflects
      // measured error only: demoting it on unverified vintage would change
      // confidence output for every company at once, and the demotion belongs
      // to the assumption-provenance gate that consumes this disclosure.
      // Every period participates as train or test, so all of them need vintage —
      // not just the tested ones.
      noLookAhead: assessNoLookAhead(ordered.map((period) => period.period_end), vintage),
    },
  };
}
