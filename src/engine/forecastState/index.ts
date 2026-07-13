export { buildIndustrialForecast } from "./engine";
export { validateIndustrialScenarioOrdering } from "./ordering";
export { adaptForecastCaseToLegacyValuation } from "./legacyAdapter";
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
