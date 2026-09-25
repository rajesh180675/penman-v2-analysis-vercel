/**
 * Panel estimate of how fast abnormal operating profitability fades, from
 * Indian company history rather than a hand-set constant.
 *
 * Nissim & Penman (2001) measure fade toward the CROSS-SECTIONAL level, not
 * toward each firm's own mean: that is the structure the self-consistent
 * valuation model assumes (the spread over the required return decays toward
 * zero). So the estimator is pooled OLS of next year's deviation from the
 * year's cross-sectional median on this year's:
 *
 *   s(i,t+1) = a + φ · s(i,t),   s(i,t) = RNOA(i,t) − median_j RNOA(j,t)
 *
 * RNOA on a tiny or negative NOA base produces extreme values (e.g. a firm
 * running on negative working capital), which would dominate least squares.
 * Pairs whose CURRENT deviation lies outside the pooled 5th–95th percentile
 * band are trimmed — selection on the regressor only, which keeps OLS
 * consistent. (Clipping instead biased φ upward: a clipped extreme sits beside
 * an unclipped, already-faded next year, steepening the slope.) A within-firm (fixed-effects) estimate with the Nickell (1981)
 * correction is reported beside it as a diagnostic of firm-specific
 * persistence — it is NOT the prior, because it measures reversion to each
 * firm's own mean.
 */

export interface RnoaSeries {
  readonly companyId: string;
  readonly group: string;
  /** Core RNOA by fiscal year. */
  readonly points: readonly { readonly year: number; readonly rnoa: number }[];
}

export interface PersistenceEstimate {
  readonly group: string;
  /** Pooled cross-sectional-deviation AR(1) — the prior. */
  readonly phi: number;
  /** Within-firm AR(1), Nickell-corrected — diagnostic only. */
  readonly phiWithin: number | null;
  readonly pairs: number;
  readonly companies: number;
}

export const MIN_COMPANIES_FOR_GROUP_PRIOR = 3;
export const MIN_PAIRS_FOR_GROUP_PRIOR = 20;

function quantile(sorted: readonly number[], q: number): number {
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (index - lo);
}

function ols(pairs: readonly (readonly [number, number])[]): number | null {
  if (pairs.length < 3) return null;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / pairs.length;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / pairs.length;
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
  }
  return sxx > 0 ? sxy / sxx : null;
}

/** Deviations from each year's cross-sectional median across ALL series. */
function deviations(series: readonly RnoaSeries[]): Map<string, Map<number, number>> {
  const byYear = new Map<number, number[]>();
  for (const s of series) for (const p of s.points) {
    if (Number.isFinite(p.rnoa)) (byYear.get(p.year) ?? byYear.set(p.year, []).get(p.year)!).push(p.rnoa);
  }
  const medians = new Map<number, number>();
  for (const [year, values] of byYear) {
    // A median over one or two firms is not a cross-section.
    if (values.length < 3) continue;
    const sorted = [...values].sort((a, b) => a - b);
    medians.set(year, quantile(sorted, 0.5));
  }
  const out = new Map<string, Map<number, number>>();
  for (const s of series) {
    const m = new Map<number, number>();
    for (const p of s.points) {
      const median = medians.get(p.year);
      if (median != null && Number.isFinite(p.rnoa)) m.set(p.year, p.rnoa - median);
    }
    out.set(s.companyId, m);
  }
  return out;
}

function estimate(group: string, series: readonly RnoaSeries[], dev: Map<string, Map<number, number>>, bounds: [number, number]): PersistenceEstimate | null {
  const inBand = (x: number) => x >= bounds[0] && x <= bounds[1];
  const pooled: [number, number][] = [];
  const within: [number, number][] = [];
  let lengths = 0;
  let companies = 0;
  for (const s of series) {
    const d = dev.get(s.companyId)!;
    const years = [...d.keys()].sort((a, b) => a - b);
    const firmPairs: [number, number][] = [];
    for (const year of years) {
      const x = d.get(year)!;
      if (d.has(year + 1) && inBand(x)) firmPairs.push([x, d.get(year + 1)!]);
    }
    if (firmPairs.length < 2) continue;
    companies++;
    lengths += firmPairs.length + 1;
    pooled.push(...firmPairs);
    const mx = firmPairs.reduce((sum, [x]) => sum + x, 0) / firmPairs.length;
    const my = firmPairs.reduce((sum, [, y]) => sum + y, 0) / firmPairs.length;
    within.push(...firmPairs.map(([x, y]) => [x - mx, y - my] as [number, number]));
  }
  const phi = ols(pooled);
  if (phi == null) return null;
  const rawWithin = ols(within);
  const avgT = companies ? lengths / companies : 0;
  // Nickell (1981): the within estimator is biased down by ≈ (1 + φ)/(T − 1).
  const phiWithin = rawWithin != null && avgT > 2 ? rawWithin + (1 + rawWithin) / (avgT - 1) : rawWithin;
  return {
    group,
    phi: Math.min(Math.max(phi, 0), 0.98),
    phiWithin: phiWithin == null ? null : Math.min(Math.max(phiWithin, 0), 0.98),
    pairs: pooled.length,
    companies,
  };
}

/**
 * Persistence per group plus the pooled "all" estimate. A group gets its own
 * prior only with ≥3 companies and ≥20 year-pairs; smaller groups should fall
 * back to "all" (see `priorFor`).
 */
export function estimatePanelPersistence(series: readonly RnoaSeries[]): PersistenceEstimate[] {
  const dev = deviations(series);
  const all = [...dev.values()].flatMap((m) => [...m.values()]).sort((a, b) => a - b);
  if (all.length < 10) return [];
  const bounds: [number, number] = [quantile(all, 0.05), quantile(all, 0.95)];
  const out: PersistenceEstimate[] = [];
  const pooled = estimate("all", series, dev, bounds);
  if (pooled) out.push(pooled);
  for (const group of [...new Set(series.map((s) => s.group))].sort()) {
    const est = estimate(group, series.filter((s) => s.group === group), dev, bounds);
    if (est && est.companies >= MIN_COMPANIES_FOR_GROUP_PRIOR && est.pairs >= MIN_PAIRS_FOR_GROUP_PRIOR) out.push(est);
  }
  return out;
}

/** The estimate to use for a company group, falling back to the pooled one. */
export function priorFor(estimates: readonly PersistenceEstimate[], group: string | null | undefined): PersistenceEstimate | null {
  return estimates.find((e) => e.group === group) ?? estimates.find((e) => e.group === "all") ?? null;
}
