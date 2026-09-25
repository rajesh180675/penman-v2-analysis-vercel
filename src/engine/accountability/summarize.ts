import {
  ACCOUNTABILITY_METRICS,
  ACCOUNTABILITY_SCHEMA_VERSION,
  NAIVE_BENCHMARKS,
  type AccountabilityMetric,
  type AccountabilitySummary,
  type CompanyWalkForward,
  type MetricHorizonSummary,
  type NaiveBenchmark,
} from "./types";

const mean = (xs: readonly number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const median = (xs: readonly number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const ratioSkill = (model: number, naive: number) => (naive > 0 ? 1 - model / naive : 0);

/** Pool scored observations across companies, per metric and horizon. */
export function summarizeWalkForward(results: readonly CompanyWalkForward[]): AccountabilitySummary {
  const rows: MetricHorizonSummary[] = [];
  const observations = results.flatMap((result) => result.origins.flatMap((origin) => origin.observations));
  const horizons = [...new Set(observations.map((o) => o.horizon))].sort((a, b) => a - b);
  for (const metric of ACCOUNTABILITY_METRICS) {
    for (const horizon of horizons) {
      const slice = observations.filter((o) => o.metric === metric && o.horizon === horizon);
      if (!slice.length) continue;
      const modelMae = mean(slice.map((o) => Math.abs(o.model)));
      const modelMdae = median(slice.map((o) => Math.abs(o.model)));
      const naiveMae = Object.fromEntries(
        NAIVE_BENCHMARKS.map((b) => [b, mean(slice.map((o) => Math.abs(o.naive[b])))]),
      ) as Record<NaiveBenchmark, number>;
      const naiveMdae = Object.fromEntries(
        NAIVE_BENCHMARKS.map((b) => [b, median(slice.map((o) => Math.abs(o.naive[b])))]),
      ) as Record<NaiveBenchmark, number>;
      const skill = Object.fromEntries(
        NAIVE_BENCHMARKS.map((b) => [b, ratioSkill(modelMae, naiveMae[b])]),
      ) as Record<NaiveBenchmark, number>;
      const medianSkill = Object.fromEntries(
        NAIVE_BENCHMARKS.map((b) => [b, ratioSkill(modelMdae, naiveMdae[b])]),
      ) as Record<NaiveBenchmark, number>;
      rows.push({
        metric,
        horizon,
        n: slice.length,
        modelMae,
        modelMdae,
        modelBias: mean(slice.map((o) => o.model)),
        naiveMae,
        naiveMdae,
        skill,
        medianSkill,
        winRateVsRandomWalk: slice.filter((o) => Math.abs(o.model) < Math.abs(o.naive["random-walk"])).length / slice.length,
      });
    }
  }
  return {
    schemaVersion: ACCOUNTABILITY_SCHEMA_VERSION,
    companies: results.filter((r) => r.origins.length > 0).length,
    origins: results.reduce((sum, r) => sum + r.origins.length, 0),
    rows,
  };
}

/** One company's one-year-ahead record against "nothing changes". */
export interface CompanyTrackRecord {
  readonly ticker: string;
  /** Per metric: forecast years scored, and in how many the model beat a random walk. */
  readonly oneYearAhead: Readonly<Partial<Record<AccountabilityMetric, { readonly scored: number; readonly beatRandomWalk: number }>>>;
}

/**
 * Count, per metric, the one-year-ahead forecasts that were closer to the
 * outcome than a random walk. A count, not a skill ratio: it is what a reader
 * can check against the years listed, and one bad year cannot dominate it.
 */
export function companyTrackRecord(result: CompanyWalkForward): CompanyTrackRecord {
  const oneYear = result.origins.flatMap((origin) => origin.observations).filter((o) => o.horizon === 1);
  const oneYearAhead: Partial<Record<AccountabilityMetric, { scored: number; beatRandomWalk: number }>> = {};
  for (const metric of ACCOUNTABILITY_METRICS) {
    const slice = oneYear.filter((o) => o.metric === metric);
    if (!slice.length) continue;
    oneYearAhead[metric] = {
      scored: slice.length,
      beatRandomWalk: slice.filter((o) => Math.abs(o.model) < Math.abs(o.naive["random-walk"])).length,
    };
  }
  return { ticker: result.ticker, oneYearAhead };
}
