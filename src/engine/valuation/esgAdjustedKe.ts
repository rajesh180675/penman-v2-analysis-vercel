/* ================================================================
   Plan 5b PR-5b.4 — ESG-adjusted cost of equity.

   Investors are increasingly pricing ESG risk into the equity
   discount rate. MSCI's ESG ratings (AAA -> CCC) compress the
   continuous score into 7 buckets; converting that to an
   explicit bp adjustment to ke makes the impact transparent.

   Adjustment magnitudes (bps) reflect typical Indian equity
   research-house practice (range -75 to +200 bps):
     AAA  -75    sustainability leaders
     AA   -40
     A    -15
     BBB    0    market neutral
     BB   +30
     B    +75
     CCC +200    laggards / controversies

   This module exposes:
     bucketForScore(0..10)       continuous -> bucket
     esgAdjustmentBps(bucket)    bucket -> bps
     esgAdjustedKe({baseKe, ...}) baseKe + adjustment + citation

   Adjustments are configurable via override but ship with these
   defensible defaults. Citation block makes the bucket + bps
   explicit so the reviewer can challenge or exclude.

   PR-5b.4 ships the lookup + adjustment + tests. Wiring config.cost_of_equity
   to derive automatically from a populated MSCI score is a follow-up.
================================================================ */

export type EsgBucket = "AAA" | "AA" | "A" | "BBB" | "BB" | "B" | "CCC";

/** Default bp adjustments. Negative = credit (lower ke); positive = charge. */
export const ESG_BUCKETS: Record<EsgBucket, { minScore: number; bps: number }> = {
  AAA: { minScore: 8.0, bps: -75 },
  AA: { minScore: 7.0, bps: -40 },
  A: { minScore: 5.5, bps: -15 },
  BBB: { minScore: 4.5, bps: 0 },
  BB: { minScore: 3.5, bps: 30 },
  B: { minScore: 2.5, bps: 75 },
  CCC: { minScore: 0, bps: 200 },
};

const BUCKET_ORDER: EsgBucket[] = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"];

export function bucketForScore(score: number): EsgBucket {
  if (score >= ESG_BUCKETS.AAA.minScore) return "AAA";
  for (const bucket of BUCKET_ORDER) {
    if (score >= ESG_BUCKETS[bucket].minScore) return bucket;
  }
  return "CCC";
}

export function esgAdjustmentBps(bucket: EsgBucket): number {
  return ESG_BUCKETS[bucket].bps;
}

export interface EsgAdjustedKeInputs {
  /** Baseline cost of equity (decimal). */
  baseKe: number;
  /** MSCI ESG score (0..10). One of msciScore or bucket is required. */
  msciScore?: number;
  /** Direct bucket override. Wins over msciScore. */
  bucket?: EsgBucket;
  /** Custom bp override for the resolved bucket. */
  customBpsOverride?: number;
}

export interface EsgAdjustedKeResult {
  adjustedKe: number;
  citation: {
    baseKe: number;
    msciScore: number | null;
    bucket: EsgBucket;
    adjustmentBps: number;
    overrideUsed: boolean;
  };
}

export function esgAdjustedKe(inputs: EsgAdjustedKeInputs): EsgAdjustedKeResult {
  if (inputs.bucket == null && inputs.msciScore == null) {
    throw new Error("esgAdjustedKe: either bucket or msciScore is required");
  }
  const bucket = inputs.bucket ?? bucketForScore(inputs.msciScore!);
  const bps = inputs.customBpsOverride ?? esgAdjustmentBps(bucket);
  const adjustedKe = inputs.baseKe + bps / 10_000;
  return {
    adjustedKe,
    citation: {
      baseKe: inputs.baseKe,
      msciScore: inputs.msciScore ?? null,
      bucket,
      adjustmentBps: bps,
      overrideUsed: inputs.customBpsOverride != null,
    },
  };
}
