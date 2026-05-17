/// <reference lib="webworker" />
import { computeValuation } from "./PenmanNissimEngine";
import { convergenceByHalfMeans } from "./monteCarloMath";
import { assertValidMonteCarloInput, MonteCarloInput, MonteCarloOutput } from "./monteCarloTypes";
import { buildSOTPValuation, SegmentDefinition } from "./sotpValuation";

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
  const { basePeriods, config, N, paramDistributions, seed, segmentDefinitions, segmentUncertainties } =
    ev.data as MonteCarloInput;
  const random = seed == null ? Math.random : mulberry32(seed);
  const n = Math.min(Math.max(N, 100), 50000);
  const reSamples = new Array<number>(n);
  const reoiSamples = new Array<number>(n);

  // SOTP simulation: only run if both segment definitions and uncertainties are provided
  const runSOTP =
    Array.isArray(segmentDefinitions) &&
    segmentDefinitions.length > 0 &&
    Array.isArray(segmentUncertainties) &&
    segmentUncertainties.length > 0;
  const sotpSamples: number[] = runSOTP ? new Array<number>(n) : [];

  // Latest period for SOTP (most recent)
  const latestPeriod = basePeriods[basePeriods.length - 1];

  for (let i = 0; i < n; i++) {
    const ke = Math.max(0.03, sample(paramDistributions.ke, random));
    const kw = Math.max(0.03, sample(paramDistributions.kw, random));
    const g = Math.min(Math.max(0, sample(paramDistributions.g, random)), Math.max(0.0001, kw - 0.001));
    const v = computeValuation(basePeriods, ke, kw, g, config);
    // Phase J2: equity-side V_RE_CV3 may be null when latest CSE ≤ 0.
    // Substitute NaN so the histogram caller's existing NaN-filter drops
    // these draws rather than feeding null into Math.min/Math.max.
    reSamples[i] = v.V_RE_CV3 ?? Number.NaN;
    reoiSamples[i] = v.V_ReOI_CV03;

    // SOTP draw: perturb each segment's EBIT share, normalize to sum=1
    if (runSOTP && segmentDefinitions && segmentUncertainties) {
      const perturbedShares: Record<string, number> = {};
      let totalShare = 0;

      for (const seg of segmentDefinitions) {
        const unc = segmentUncertainties.find(u => u.name === seg.name);
        if (unc) {
          // Sample perturbed share, clamp to (0.001, 0.999). Upper clamp
          // prevents a runaway draw on the dominant segment from collapsing
          // every other segment's normalized share to ~0 when the random
          // tail extends past 1.0 (review W7).
          const draw = sample(unc.meanShare, random);
          const s = Math.max(0.001, Math.min(0.999, draw));
          perturbedShares[seg.name] = s;
          totalShare += s;
        } else {
          // No uncertainty data — use base share as-is
          perturbedShares[seg.name] = seg.operatingProfitShare;
          totalShare += seg.operatingProfitShare;
        }
      }

      // Normalize so shares sum to 1
      const perturbedDefs: SegmentDefinition[] = segmentDefinitions.map(seg => ({
        ...seg,
        operatingProfitShare: totalShare > 0 ? perturbedShares[seg.name] / totalShare : seg.operatingProfitShare,
      }));

      const sotpResult = buildSOTPValuation(latestPeriod, perturbedDefs, ke);
      sotpSamples[i] = sotpResult.totalEnterpriseValue;
    }

    if (i % 1000 === 0) (self as unknown as Worker).postMessage({ progress: i / n });
  }

  const rs = [...reSamples].sort((a, b) => a - b);
  const ws = [...reoiSamples].sort((a, b) => a - b);

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

  if (runSOTP && sotpSamples.length > 0) {
    const ss = [...sotpSamples].sort((a, b) => a - b);
    out.V_SOTP_samples = sotpSamples;
    out.p10_SOTP = quantile(ss, 0.1);
    out.p50_SOTP = quantile(ss, 0.5);
    out.p90_SOTP = quantile(ss, 0.9);
  }

  (self as unknown as Worker).postMessage(out);
};

export {};

