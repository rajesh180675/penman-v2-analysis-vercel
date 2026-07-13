import type { SourcedAssumptionSet } from "../analysisCase";
import type { IndustrialForecastResult, ScenarioOrderingReport } from "../forecastState";
import type { ValuationCommandCenterOutput } from "../valuationCommandCenter";

export const SCENARIO_GOVERNANCE_SCHEMA_VERSION = "2026-07-scenario-governance-v1" as const;

export interface ScenarioGovernanceReport {
  readonly schemaVersion: typeof SCENARIO_GOVERNANCE_SCHEMA_VERSION;
  readonly status: "confirmed" | "guarded" | "blocked";
  readonly rangeEligible: boolean;
  readonly pointEstimateEligible: boolean;
  readonly scenarioCount: number;
  readonly computedScenarioCount: number;
  readonly calibratedProbabilityCount: number;
  readonly probabilitySum: number | null;
  readonly uncertaintyRange: {
    readonly lowPerShare: number | null;
    readonly basePerShare: number | null;
    readonly highPerShare: number | null;
    readonly method: "ordered-scenario-band";
  };
  readonly assumptionProvenance: {
    readonly referencedCount: number;
    readonly resolvedCount: number;
    readonly intrinsicEligibleCount: number;
    readonly missingAssumptionIds: readonly string[];
    readonly ineligibleAssumptionIds: readonly string[];
    readonly coverageRatio: number;
  };
  readonly blockerCodes: readonly string[];
  readonly warningCodes: readonly string[];
  readonly summary: string;
}

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function buildScenarioGovernanceReport(input: {
  readonly forecastResults: readonly IndustrialForecastResult[];
  readonly scenarioOrdering: ScenarioOrderingReport | null;
  readonly assumptions: SourcedAssumptionSet | null;
  readonly commandCenter: ValuationCommandCenterOutput | null;
}): ScenarioGovernanceReport {
  const computed = input.forecastResults.flatMap((result) => result.status === "computed" ? [result.forecastCase] : []);
  const blockedCount = input.forecastResults.length - computed.length;
  const referencedIds = [...new Set(computed.flatMap((forecast) => forecast.assumptionIds))].sort();
  const resolvedIds = new Set(input.assumptions?.assumptions.map((assumption) => assumption.assumptionId) ?? []);
  const eligibleIds = new Set(input.assumptions?.intrinsicEligibleAssumptionIds ?? []);
  const missingAssumptionIds = referencedIds.filter((id) => !resolvedIds.has(id));
  const ineligibleAssumptionIds = referencedIds.filter((id) => resolvedIds.has(id) && !eligibleIds.has(id));
  const calibrated = computed.filter((forecast) => forecast.probabilityStatus === "calibrated" && forecast.probability != null);
  const probabilitySum = calibrated.length === computed.length && computed.length > 0
    ? calibrated.reduce((sum, forecast) => sum + forecast.probability!, 0)
    : null;
  const values = (input.commandCenter?.scenarios ?? [])
    .map((scenario) => ({ key: scenario.key, value: scenario.intrinsicPerShare }))
    .filter((item): item is { key: typeof item.key; value: number } => finitePositive(item.value));
  const sortedValues = values.map((item) => item.value).sort((left, right) => left - right);
  const baseValue = values.find((item) => item.key === "base")?.value ?? sortedValues[Math.floor((sortedValues.length - 1) / 2)] ?? null;

  const blockerCodes: string[] = [];
  if (!input.forecastResults.length) blockerCodes.push("SCENARIOS_MISSING");
  if (blockedCount > 0) blockerCodes.push("SCENARIO_VALIDATION_FAILED");
  if (input.scenarioOrdering?.status === "failed") blockerCodes.push("SCENARIO_ORDERING_FAILED");
  if (input.assumptions?.status === "blocked" || missingAssumptionIds.length > 0 || ineligibleAssumptionIds.length > 0) blockerCodes.push("ASSUMPTION_PROVENANCE_INELIGIBLE");
  if (values.length < 2) blockerCodes.push("INSUFFICIENT_SCENARIO_VALUES");
  if (input.commandCenter?.evidenceWeightedSynthesis.defensibility.status === "blocked") blockerCodes.push("SYNTHESIS_DEFENSIBILITY_BLOCKED");

  const rangeEligible = blockerCodes.length === 0;
  const warningCodes: string[] = [];
  if (calibrated.length !== computed.length) warningCodes.push("PROBABILITIES_NOT_CALIBRATED");
  if (probabilitySum != null && Math.abs(probabilitySum - 1) > 1e-6) warningCodes.push("PROBABILITIES_DO_NOT_SUM_TO_ONE");
  if (input.commandCenter?.evidenceWeightedSynthesis.defensibility.status === "guarded") warningCodes.push("SYNTHESIS_DEFENSIBILITY_GUARDED");
  const pointEstimateEligible = rangeEligible
    && calibrated.length === computed.length
    && computed.length > 0
    && probabilitySum != null
    && Math.abs(probabilitySum - 1) <= 1e-6
    && input.commandCenter?.evidenceWeightedSynthesis.defensibility.status === "confirmed";
  const status = !rangeEligible ? "blocked" : pointEstimateEligible ? "confirmed" : "guarded";
  const coverageRatio = referencedIds.length > 0
    ? (referencedIds.length - missingAssumptionIds.length - ineligibleAssumptionIds.length) / referencedIds.length
    : 0;

  return {
    schemaVersion: SCENARIO_GOVERNANCE_SCHEMA_VERSION,
    status,
    rangeEligible,
    pointEstimateEligible,
    scenarioCount: input.forecastResults.length,
    computedScenarioCount: computed.length,
    calibratedProbabilityCount: calibrated.length,
    probabilitySum,
    uncertaintyRange: {
      lowPerShare: sortedValues[0] ?? null,
      basePerShare: baseValue,
      highPerShare: sortedValues.at(-1) ?? null,
      method: "ordered-scenario-band",
    },
    assumptionProvenance: {
      referencedCount: referencedIds.length,
      resolvedCount: referencedIds.filter((id) => resolvedIds.has(id)).length,
      intrinsicEligibleCount: referencedIds.filter((id) => eligibleIds.has(id)).length,
      missingAssumptionIds,
      ineligibleAssumptionIds,
      coverageRatio,
    },
    blockerCodes,
    warningCodes,
    summary: status === "confirmed"
      ? "Scenario range and probability-weighted point estimate are eligible: probabilities are calibrated and assumptions are fully evidenced."
      : status === "guarded"
        ? "Scenario range is eligible, but a probability-weighted point estimate is withheld until scenario probabilities are calibrated."
        : `Scenario output is diagnostic-only because ${blockerCodes.join(", ")}.`,
  };
}
