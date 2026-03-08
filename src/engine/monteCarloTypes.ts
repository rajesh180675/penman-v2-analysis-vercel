import type { EngineConfig, RecastPeriod } from "./types";

export interface MonteCarloDist {
  mean: number;
  std: number;
}

export interface MonteCarloRequest {
  basePeriods: RecastPeriod[];
  config: EngineConfig;
  N?: number;
  horizonT?: number;
  seed?: number;
  paramDistributions: {
    ke: MonteCarloDist;
    kw: MonteCarloDist;
    g: MonteCarloDist;
  };
}

export interface MonteCarloInput {
  basePeriods: RecastPeriod[];
  config: EngineConfig;
  N: number;
  horizonT: number;
  seed?: number;
  paramDistributions: {
    ke: MonteCarloDist;
    kw: MonteCarloDist;
    g: MonteCarloDist;
  };
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
