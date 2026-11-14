/**
 * How far a company's core operating margin moves back toward its own earlier
 * level, measured on what was filed afterwards.
 *
 * The forecast starts the margin at the latest year's and fades it toward the
 * median of the years before (forecastDriverModel.ts, `marginTarget`), closing
 * a share 1 − α^h of the gap by year h (`makeFadeArray`). α is a sector
 * template's constant, 0.84–0.92, set by hand (less a persistence penalty,
 * so 0.72–0.89, until this was measured). This measures that share directly:
 *
 *   margin(t+h) − margin(t) = share(h) · (target(t) − margin(t)) + error
 *
 * with the target the median of a window of years before t. The share is the
 * least-absolute-deviations slope through the origin, which is the weighted
 * median of move ÷ gap with |gap| as the weight: one year's write-off moves a
 * least-squares slope and leaves this one where it was.
 *
 * A filed margin carries one-off items a forecast cannot know, so part of what
 * reverts is noise in the latest year rather than economics. That is still
 * what a forecast started from the latest year has to allow for.
 */

export interface MarginSeries {
  readonly companyId: string;
  /** Core operating margin, after tax, as a share of sales, by fiscal year. */
  readonly points: readonly { readonly year: number; readonly margin: number }[];
}

/** One forecast origin: the margin at the cutoff, the level it might return to, and what was filed h years on. */
export interface MarginReversionObservation {
  readonly companyId: string;
  readonly origin: number;
  readonly horizon: number;
  readonly latest: number;
  readonly target: number;
  readonly outcome: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Every (company, origin) with a margin at the origin, at origin + horizon, and
 * in at least `minYears` of the `window` years before the origin. The target is
 * the median of those earlier years, the latest left out, as the forecast's is.
 * A margin outside `bounds` at the origin, in the outcome or in the target
 * drops the observation: a ratio on next to no sales is not a margin.
 */
export function marginReversionObservations(
  series: readonly MarginSeries[],
  options: {
    readonly origins: readonly number[];
    readonly horizon: number;
    readonly window: number;
    readonly minYears?: number;
    readonly bounds?: readonly [number, number];
  },
): MarginReversionObservation[] {
  const { origins, horizon, window } = options;
  const minYears = options.minYears ?? window;
  const [low, high] = options.bounds ?? [-Infinity, Infinity];
  const inBounds = (value: number) => Number.isFinite(value) && value >= low && value <= high;
  const observations: MarginReversionObservation[] = [];
  for (const company of series) {
    const byYear = new Map(company.points.map((point) => [point.year, point.margin]));
    for (const origin of origins) {
      const latest = byYear.get(origin);
      const outcome = byYear.get(origin + horizon);
      if (latest == null || outcome == null) continue;
      const earlier: number[] = [];
      for (let year = origin - window; year < origin; year++) {
        const margin = byYear.get(year);
        if (margin != null && Number.isFinite(margin)) earlier.push(margin);
      }
      if (earlier.length < minYears || earlier.length === 0) continue;
      const target = median(earlier);
      if (!inBounds(latest) || !inBounds(outcome) || !inBounds(target)) continue;
      observations.push({ companyId: company.companyId, origin, horizon, latest, target, outcome });
    }
  }
  return observations;
}

/**
 * The share of the gap to the target that the margin closed: the slope through
 * the origin that minimizes the summed absolute error. Null when no
 * observation has a gap.
 */
export function reversionShare(observations: readonly MarginReversionObservation[]): number | null {
  const ratios = observations
    .map((o) => ({ gap: o.target - o.latest, move: o.outcome - o.latest }))
    .filter((o) => o.gap !== 0)
    .map((o) => ({ ratio: o.move / o.gap, weight: Math.abs(o.gap) }))
    .sort((a, b) => a.ratio - b.ratio);
  if (ratios.length === 0) return null;
  const half = ratios.reduce((sum, r) => sum + r.weight, 0) / 2;
  let cumulative = 0;
  for (const r of ratios) {
    cumulative += r.weight;
    if (cumulative >= half) return r.ratio;
  }
  return ratios.at(-1)!.ratio;
}

/** The margin a forecast that closes `share` of the gap puts at the horizon. */
export function fadedMargin(observation: MarginReversionObservation, share: number): number {
  return observation.latest + share * (observation.target - observation.latest);
}

/** The share of the gap the shipped fade closes by year h at a fade constant α. */
export function shareClosedAt(alpha: number, horizon: number): number {
  return 1 - alpha ** horizon;
}
