/* ================================================================
   Penman–Nissim Engine — Canonical Type Definitions (V2-FINAL)
   Nissim & Penman (2001) — Full V2 Design Specification
   Jurisdiction: Indian companies reporting under Ind AS

   Barrel re-export. The original 1054-line monolith was split into
   the following 8 domain modules (Plan 1 PR-1.1):

     raw          ingestion / parser inputs
     recast       canonical BS, IS, CF, ratios, RecastPeriod
     quality      severity, contamination, quality metrics
     unusual      unusual-item buckets and policy summary
     forecast     business-model profile, scenarios, forecast period
     valuation    RE/ReOI/FCF/AEG outputs, V3 extension, NP benchmarks
     company      CompanyType, MultiCompanyRecord, CompanyRegistry
     config       EngineConfig + DEFAULTS + ke/kw derivation + validation
     traceability re-export of AnalysisTraceabilityEnvelope

   External imports of `from "./types"` continue to work unchanged.
================================================================ */

export type {
  RawPeriodData,
  TraceStatement,
  TraceEntry,
  TraceMap,
} from "./raw";

export type {
  CanonicalBalanceSheet,
  CanonicalIncome,
  CoreUnusual,
  OperatingCostBridge,
  CashFlowData,
  Ratios,
  ResidualIncome,
  RecastPeriod,
  RecastDebug,
  ShareCountInputSnapshot,
} from "./recast";

export {
  Severity,
} from "./quality";

export type {
  SpecFlag,
  ContaminationTier,
  ContaminationResult,
  QualityMetrics,
} from "./quality";

export type {
  UnusualBucketType,
  UnusualItemBucket,
  UnusualItemPolicySummary,
} from "./unusual";

export type {
  BusinessModelProfile,
  PersistenceScenarioTemplate,
  DriverForecastPlan,
  ForecastPeriod,
  TerminalEconomicsOutput,
  ForecastScenarioKey,
  ForecastScenarioWeighting,
  ForecastProbabilityState,
  ForecastScenarioCardSurface,
  ScenarioWeightingSurface,
  ScenarioSpreadPosture,
  ForecastPolicySurface,
  ForecastScenario,
} from "./forecast";

export type {
  GrowthAccounting,
  ContinuingValueGuard,
  ContinuingValueGuardModel,
  ValuationResult,
  PerShareResult,
  FCFValuation,
  AEGValuation,
  V3ValuationExtension,
} from "./valuation";

export {
  NP_BENCHMARKS,
  FADE_PARAMS,
} from "./valuation";

export type {
  CompanyType,
  MultiCompanyRecord,
  CompanyRegistry,
} from "./company";

export type {
  ValuationSectorTemplate,
  StructuralBreakWindowPolicy,
  GreenfieldAdjustmentMode,
  CostOfEquityMode,
  CostOfDebtMode,
  EngineConfig,
  ConfigValidationWarning,
  KwSource,
} from "./config";

export {
  DEFAULT_CONFIG,
  SECTOR_BETAS,
  SECTOR_EQUITY_WEIGHTS,
  kd_aftertax,
  ke_from_config,
  deriveKwFromConfig,
  resolveKw,
  validateEngineConfig,
} from "./config";

export type { AnalysisTraceabilityEnvelope } from "./traceability";

export type {
  AnalyticalDepthSummary,
  AnalyticalDepthStatus,
  AnalyticalDepthCheck,
  AnalyticalDepthCheckKey,
  AnalyticalDepthCheckStatus,
} from "./analyticalDepth";

export type {
  AssumptionProvenanceSummary,
  AssumptionProvenanceStatus,
  AssumptionProvenanceCheck,
  AssumptionProvenanceTier,
} from "./assumptionProvenance";

export type {
  EarningsQualitySummary,
  EarningsQualityStatus,
  EarningsQualityCheck,
  EarningsQualityDimension,
} from "./earningsQualitySummary";
