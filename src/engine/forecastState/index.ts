export { buildIndustrialForecast } from "./engine";
export { validateIndustrialScenarioOrdering } from "./ordering";
export { adaptForecastCaseToLegacyValuation, legacyValuationAnchor } from "./legacyAdapter";
export { CASE_VALUATION_TOLERANCE, compareCaseValuations, type CaseValuationDivergence, type CaseValuationSource } from "./caseValuationParity";
export {
  LEGACY_FORECAST_STATE_BRIDGE_VERSION,
  buildIndustrialForecastFromLegacyScenario,
} from "./legacyScenarioBridge";

export type {
  LegacyValuationAnchorInput,
  LegacyValuationPeriodInput,
} from "./legacyAdapter";

export {
  buildForecastValidationReport,
  mergeForecastValidationReports,
  validateIndustrialForecastRequest,
  validateIndustrialProjectedStates,
} from "./validation";

export { FORECAST_STATE_SCHEMA_VERSION } from "./contracts";

export type {
  ForecastProbabilityStatus,
  ForecastValidationCheck,
  ForecastValidationReport,
  ForecastValidationStatus,
  IndustrialForecastAnchor,
  IndustrialForecastCase,
  IndustrialForecastDiagnostics,
  IndustrialForecastRequest,
  IndustrialForecastResult,
  IndustrialForecastYearDrivers,
  IndustrialProjectedBalanceSheet,
  IndustrialProjectedCashFlowStatement,
  IndustrialProjectedIncomeStatement,
  IndustrialProjectedState,
  IndustrialScenarioKey,
  IndustrialTerminalAssumptions,
  ScenarioOrderingReport,
  TerminalEconomicsDiagnostic,
} from "./contracts";
export { buildScenarioForecastResults, evaluateScenarioForecastGates, type ScenarioForecastGateOutcome } from "./scenarioGates";
export {
  FORECAST_HORIZON_YEARS,
  FORECAST_SCENARIO_KEYS,
  buildPlannedForecastCases,
  forecastGenerationInput,
  generateIndustrialForecastCases,
  planForecastScenario,
  planForecastScenarios,
  planRunForecastScenarios,
  type ForecastCaseLabels,
  type ForecastGenerationInput,
  type ForecastScenarioKey,
  type GeneratedForecastCase,
  type PlannedForecastScenario,
} from "./generation";
