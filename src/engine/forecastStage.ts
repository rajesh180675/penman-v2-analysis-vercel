/**
 * The forecast stage's gates (migration plan §9.2, stages 10b and 10c), as one
 * native stage function.
 *
 * From the generated forecast cases, and calibration evidence when the run
 * carries it, it returns the cases the models value, the calibration report,
 * the ordering report and the block, if any. Calibration produces a report and
 * new cases; it does not change the cases it is given. Every value is derived
 * from the stage's input alone, so it runs apart from the executor.
 *
 * The order is the run's rule: calibrate, refuse calibration evidence that does
 * not bind to the run (family, horizon, point-in-time cutoff), then require
 * every case to validate and the computed cases to keep stress ≤ base ≤ bull.
 * Evidence that does not bind leaves the cases uncalibrated and the gates still
 * run, so a run can carry both blocks; they are returned in the order raised.
 */
import { evaluateScenarioForecastGates } from "./forecastState";
import type { IndustrialForecastResult, ScenarioOrderingReport } from "./forecastState/contracts";
import {
  applyScenarioCalibration,
  calibrateScenarioProbabilities,
  type ScenarioCalibrationObservation,
  type ScenarioCalibrationPolicy,
  type ScenarioCalibrationReport,
} from "./scenarioCalibration";

export const FORECAST_GATE_STAGE_VERSION = "2026-10-forecast-gates-v1" as const;

export interface ForecastGateInput {
  readonly forecastResults: readonly IndustrialForecastResult[];
  /** Calibration evidence the run carries; absent, the cases keep their probabilities. */
  readonly scenarioCalibration: {
    readonly observations: readonly ScenarioCalibrationObservation[];
    readonly policy: ScenarioCalibrationPolicy;
  } | null;
  /** The run's as-of date: calibration evidence dated after it does not bind. */
  readonly asOf: string;
}

export type ForecastGateBlockCode =
  | "SCENARIO_CALIBRATION_BINDING_MISMATCH"
  | "FORECAST_STATE_VALIDATION_BLOCKED"
  | "FORECAST_SCENARIO_ORDERING_BLOCKED";

export interface ForecastGateOutput {
  readonly stageVersion: typeof FORECAST_GATE_STAGE_VERSION;
  /** The cases the models value: calibrated where the evidence binds, else as given. */
  readonly forecastResults: readonly IndustrialForecastResult[];
  readonly scenarioCalibration: ScenarioCalibrationReport | null;
  /** Null when a case failed to validate. */
  readonly scenarioOrdering: ScenarioOrderingReport | null;
  /** Every block the stage raised, in order; the run stops on the last. */
  readonly blocks: readonly { readonly code: ForecastGateBlockCode; readonly message: string }[];
}

/**
 * A date's time for the point-in-time comparison: a YYYY-MM-DD date at the end
 * of its day, NaN for an impossible one (a NaN compares false, so it never
 * binds); any other timestamp as parsed. The executor's own rule.
 */
function dateOnlyTime(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T23:59:59.999Z`);
    return parsed.toISOString().slice(0, 10) === value ? parsed.getTime() : Number.NaN;
  }
  return Date.parse(value);
}

export function runForecastGates(input: ForecastGateInput): ForecastGateOutput {
  let forecastResults: readonly IndustrialForecastResult[] = input.forecastResults;
  let scenarioCalibration: ScenarioCalibrationReport | null = null;
  const blocks: { code: ForecastGateBlockCode; message: string }[] = [];
  if (input.scenarioCalibration) {
    scenarioCalibration = calibrateScenarioProbabilities({
      observations: input.scenarioCalibration.observations,
      policy: input.scenarioCalibration.policy,
    });
    const computedHorizons = new Set(forecastResults.flatMap((result) => result.status === "computed" ? [result.forecastCase.horizonYears] : []));
    const binds = scenarioCalibration.family === "industrial"
      && computedHorizons.size === 1
      && computedHorizons.has(scenarioCalibration.horizonYears)
      && dateOnlyTime(scenarioCalibration.calibrationAsOf) <= dateOnlyTime(input.asOf);
    if (binds) {
      forecastResults = applyScenarioCalibration(forecastResults, scenarioCalibration);
    } else {
      blocks.push({
        code: "SCENARIO_CALIBRATION_BINDING_MISMATCH",
        message: "Scenario calibration evidence does not match the run family, forecast horizon, or point-in-time cutoff.",
      });
    }
  }
  const gate = evaluateScenarioForecastGates(forecastResults);
  if (gate.blocked) blocks.push(gate.blocked);
  return {
    stageVersion: FORECAST_GATE_STAGE_VERSION,
    forecastResults,
    scenarioCalibration,
    scenarioOrdering: gate.scenarioOrdering,
    blocks,
  };
}
