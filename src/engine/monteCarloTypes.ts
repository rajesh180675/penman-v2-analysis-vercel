import type { EngineConfig, RecastPeriod } from "./types";
import type { SegmentDefinition } from "./sotpValuation";
import type { SegmentData } from "./segmentParser";

export interface MonteCarloDist {
  mean: number;
  std: number;
}

/**
 * Uncertainty specification for a single segment's EBIT share.
 * Derived from historical variance in segment EBIT contributions.
 */
export interface SegmentUncertainty {
  /** Segment name (must match SegmentDefinition.name) */
  name: string;
  /** Mean EBIT share (0–1) */
  meanShare: MonteCarloDist;
}

export interface MonteCarloRequest {
  basePeriods: RecastPeriod[];
  config: EngineConfig;
  N?: number | undefined;
  horizonT?: number | undefined;
  seed?: number | undefined;
  paramDistributions: {
    ke: MonteCarloDist;
    kw: MonteCarloDist;
    g: MonteCarloDist;
  };
  /** Optional: segment definitions for SOTP simulation */
  segmentDefinitions?: SegmentDefinition[] | undefined;
  /** Optional: per-segment EBIT share uncertainty (derived from historical data) */
  segmentUncertainties?: SegmentUncertainty[] | undefined;
}

export interface MonteCarloInput {
  basePeriods: RecastPeriod[];
  config: EngineConfig;
  N: number;
  horizonT: number;
  seed?: number | undefined;
  paramDistributions: {
    ke: MonteCarloDist;
    kw: MonteCarloDist;
    g: MonteCarloDist;
  };
  segmentDefinitions?: SegmentDefinition[] | undefined;
  segmentUncertainties?: SegmentUncertainty[] | undefined;
}

export interface MonteCarloProgressMessage {
  progress: number;
}

export interface MonteCarloOutput {
  V_RE_samples: number[];
  V_ReOI_samples: number[];
  p10_RE: number;
  p50_RE: number;
  p90_RE: number;
  p10_ReOI: number;
  p50_ReOI: number;
  p90_ReOI: number;
  convergenceCheck: boolean;
  /** SOTP samples — only populated when segmentDefinitions + segmentUncertainties are provided */
  V_SOTP_samples?: number[] | undefined;
  p10_SOTP?: number | undefined;
  p50_SOTP?: number | undefined;
  p90_SOTP?: number | undefined;
}

export function normalizeMonteCarloRequest(req: MonteCarloRequest): MonteCarloInput {
  return {
    ...req,
    N: req.N ?? 10000,
    horizonT: req.horizonT ?? 5,
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validateDistribution(name: string, v: unknown): asserts v is MonteCarloDist {
  if (typeof v !== "object" || v === null) {
    throw new Error(`Monte Carlo '${name}' distribution is missing`);
  }
  const dist = v as Partial<MonteCarloDist>;
  if (!isFiniteNumber(dist.mean)) {
    throw new Error(`Monte Carlo '${name}.mean' must be a finite number`);
  }
  if (!isFiniteNumber(dist.std) || dist.std < 0) {
    throw new Error(`Monte Carlo '${name}.std' must be a finite non-negative number`);
  }
}

export function assertValidMonteCarloInput(v: unknown): asserts v is MonteCarloInput {
  if (typeof v !== "object" || v === null) {
    throw new Error("Monte Carlo payload must be an object");
  }
  const input = v as Partial<MonteCarloInput>;
  if (!Array.isArray(input.basePeriods) || input.basePeriods.length === 0) {
    throw new Error("Monte Carlo 'basePeriods' must be a non-empty array");
  }
  if (typeof input.config !== "object" || input.config === null) {
    throw new Error("Monte Carlo 'config' must be an object");
  }
  if (!isFiniteNumber(input.N) || input.N <= 0) {
    throw new Error("Monte Carlo 'N' must be a positive finite number");
  }
  if (!isFiniteNumber(input.horizonT) || input.horizonT <= 0) {
    throw new Error("Monte Carlo 'horizonT' must be a positive finite number");
  }
  if (input.seed != null && (!isFiniteNumber(input.seed) || !Number.isInteger(input.seed))) {
    throw new Error("Monte Carlo 'seed' must be an integer when provided");
  }
  if (typeof input.paramDistributions !== "object" || input.paramDistributions === null) {
    throw new Error("Monte Carlo 'paramDistributions' is required");
  }
  const d = input.paramDistributions as Partial<MonteCarloInput["paramDistributions"]>;
  validateDistribution("ke", d.ke);
  validateDistribution("kw", d.kw);
  validateDistribution("g", d.g);
}

// ─── Segment Uncertainty Derivation ──────────────────────────────────────────

/**
 * Derive per-segment EBIT share uncertainty from historical SegmentData.
 *
 * For each segment, computes the mean and standard deviation of its share
 * of total segment EBIT across all available years. Segments with null
 * EBIT in a year are excluded from that year's calculation.
 *
 * @param segmentData  Parsed SegmentData (business segments only)
 * @returns Array of SegmentUncertainty, one per segment with sufficient data
 */
export function deriveSegmentUncertainties(segmentData: SegmentData): SegmentUncertainty[] {
  const { segments, years, data } = segmentData;

  if (!segments.length || !years.length) return [];

  // For each year, compute total EBIT and each segment's share
  const sharesBySegment: Record<string, number[]> = {};
  for (const seg of segments) {
    sharesBySegment[seg] = [];
  }

  for (const yr of years) {
    // Collect EBIT values for this year
    const ebitValues: Record<string, number> = {};
    let totalEBIT = 0;
    let yearHadLossPeriod = false;

    for (const seg of segments) {
      const periodData = data[seg]?.[yr];
      const result = periodData?.result;
      if (result !== null && result !== undefined && Number.isFinite(result)) {
        if (result > 0) {
          ebitValues[seg] = result;
          totalEBIT += result;
        } else {
          // Loss-period observation — track that we saw it but exclude from
          // share calculation (a negative share would not be a probability).
          // For genuinely-cyclic segments (e.g., Hotels in FY21/22) this means
          // historical drawdown volatility is *not* captured in the std (W3).
          // Future enhancement: track loss-period flags separately and pass
          // through to MC as a "tail risk" factor.
          yearHadLossPeriod = true;
        }
      }
    }
    void yearHadLossPeriod;

    if (totalEBIT <= 0) continue; // skip years with no positive EBIT

    for (const seg of segments) {
      if (ebitValues[seg] !== undefined) {
        sharesBySegment[seg]!.push(ebitValues[seg]! / totalEBIT);
      }
    }
  }

  // Compute mean and std for each segment.
  // Sample variance (Bessel's correction) — divide by (n-1), not n. With
  // typical N = 3-5 yearly observations, population variance under-disperses
  // the simulator's draws by ~25-40% (review W2).
  const result: SegmentUncertainty[] = [];
  let droppedSegments = 0;

  for (const seg of segments) {
    const shares = sharesBySegment[seg]!;
    if (shares.length < 2) {
      droppedSegments++;
      continue;
    }

    const mean = shares.reduce((s, v) => s + v, 0) / shares.length;
    const variance = shares.length > 1
      ? shares.reduce((s, v) => s + (v - mean) ** 2, 0) / (shares.length - 1)
      : 0;
    const std = Math.sqrt(variance);

    result.push({
      name: seg,
      meanShare: { mean, std },
    });
  }

  // The dropped-segment count is intentionally not surfaced here (caller
  // pattern is short-circuit: skip MC for segments without uncertainty).
  // If Monte Carlo coverage diagnostics become important, expose it via
  // a return-shape extension. Kept silent for now to preserve the existing
  // call signature.
  void droppedSegments;

  return result;
}

