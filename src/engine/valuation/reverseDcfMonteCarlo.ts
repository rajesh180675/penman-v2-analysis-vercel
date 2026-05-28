/* ================================================================
   Plan 5 PR-5.1 — Reverse-DCF Monte Carlo with seeded RNG.

   Solves: "given the current price, what perpetual growth rate is
   the market pricing in, and what's the 90% credible interval
   around that estimate when growth, margin, and WACC are
   distributions rather than point estimates?"

   Reproducibility: every run is seeded by xmur3(runId), so two runs
   with the same runId produce byte-identical paths. Audit reviewers
   can re-run a saved run and confirm the interval cell-for-cell.

   This is a pure function (no I/O, no React, no engine deps). The
   advanced model panel will call it; the persistence layer ships
   the interval as part of the run.

   Algorithm:
     1. seed = xmur3(runId).next()
     2. rng = mulberry32(seed)
     3. for i in 0..N:
          draw growth ~ Normal(g_mean, g_sigma)
          draw margin ~ Normal(m_mean, m_sigma)
          draw wacc   ~ Normal(w_mean, w_sigma), clamped > growth
          solve for terminal growth g* such that:
            current_price = sum_t discount(FCFt, wacc) over horizon
            with FCFt = revenue_t * margin
        record g*
     4. return P5/P50/P95 of g*
================================================================ */

export interface ReverseDcfMonteCarloInputs {
  /** Run id — used to derive a deterministic seed. */
  runId: string;
  /** Current per-share market price (₹). */
  currentPrice: number;
  /** Latest revenue per share (₹). */
  revenuePerShare: number;
  /** Distribution params for FCF/Revenue margin (decimal: 0.15 = 15%). */
  margin: { mean: number; sigma: number };
  /** Distribution params for revenue growth (decimal). */
  growth: { mean: number; sigma: number };
  /** Distribution params for WACC (decimal). */
  wacc: { mean: number; sigma: number };
  /** Horizon in years for the explicit forecast period (default 10). */
  horizonYears?: number | undefined;
  /** Number of Monte Carlo paths (default 10000). */
  paths?: number | undefined;
}

export interface ReverseDcfMonteCarloResult {
  /** Implied terminal growth at P5/P50/P95. Decimal (0.04 = 4%). */
  impliedGrowthP5: number;
  impliedGrowthP50: number;
  impliedGrowthP95: number;
  /** Number of converged paths (paths where wacc > growth). */
  convergedPaths: number;
  /** Number of paths discarded (wacc <= growth or solver failure). */
  discardedPaths: number;
  /** Seed used (echo for audit). */
  seed: number;
}

/** xmur3 string-to-int hash. Returns a function that yields successive 32-bit ints. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** mulberry32 PRNG seeded by a 32-bit int. Yields uniform [0, 1). */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller: two uniforms -> one standard normal. */
function boxMuller(u1: number, u2: number): number {
  const safeU1 = Math.max(u1, 1e-12);
  return Math.sqrt(-2.0 * Math.log(safeU1)) * Math.cos(2.0 * Math.PI * u2);
}

/**
 * Solve for terminal growth g such that
 *   currentPrice = sum_{t=1..H} margin * revenue_t / (1+wacc)^t  +  TV / (1+wacc)^H
 * where revenue_t = revenuePerShare * (1+growth)^t and
 *       TV = margin * revenue_H * (1+g) / (wacc - g).
 *
 * Bisection on g in [-0.05, wacc - 0.001]. Returns NaN when bounds disagree.
 */
function solveImpliedGrowth(args: {
  currentPrice: number;
  revenuePerShare: number;
  margin: number;
  growth: number;
  wacc: number;
  horizon: number;
}): number {
  const { currentPrice, revenuePerShare, margin, growth, wacc, horizon } = args;
  if (wacc <= growth) return NaN;
  // PV of explicit period — same regardless of g
  let pvExplicit = 0;
  let revenueT = revenuePerShare;
  for (let t = 1; t <= horizon; t++) {
    revenueT *= 1 + growth;
    pvExplicit += (margin * revenueT) / Math.pow(1 + wacc, t);
  }
  const lastRevenue = revenueT;
  const lastFcf = margin * lastRevenue;
  const discountAtH = Math.pow(1 + wacc, horizon);

  const priceFromG = (g: number): number => {
    if (g >= wacc) return Infinity;
    const tv = (lastFcf * (1 + g)) / (wacc - g);
    return pvExplicit + tv / discountAtH;
  };

  let lo = -0.05;
  let hi = wacc - 0.001;
  const fLo = priceFromG(lo) - currentPrice;
  const fHi = priceFromG(hi) - currentPrice;
  if (Number.isNaN(fLo) || Number.isNaN(fHi)) return NaN;
  if (fLo * fHi > 0) return NaN; // no sign change — implied g outside bounds

  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    const fMid = priceFromG(mid) - currentPrice;
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fMid * fLo < 0) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return 0.5 * (lo + hi);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx]!;
}

export function runReverseDcfMonteCarlo(
  inputs: ReverseDcfMonteCarloInputs,
): ReverseDcfMonteCarloResult {
  const horizon = inputs.horizonYears ?? 10;
  const paths = inputs.paths ?? 10_000;

  const seedFn = xmur3(inputs.runId);
  const seed = seedFn();
  const rng = mulberry32(seed);

  const samples: number[] = [];
  let discarded = 0;

  for (let i = 0; i < paths; i++) {
    const u1 = rng();
    const u2 = rng();
    const u3 = rng();
    const u4 = rng();
    const u5 = rng();
    const u6 = rng();
    const zG = boxMuller(u1, u2);
    const zM = boxMuller(u3, u4);
    const zW = boxMuller(u5, u6);

    const growth = inputs.growth.mean + zG * inputs.growth.sigma;
    const margin = Math.max(0.001, inputs.margin.mean + zM * inputs.margin.sigma);
    const wacc = Math.max(growth + 0.001, inputs.wacc.mean + zW * inputs.wacc.sigma);

    const g = solveImpliedGrowth({
      currentPrice: inputs.currentPrice,
      revenuePerShare: inputs.revenuePerShare,
      margin,
      growth,
      wacc,
      horizon,
    });
    if (Number.isFinite(g)) {
      samples.push(g);
    } else {
      discarded++;
    }
  }

  samples.sort((a, b) => a - b);

  return {
    impliedGrowthP5: percentile(samples, 0.05),
    impliedGrowthP50: percentile(samples, 0.5),
    impliedGrowthP95: percentile(samples, 0.95),
    convergedPaths: samples.length,
    discardedPaths: discarded,
    seed,
  };
}
