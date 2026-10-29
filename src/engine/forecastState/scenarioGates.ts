import type { IndustrialForecastResult, ScenarioOrderingReport } from "./contracts";
import { validateIndustrialScenarioOrdering } from "./ordering";

export interface ScenarioForecastGateOutcome {
  readonly scenarioOrdering: ScenarioOrderingReport | null;
  readonly blocked: {
    readonly code: "FORECAST_STATE_VALIDATION_BLOCKED" | "FORECAST_SCENARIO_ORDERING_BLOCKED";
    readonly message: string;
  } | null;
}

/**
 * The forecast gates a run applies to its cases: every case must validate as a
 * balanced statement set, and then the computed cases must keep stress ≤ base ≤
 * bull. One rule for the app's run and the audit harness.
 */
export function evaluateScenarioForecastGates(forecastResults: readonly IndustrialForecastResult[]): ScenarioForecastGateOutcome {
  const blockedForecasts = forecastResults.filter((forecast) => forecast.status === "blocked");
  if (blockedForecasts.length > 0) {
    const message = blockedForecasts.map((forecast) =>
      forecast.status === "blocked" ? `${forecast.caseId}: ${forecast.reasonCodes.join(", ")}` : "").join("; ");
    return { scenarioOrdering: null, blocked: { code: "FORECAST_STATE_VALIDATION_BLOCKED", message } };
  }
  const scenarioOrdering = validateIndustrialScenarioOrdering(
    forecastResults.flatMap((forecast) => forecast.status === "computed" ? [forecast.forecastCase] : []),
  );
  return {
    scenarioOrdering,
    blocked: scenarioOrdering.status === "failed" ? { code: "FORECAST_SCENARIO_ORDERING_BLOCKED", message: scenarioOrdering.summary } : null,
  };
}
