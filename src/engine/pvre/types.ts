/**
 * PVRE — Probabilistic Valuation Range Engine (types)
 * Milestone A: additive sidecar. Consumes the existing base-scenario
 * valuation; replaces its point drivers with seeded draws.
 *
 * Design rules:
 * - Pure functions, deterministic under an explicit seed.
 * - Additive: never mutates or re-orders existing engine outputs.
 * - Skip-with-reason instead of throwing for unusable inputs.
 */

export const PVRE_SCHEMA_VERSION = "2026-08-pvre-v1" as const;

/** Allowed distribution families. Mirrors analysisRun SourcedAssumption, plus
 * "empirical" reserved for a later calibration milestone. */
export type DistributionFamily = "point" | "normal" | "lognormal" | "triangular" | "empirical";

export interface DistributionSpec {
  readonly family: DistributionFamily;
  /** family-specific params: normal {mean,sd}, lognormal {meanlog,sdlog},
   * triangular {min,mode,max}, point {value}. */
  readonly parameters: Readonly<Record<string, number>>;
}

/** The drivers we sample. Keep this list deliberately small for Milestone A —
 * each driver must map to a real lever in the base-scenario valuation. */
export interface PvreDriverDraws {
  readonly ke: number;
  readonly kw: number;
  readonly gTerminal: number;
  readonly salesGrowthYear1: number;
  readonly corePmYear1: number;
}

export interface PvreDriverDistributions {
  readonly ke: DistributionSpec;
  readonly kw: DistributionSpec;
  readonly gTerminal: DistributionSpec;
  readonly salesGrowthYear1: DistributionSpec;
  readonly corePmYear1: DistributionSpec;
}

export interface PvreSkip {
  readonly status: "skipped";
  readonly reason: string;
}

/** One sample of assumption draws and the valuation it produced. */
export interface PvreSample {
  readonly index: number;
  readonly draws: PvreDriverDraws;
  readonly intrinsicPerShare: number | null;
  readonly modelValues: Readonly<Record<string, number | null>>;
}

export interface QuantileSummary {
  readonly q05: number;
  readonly q25: number;
  readonly q50: number;
  readonly q75: number;
  readonly q95: number;
  readonly mean: number;
  readonly stdev: number;
  readonly n: number;
}

export interface PvreModelDistribution {
  readonly model: string;
  readonly summary: QuantileSummary | null;
  readonly finiteShare: number; // share of samples where this model computed
}

export interface PvreCrossModelDisagreement {
  /** ratio of 90% CI width (per-model range union) to the synthesized median. */
  readonly dispersionRatio: number | null;
  /** models that computed on >50% of draws */
  readonly contributingModels: readonly string[];
  /** fail-closed: high dispersion blocks promotion unless an independence reason exists */
  readonly gate: "pass" | "guarded" | "blocked";
  readonly reason: string;
}

export interface PvreOutput {
  readonly status: "ok" | "skipped";
  readonly reason?: string;
  readonly seed: number;
  readonly iterations: number;
  /** distribution over the synthesized base intrinsic value */
  readonly intrinsic: QuantileSummary | null;
  readonly perModel: readonly PvreModelDistribution[];
  readonly disagreement: PvreCrossModelDisagreement | null;
  readonly probabilityUndervalued: number | null; // P(intrinsic > market price)
  readonly referencePrice: number | null;
  /** contextual metadata so a reviewer can tell what was sampled */
  readonly meta: {
    readonly sampledKeys: readonly string[];
    readonly constrainedTo: "configured-ranges-and-bands";
    readonly companiesType: string | null;
  };
}

export type PvreResult = PvreOutput | PvreSkip;
