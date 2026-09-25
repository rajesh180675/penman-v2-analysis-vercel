/**
 * PVRE seeded sampler. Deterministic under an explicit seed so runs are
 * reproducible (the same property the analysis-run artifact hashing relies on).
 *
 * PRNG: mulberry32 — small, fast, adequate for Monte Carlo. The seed is
 * mandatory; no hidden Math.random().
 */
import type { DistributionSpec, PvreDriverDistributions, PvreDriverDraws } from "./types";

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller normal draw from a uniform rng. */
function randNormal(rng: Rng, mean: number, sd: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + sd * z;
}

function triangular(rng: Rng, min: number, mode: number, max: number): number {
  const u = rng();
  const c = (mode - min) / (max - min);
  if (u < c) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

export function sampleDistribution(spec: DistributionSpec, rng: Rng): number {
  switch (spec.family) {
    case "point":
      return spec.parameters.value ?? Number.NaN;
    case "normal":
      return randNormal(rng, spec.parameters.mean ?? 0, Math.max(1e-9, spec.parameters.sd ?? 0));
    case "lognormal": {
      const meanlog = spec.parameters.meanlog ?? 0;
      const sdlog = Math.max(1e-9, spec.parameters.sdlog ?? 0);
      return Math.exp(randNormal(rng, meanlog, sdlog));
    }
    case "triangular": {
      const min = spec.parameters.min ?? 0;
      const mode = spec.parameters.mode ?? min;
      const max = spec.parameters.max ?? min;
      return triangular(rng, min, mode, max);
    }
    case "empirical":
      // reserved for calibration milestone; fall back to point behavior
      return spec.parameters.value ?? Number.NaN;
  }
}

/** Independently sampled drivers; kw is derived from ke by the caller. */
export type SampledDrivers = Omit<PvreDriverDraws, "kw">;

export function sampleDrivers(
  dists: PvreDriverDistributions,
  rng: Rng,
  clamp?: (draws: SampledDrivers) => SampledDrivers,
): SampledDrivers {
  const draws: SampledDrivers = {
    ke: sampleDistribution(dists.ke, rng),
    gTerminal: sampleDistribution(dists.gTerminal, rng),
    salesGrowthYear1: sampleDistribution(dists.salesGrowthYear1, rng),
    corePmYear1: sampleDistribution(dists.corePmYear1, rng),
  };
  return clamp ? clamp(draws) : draws;
}

/** summary quantiles for a finite numeric array. */
export function quantileSummary(values: readonly number[]): import("./types").QuantileSummary | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return null;
  const pick = (p: number) => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return xs[lo]!;
    return xs[lo]! + (xs[hi]! - xs[lo]!) * (idx - lo);
  };
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const variance = xs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  return {
    q05: pick(0.05),
    q25: pick(0.25),
    q50: pick(0.5),
    q75: pick(0.75),
    q95: pick(0.95),
    mean,
    stdev: Math.sqrt(variance),
    n,
  };
}
