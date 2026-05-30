/**
 * Forecasting Engine — V2
 * §4.3 Pro Forma, Fade Analysis, Scenario Analysis
 * Nissim & Penman (2001) §2.6, Table 3
 */
export { fadeRatio } from "./forecastingEngine/helpers";
export { buildBusinessModelProfile } from "./forecastingEngine/businessModel";
export {
  buildPersistenceForecastScenarioSet,
  derivePersistenceForecastScenario,
  buildForecastPeriod,
  buildScenario,
  buildValuationPeriodsFromForecast,
} from "./forecastingEngine/scenarios";
export {
  applyDriverSensitivityToScenario,
  expectedValue,
  sensitivityAnalysis,
} from "./forecastingEngine/sensitivity";
export type { SensParam, SensResult } from "./forecastingEngine/sensitivity";
