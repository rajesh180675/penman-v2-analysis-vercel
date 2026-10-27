import { buildBusinessModelProfile } from "../forecastingEngine/businessModel";
import { derivePersistenceForecastScenario } from "../forecastingEngine/scenarios";
import type { BusinessModelProfile, EngineConfig, ForecastScenario, RecastPeriod } from "../types";
import { resolveValuationSectorTemplate, type ValuationSectorTemplateDefinition } from "../valuationSectorTemplates";
import type { IndustrialForecastResult } from "./contracts";
import { buildIndustrialForecastFromLegacyScenario } from "./legacyScenarioBridge";

/** The scenarios a run forecasts, in the order its cases and the command center's cards list them. */
export const FORECAST_SCENARIO_KEYS = ["stress", "base", "bull", "historical-panic"] as const;
export type ForecastScenarioKey = typeof FORECAST_SCENARIO_KEYS[number];

const SCENARIO_LABELS: Record<ForecastScenarioKey, string> = {
  stress: "Stress case",
  base: "Base case",
  bull: "Bull case",
  "historical-panic": "Historical panic",
};

/** What a run's forecast is derived from: its valuation basis and the cost of capital it is valued at. */
export interface ForecastGenerationInput {
  /** The valuation basis, oldest first; the last period is the forecast's anchor. */
  readonly periods: readonly RecastPeriod[];
  readonly config: EngineConfig;
  readonly template: ValuationSectorTemplateDefinition;
  readonly businessModel: BusinessModelProfile;
  readonly costOfCapital: { readonly ke: number; readonly kw: number; readonly riskFreeRate: number };
  readonly horizon: number;
}

/** Labels a recorded case carries; they do not change what is forecast or validated. */
export interface ForecastCaseLabels {
  readonly analysisWindowId: string;
  readonly assumptionIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

/** One scenario's forecast: the scenario derived for it, and the balanced case built from that scenario. */
export interface GeneratedForecastCase {
  readonly key: ForecastScenarioKey;
  readonly label: string;
  /** The scenario the case was built from, terminal growth set to the sector band (or the configured override). */
  readonly scenario: ForecastScenario;
  readonly result: IndustrialForecastResult;
}

/** The years a run's forecast spans before its continuing value. */
export const FORECAST_HORIZON_YEARS = 5;

/**
 * A run's forecast inputs from its valuation basis and cost of capital, as
 * the command center derives them (valuationCommandCenter/core.ts): the
 * sector template and business model read the basis, and the horizon is the
 * command center's.
 */
export function forecastGenerationInput(args: {
  readonly periods: readonly RecastPeriod[];
  readonly config: EngineConfig;
  readonly costOfCapital: ForecastGenerationInput["costOfCapital"];
}): ForecastGenerationInput {
  const periods = [...args.periods];
  return {
    periods,
    config: args.config,
    template: resolveValuationSectorTemplate(periods, args.config.sector_template, args.config.company_type).template,
    businessModel: buildBusinessModelProfile(periods),
    costOfCapital: args.costOfCapital,
    horizon: FORECAST_HORIZON_YEARS,
  };
}

/**
 * The scenario derived for one key, with its terminal growth set as the
 * forecast is valued: the configured override if any, else the derived
 * growth, held to the sector template's band.
 */
export function planForecastScenario(input: ForecastGenerationInput, key: ForecastScenarioKey): ForecastScenario {
  const latest = input.periods[input.periods.length - 1]!;
  const scenario = derivePersistenceForecastScenario({
    scenarioKey: key,
    periods: [...input.periods],
    latest,
    businessModel: input.businessModel,
    horizon: input.horizon,
    template: input.template,
    riskInputs: input.costOfCapital,
  });
  const terminalGrowth = Math.min(
    Math.max(input.config.g_terminal_override ?? scenario.drivers.g_terminal, input.template.terminalGrowthFloor),
    input.template.terminalGrowthCap,
  );
  return { ...scenario, drivers: { ...scenario.drivers, g_terminal: terminalGrowth } };
}

/** Each scenario the run forecasts, derived from the valuation basis (planForecastScenario). */
export interface PlannedForecastScenario {
  readonly key: ForecastScenarioKey;
  readonly label: string;
  readonly scenario: ForecastScenario;
}

/** Every scenario the run forecasts, in card order, derived but not yet built. */
export function planForecastScenarios(input: ForecastGenerationInput): PlannedForecastScenario[] {
  return FORECAST_SCENARIO_KEYS.map((key) => ({ key, label: SCENARIO_LABELS[key], scenario: planForecastScenario(input, key) }));
}

/** The same, from a run's valuation basis and cost of capital (forecastGenerationInput). */
export function planRunForecastScenarios(args: Parameters<typeof forecastGenerationInput>[0]): PlannedForecastScenario[] {
  return planForecastScenarios(forecastGenerationInput(args));
}

/**
 * Each planned scenario built as a balanced statement set by the native
 * engine, anchored at the last period of the valuation basis. The command
 * center values these cases (valuationCommandCenter/builders.ts); it does not
 * derive its own when the run hands it them.
 */
export function buildPlannedForecastCases(args: {
  readonly planned: readonly PlannedForecastScenario[];
  readonly latest: RecastPeriod;
  readonly config: EngineConfig;
  readonly labels: ForecastCaseLabels;
}): GeneratedForecastCase[] {
  return args.planned.map(({ key, label, scenario }) => ({
    key,
    label,
    scenario,
    result: buildIndustrialForecastFromLegacyScenario({
      caseId: key,
      label,
      scenario,
      latest: args.latest,
      config: args.config,
      analysisWindowId: args.labels.analysisWindowId,
      assumptionIds: args.labels.assumptionIds,
      evidenceRefs: args.labels.evidenceRefs,
      // Legacy scenario weights are policy weights, not calibrated empirical
      // likelihoods. Keep the native probability field null until calibration
      // evidence exists instead of relabeling a heuristic as probability.
      probabilityStatus: "not-assigned",
      probabilityRationale: scenario.forecastPolicy?.scenarioWeightRationale?.join(" ")
        || "Legacy scenario weights are not calibrated likelihoods and are intentionally excluded from ForecastState probability.",
    }),
  }));
}

/** The run's forecast in one step: every scenario planned, then built. */
export function generateIndustrialForecastCases(input: ForecastGenerationInput, labels: ForecastCaseLabels): GeneratedForecastCase[] {
  return buildPlannedForecastCases({
    planned: planForecastScenarios(input),
    latest: input.periods[input.periods.length - 1]!,
    config: input.config,
    labels,
  });
}
