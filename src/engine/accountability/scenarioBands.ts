/**
 * Scenario band coverage: where filed outcomes fell against the stress, base
 * and bull forecasts made from history alone.
 *
 * At each walk-forward cutoff (the same cutoffs and point-in-time capital
 * costs as walkForwardCompany) the persistence scenarios are built from the
 * truncated history, and each later year's filed sales and CNI is placed
 * below the stress path, between stress and bull, or above the bull path. A
 * stress or bull case that means what its name says leaves a minority of
 * outcomes beyond it; the base case's own accuracy is walkForward.ts's.
 *
 * The same caveat as the walk-forward: Capitaline serves restated figures, so
 * a cutoff can see restatements of its own history.
 */
import { buildAnchoredForecast } from "../anchoredValuationPeriods";
import type { EngineConfig, RecastPeriod } from "../types";
import { DEFAULT_MAX_HORIZON, MIN_HISTORY_FOR_ORIGIN, originCapitalCosts } from "./walkForward";

export type BandPosition = "below" | "within" | "above";

export interface ScenarioBandObservation {
  readonly cutoffPeriod: string;
  readonly metric: "sales" | "cni";
  readonly horizon: number;
  readonly panic: number;
  readonly stress: number;
  readonly base: number;
  readonly bull: number;
  readonly actual: number;
  /** Against the stress–bull band. */
  readonly position: BandPosition;
}

/** Below the lower of stress and bull, above the higher, or between them. */
export function placeInBand(actual: number, stress: number, bull: number): BandPosition {
  const lo = Math.min(stress, bull);
  const hi = Math.max(stress, bull);
  return actual < lo ? "below" : actual > hi ? "above" : "within";
}

const yearOf = (period: RecastPeriod) => Number(period.period_end.slice(0, 4));
const SCENARIOS = ["historical-panic", "stress", "base", "bull"] as const;

/** Every admissible cutoff's scenario paths against what was later filed. */
export function walkForwardScenarioBands(
  periods: readonly RecastPeriod[],
  config: EngineConfig,
  options: { readonly minHistory?: number | undefined; readonly maxHorizon?: number | undefined } = {},
): ScenarioBandObservation[] {
  const minHistory = options.minHistory ?? MIN_HISTORY_FOR_ORIGIN;
  const maxHorizon = options.maxHorizon ?? DEFAULT_MAX_HORIZON;
  const sorted = [...periods].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const observations: ScenarioBandObservation[] = [];
  for (let cut = minHistory - 1; cut < sorted.length - 1; cut++) {
    const history = sorted.slice(0, cut + 1);
    const cutoff = history[history.length - 1]!;
    let paths: Record<(typeof SCENARIOS)[number], ReturnType<typeof buildAnchoredForecast>["periods"]>;
    try {
      const costs = originCapitalCosts(history, config);
      paths = Object.fromEntries(SCENARIOS.map((scenarioKey) => [
        scenarioKey,
        buildAnchoredForecast({ history, config, ...costs, horizon: Math.max(maxHorizon, 5), scenarioKey }).periods,
      ])) as typeof paths;
    } catch {
      continue;
    }
    for (let h = 1; h <= maxHorizon; h++) {
      // Match by fiscal year, never by position.
      const actual = sorted.find((period) => yearOf(period) === yearOf(cutoff) + h);
      if (!actual) continue;
      const at = (key: (typeof SCENARIOS)[number]) => paths[key][h - 1];
      if (SCENARIOS.some((key) => !at(key))) continue;
      const push = (metric: ScenarioBandObservation["metric"], value: (p: NonNullable<ReturnType<typeof at>>) => number, filed: number) => {
        const [panic, stress, base, bull] = SCENARIOS.map((key) => value(at(key)!)) as [number, number, number, number];
        if (![panic, stress, base, bull, filed].every(Number.isFinite)) return;
        observations.push({ cutoffPeriod: cutoff.period_end, metric, horizon: h, panic, stress, base, bull, actual: filed, position: placeInBand(filed, stress, bull) });
      };
      push("sales", (p) => p.Sales_f, actual.is.Sales);
      push("cni", (p) => p.CNI_f, actual.is.CNI);
    }
  }
  return observations;
}

export interface ScenarioBandSummary {
  readonly metric: ScenarioBandObservation["metric"];
  readonly horizon: number;
  readonly n: number;
  /** Shares of outcomes below stress, between stress and bull, above bull, and below the historical panic. */
  readonly below: number;
  readonly within: number;
  readonly above: number;
  readonly belowPanic: number;
  /** Over observations with a positive base: medians of each path over base, and quantiles of the outcome over base. */
  readonly stressToBase: number | null;
  readonly bullToBase: number | null;
  readonly actualToBase: { readonly p10: number; readonly p20: number; readonly p50: number; readonly p80: number; readonly p90: number } | null;
}

function quantile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

export function summarizeScenarioBands(observations: readonly ScenarioBandObservation[]): ScenarioBandSummary[] {
  const groups = new Map<string, ScenarioBandObservation[]>();
  for (const o of observations) {
    const key = `${o.metric}:${o.horizon}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return [...groups.values()]
    .map((group) => {
      const share = (test: (o: ScenarioBandObservation) => boolean) => group.filter(test).length / group.length;
      const positive = group.filter((o) => o.base > 0);
      const ratios = (pick: (o: ScenarioBandObservation) => number) => positive.map((o) => pick(o) / o.base);
      const actual = ratios((o) => o.actual);
      return {
        metric: group[0]!.metric,
        horizon: group[0]!.horizon,
        n: group.length,
        below: share((o) => o.position === "below"),
        within: share((o) => o.position === "within"),
        above: share((o) => o.position === "above"),
        belowPanic: share((o) => o.actual < o.panic),
        stressToBase: positive.length ? quantile(ratios((o) => o.stress), 0.5) : null,
        bullToBase: positive.length ? quantile(ratios((o) => o.bull), 0.5) : null,
        actualToBase: actual.length
          ? { p10: quantile(actual, 0.1), p20: quantile(actual, 0.2), p50: quantile(actual, 0.5), p80: quantile(actual, 0.8), p90: quantile(actual, 0.9) }
          : null,
      };
    })
    .sort((a, b) => a.metric.localeCompare(b.metric) || a.horizon - b.horizon);
}
