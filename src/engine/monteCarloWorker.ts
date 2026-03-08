/// <reference lib="webworker" />
import { computeValuation } from "./PenmanNissimEngine";
import { convergenceByHalfMeans } from "./monteCarloMath";
import { assertValidMonteCarloInput, MonteCarloInput, MonteCarloOutput } from "./monteCarloTypes";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(random: () => number) {
  const u = 1 - random();
  const v = 1 - random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sample(d: { mean: number; std: number }, random: () => number) {
  return d.mean + d.std * randn(random);
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

self.onmessage = (ev: MessageEvent<unknown>) => {
  assertValidMonteCarloInput(ev.data);
  const { basePeriods, config, N, paramDistributions, seed } = ev.data as MonteCarloInput;
  const random = seed == null ? Math.random : mulberry32(seed);
  const n = Math.min(Math.max(N, 100), 50000);
  const reSamples = new Array<number>(n);
  const reoiSamples = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const ke = Math.max(0.03, sample(paramDistributions.ke, random));
    const kw = Math.max(0.03, sample(paramDistributions.kw, random));
    const g = Math.min(Math.max(0, sample(paramDistributions.g, random)), Math.max(0.0001, kw - 0.001));
    const v = computeValuation(basePeriods, ke, kw, g, config);
    reSamples[i] = v.V_RE_CV3;
    reoiSamples[i] = v.V_ReOI_CV03;
    if (i % 1000 === 0) (self as unknown as Worker).postMessage({ progress: i / n });
  }

  const rs = [...reSamples].sort((a, b) => a - b);
  const ws = [...reoiSamples].sort((a, b) => a - b);

  // Convergence: compare mean of first half vs second half of simulation draws.
  // The previous check (std/mean of the 1000 largest sorted values) was checking
  // tail volatility, not convergence of the estimator.
  const convergenceCheck = convergenceByHalfMeans(reSamples, 0.02);

  const out: MonteCarloOutput = {
    V_RE_samples: reSamples,
    V_ReOI_samples: reoiSamples,
    p10_RE: quantile(rs, 0.1),
    p50_RE: quantile(rs, 0.5),
    p90_RE: quantile(rs, 0.9),
    p10_ReOI: quantile(ws, 0.1),
    p50_ReOI: quantile(ws, 0.5),
    p90_ReOI: quantile(ws, 0.9),
    convergenceCheck,
  };
  (self as unknown as Worker).postMessage(out);
};

export {};
