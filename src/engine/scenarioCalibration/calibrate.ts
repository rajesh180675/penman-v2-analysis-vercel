import type { IndustrialForecastResult } from "../forecastState";
import type {
  CalibratedScenarioKey,
  ScenarioCalibrationObservation,
  ScenarioCalibrationPolicy,
  ScenarioCalibrationReport,
  ScenarioProbabilityVector,
} from "./contracts";
import { SCENARIO_CALIBRATION_SCHEMA_VERSION } from "./contracts";

const KEYS: readonly CalibratedScenarioKey[] = ["stress", "base", "bull"];

function vectorValid(vector: ScenarioProbabilityVector): boolean {
  const values = KEYS.map((key) => vector[key]);
  return values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 1e-6;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function brier(observation: ScenarioCalibrationObservation, vector: ScenarioProbabilityVector): number {
  return KEYS.reduce((sum, key) => sum + (vector[key] - (observation.realizedScenario === key ? 1 : 0)) ** 2, 0) / KEYS.length;
}

function wilson(successes: number, total: number): { low: number; high: number } {
  if (total <= 0) return { low: 0, high: 1 };
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function calibrateScenarioProbabilities(input: {
  readonly observations: readonly ScenarioCalibrationObservation[];
  readonly policy: ScenarioCalibrationPolicy;
}): ScenarioCalibrationReport {
  const dimensionMatched = input.observations
    .filter((observation) => observation.family === input.policy.family)
    .filter((observation) => observation.regime === input.policy.regime)
    .filter((observation) => observation.horizonYears === input.policy.horizonYears);
  const calibrationTime = Date.parse(input.policy.calibrationAsOf);
  const duplicateObservationIds = input.observations.length - new Set(input.observations.map((observation) => observation.observationId)).size;
  const policyValid = validDate(input.policy.calibrationAsOf)
    && Number.isInteger(input.policy.horizonYears) && input.policy.horizonYears > 0
    && Number.isInteger(input.policy.minimumSampleSize) && input.policy.minimumSampleSize > 0
    && Number.isFinite(input.policy.minimumSkillVsBenchmark)
    && Number.isFinite(input.policy.dirichletPriorPerScenario) && input.policy.dirichletPriorPerScenario >= 0;
  const usableCandidates = policyValid ? dimensionMatched.filter((observation) =>
    validDate(observation.availableAt)
    && validDate(observation.realizedAt)
    && validDate(observation.forecastAsOf)
    && Date.parse(observation.availableAt) <= calibrationTime
    && Date.parse(observation.realizedAt) <= calibrationTime
    && Date.parse(observation.forecastAsOf) < Date.parse(observation.realizedAt)
    && KEYS.includes(observation.realizedScenario)
    && vectorValid(observation.forecastProbabilities)
    && vectorValid(observation.benchmarkProbabilities)
    && observation.sourceRefs.length > 0 && observation.sourceRefs.every((ref) => ref.trim().length > 0)) : [];
  const usable = [...new Map(usableCandidates.map((observation) => [observation.observationId, observation])).values()];
  const excludedLookAheadCount = dimensionMatched.filter((observation) => {
    if (![observation.availableAt, observation.realizedAt, observation.forecastAsOf].every(validDate)) return false;
    return Date.parse(observation.availableAt) > calibrationTime
      || Date.parse(observation.realizedAt) > calibrationTime
      || Date.parse(observation.forecastAsOf) >= Date.parse(observation.realizedAt);
  }).length;
  const excludedInvalidCount = Math.max(0, dimensionMatched.length - usable.length - excludedLookAheadCount);
  const counts = Object.fromEntries(KEYS.map((key) => [key, usable.filter((item) => item.realizedScenario === key).length])) as Record<CalibratedScenarioKey, number>;
  const prior = Math.max(0, input.policy.dirichletPriorPerScenario);
  const denominator = usable.length + prior * KEYS.length;
  const probabilities = denominator > 0 ? Object.freeze({
    stress: (counts.stress + prior) / denominator,
    base: (counts.base + prior) / denominator,
    bull: (counts.bull + prior) / denominator,
  }) : null;
  const modelBrierScore = usable.length ? usable.reduce((sum, item) => sum + brier(item, item.forecastProbabilities), 0) / usable.length : null;
  const benchmarkBrierScore = usable.length ? usable.reduce((sum, item) => sum + brier(item, item.benchmarkProbabilities), 0) / usable.length : null;
  const skillVsBenchmark = modelBrierScore != null && benchmarkBrierScore != null && benchmarkBrierScore > 0
    ? 1 - modelBrierScore / benchmarkBrierScore
    : null;
  const reasonCodes: string[] = [];
  if (duplicateObservationIds > 0) reasonCodes.push("DUPLICATE_OBSERVATION_ID");
  if (!policyValid) reasonCodes.push("CALIBRATION_POLICY_INVALID");
  if (usable.length < input.policy.minimumSampleSize) reasonCodes.push("MINIMUM_SAMPLE_NOT_MET");
  if (skillVsBenchmark == null) reasonCodes.push("BENCHMARK_SKILL_UNAVAILABLE");
  else if (skillVsBenchmark < input.policy.minimumSkillVsBenchmark) reasonCodes.push("BENCHMARK_SKILL_NOT_MET");
  const status = usable.length === 0 ? "unavailable" : reasonCodes.length ? "degraded" : "calibrated";
  return Object.freeze({
    schemaVersion: SCENARIO_CALIBRATION_SCHEMA_VERSION,
    status,
    family: input.policy.family,
    regime: input.policy.regime,
    horizonYears: input.policy.horizonYears,
    calibrationAsOf: input.policy.calibrationAsOf,
    sampleSize: usable.length,
    excludedLookAheadCount,
    excludedInvalidCount,
    probabilities: status === "calibrated" ? probabilities : null,
    confidenceIntervals95: status === "calibrated" ? Object.freeze({
      stress: wilson(counts.stress + prior, denominator),
      base: wilson(counts.base + prior, denominator),
      bull: wilson(counts.bull + prior, denominator),
    }) : null,
    modelBrierScore,
    benchmarkBrierScore,
    skillVsBenchmark,
    evidenceRefs: Object.freeze([...new Set(usable.flatMap((item) => item.sourceRefs))].sort()),
    reasonCodes: Object.freeze(reasonCodes),
    noLookAhead: Object.freeze({ status: "confirmed", policy: "available-at-or-before-calibration-as-of" }),
  });
}

export function applyScenarioCalibration(
  results: readonly IndustrialForecastResult[],
  report: ScenarioCalibrationReport,
): IndustrialForecastResult[] {
  if (report.status !== "calibrated" || !report.probabilities) return [...results];
  const probabilities = report.probabilities;
  return results.map((result) => {
    if (result.status !== "computed") return result;
    const key = result.forecastCase.scenarioKey;
    if (key !== "stress" && key !== "base" && key !== "bull") return result;
    return {
      ...result,
      forecastCase: {
        ...result.forecastCase,
        probability: probabilities[key],
        probabilityStatus: "calibrated",
        probabilityEvidenceRefs: report.evidenceRefs,
        probabilityRationale: `${report.sampleSize} strict point-in-time observations; skill vs benchmark ${report.skillVsBenchmark?.toFixed(3)}.`,
      },
    };
  });
}
