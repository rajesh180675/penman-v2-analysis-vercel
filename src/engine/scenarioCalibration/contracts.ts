export const SCENARIO_CALIBRATION_SCHEMA_VERSION = "2026-07-scenario-calibration-v1" as const;
export type CalibratedScenarioKey = "stress" | "base" | "bull";

export interface ScenarioProbabilityVector {
  readonly stress: number;
  readonly base: number;
  readonly bull: number;
}

export interface ScenarioCalibrationObservation {
  readonly observationId: string;
  readonly issuerId: string;
  readonly family: string;
  readonly regime: string;
  readonly horizonYears: number;
  readonly forecastAsOf: string;
  readonly realizedAt: string;
  /** Timestamp at which the realized label and its source became knowable. */
  readonly availableAt: string;
  readonly realizedScenario: CalibratedScenarioKey;
  readonly forecastProbabilities: ScenarioProbabilityVector;
  readonly benchmarkProbabilities: ScenarioProbabilityVector;
  readonly sourceRefs: readonly string[];
}

export interface ScenarioCalibrationPolicy {
  readonly family: string;
  readonly regime: string;
  readonly horizonYears: number;
  readonly calibrationAsOf: string;
  readonly minimumSampleSize: number;
  readonly dirichletPriorPerScenario: number;
  readonly minimumSkillVsBenchmark: number;
}

export interface ScenarioCalibrationReport {
  readonly schemaVersion: typeof SCENARIO_CALIBRATION_SCHEMA_VERSION;
  readonly status: "calibrated" | "degraded" | "unavailable";
  readonly family: string;
  readonly regime: string;
  readonly horizonYears: number;
  readonly calibrationAsOf: string;
  readonly sampleSize: number;
  readonly excludedLookAheadCount: number;
  readonly excludedInvalidCount: number;
  readonly probabilities: ScenarioProbabilityVector | null;
  readonly confidenceIntervals95: Readonly<Record<CalibratedScenarioKey, { low: number; high: number }>> | null;
  readonly modelBrierScore: number | null;
  readonly benchmarkBrierScore: number | null;
  readonly skillVsBenchmark: number | null;
  readonly evidenceRefs: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly noLookAhead: { readonly status: "confirmed"; readonly policy: "available-at-or-before-calibration-as-of" };
}
