import type { EngineConfig, RecastPeriod } from "../types";
import type { ValuationCommandCenterOutput } from "../valuationCommandCenter";
import type { IndustrialForecastResult, ScenarioOrderingReport } from "./contracts";
import { buildIndustrialForecastFromLegacyScenario } from "./legacyScenarioBridge";
import { validateIndustrialScenarioOrdering } from "./ordering";

/**
 * Every scenario card of a valuation as a balanced ForecastState case. The
 * window, assumption and evidence ids label the cases; they do not change what
 * is validated, so the app's run and the audit harness build the same cases.
 */
export function buildScenarioForecastResults(params: {
  readonly commandCenter: ValuationCommandCenterOutput;
  readonly latest: RecastPeriod;
  readonly config: EngineConfig;
  readonly analysisWindowId: string;
  readonly assumptionIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}): IndustrialForecastResult[] {
  return params.commandCenter.scenarios.map((card) => buildIndustrialForecastFromLegacyScenario({
    caseId: card.key,
    label: card.label,
    scenario: card.scenario,
    latest: params.latest,
    config: params.config,
    analysisWindowId: params.analysisWindowId,
    assumptionIds: params.assumptionIds,
    evidenceRefs: params.evidenceRefs,
    // Legacy scenario weights are policy weights, not calibrated empirical
    // likelihoods. Keep the native probability field null until calibration
    // evidence exists instead of relabeling a heuristic as probability.
    probabilityStatus: "not-assigned",
    probabilityRationale: card.forecastPolicy?.scenarioWeightRationale?.join(" ")
      || "Legacy scenario weights are not calibrated likelihoods and are intentionally excluded from ForecastState probability.",
  }));
}

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
