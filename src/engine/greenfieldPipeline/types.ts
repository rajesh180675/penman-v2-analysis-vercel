import type { CompanyType, EngineConfig, RawPeriodData, RecastPeriod } from "../types";

export type AccountingStandard = "ind-as" | "ifrs" | "gaap" | "revised-sch-vi" | "unknown";
export type SeverityLevel = "INFO" | "WARNING" | "BLOCKING" | "CRITICAL";
export type MoneyINR = number;
export type PercentFraction = number;

export type DetectorId =
  | "D1_STANDARD_ADOPTION"
  | "D2_DIRTY_SURPLUS"
  | "D3_LEASE_ACCOUNTING"
  | "D4_FX_OCI_TRANSLATION"
  | "D5_NEGATIVE_EQUITY_SOLVENCY"
  | "D6_STRUCTURAL_BREAK_DEMERGER"
  | "D7_BUYBACK_CAPITAL_RETURN"
  | "D8_COMPONENT_RECLASSIFICATION"
  | "D9_METRIC_STEP_CHANGE"
  | "D10_EXPANSION_CAPEX_FCF"
  | "D11_FRESHNESS_FREQUENCY"
  | "D12_MARKET_EXPECTATION_SATURATION";

export type AdjusterId = "A1_LEASE_ADJUSTER" | "A2_DIRTY_SURPLUS_ADJUSTER" | "A3_PRE_BREAK_TRUNCATOR" | "A4_BUYBACK_ADJUSTER";

export interface NormalizedFieldLineage {
  field: string;
  source: "recast" | "raw" | "derived" | "default";
  sourceKey: string;
  originalUnit: "INR_CRORE" | "INR_ABSOLUTE" | "ratio" | "days" | "unknown";
  normalizedUnit: "INR_ABSOLUTE" | "ratio" | "days" | "text";
  confidence: "high" | "medium" | "low";
}

export interface NormalizedValues {
  revenue: MoneyINR | null;
  cse: MoneyINR | null;
  totalAssets: MoneyINR | null;
  totalLiabilities: MoneyINR | null;
  cfo: MoneyINR | null;
  capex: MoneyINR | null;
  fcfCash: MoneyINR | null;
  leaseLiabilities: MoneyINR | null;
  rightOfUseAssets: MoneyINR | null;
  financialDebtExLease: MoneyINR | null;
  nfo: MoneyINR | null;
  nfoExLease: MoneyINR | null;
  leaseNeutralEquity: MoneyINR | null;
  dividendsPaid: MoneyINR | null;
  equityIssued: MoneyINR | null;
  buybacks: MoneyINR | null;
  netIncome: MoneyINR | null;
  oci: MoneyINR | null;
}

export interface NormalizedDerived {
  rnoa: PercentFraction | null;
  flev: number | null;
  pm: PercentFraction | null;
  ato: number | null;
  dirtySurplusSeed: MoneyINR | null;
}

export interface NormalizedPeriod {
  companyId: string;
  periodEnd: string;
  periodStart: string | null;
  isPartialPeriod: boolean;
  periodLengthDays: number | null;
  accountingStandard: AccountingStandard;
  standardAdoptions: {
    indAS109: boolean;
    indAS115: boolean;
    indAS116: boolean;
    adoptionDateEvidence: Record<string, string | null>;
  };
  industry: {
    companyType: CompanyType | "auto";
    inferredIndustry: string | null;
    confidence: "explicit" | "inferred" | "unknown";
  };
  values: NormalizedValues;
  derived: NormalizedDerived;
  lineage: NormalizedFieldLineage[];
  asReportedRecast?: RecastPeriod | undefined;
}

export interface SuppressionCandidate {
  detectorId: DetectorId;
  period: string;
  reason: string;
}

export interface AnomalySignal {
  id: string;
  detectorId: DetectorId;
  period: string;
  severity: SeverityLevel;
  p_artifact: number;
  label: string;
  message: string;
  affectedFields: string[];
  evidence: Record<string, number | string | boolean | null>;
  suggestedAdjusters: AdjusterId[];
  suppresses: SuppressionCandidate[];
  blocksValuation: boolean;
  blocksAdjustment: boolean;
}

export interface TriageSuppression {
  signal: AnomalySignal;
  suppressedBy: string;
  reason: string;
}

export interface AnalysisWindow {
  mode: "auto-post-break" | "manual" | "keep-all";
  excludedPeriods: string[];
  includedPeriods: string[];
  reason: string;
  minHistorySatisfied: boolean;
}

export interface TriageResult {
  activeSignals: AnomalySignal[];
  suppressedSignals: TriageSuppression[];
  aggregateSeverity: SeverityLevel | "NONE";
  adjusterOrder: AdjusterId[];
  rationale: string[];
  userPolicy: {
    structuralBreakWindowPolicy: NonNullable<EngineConfig["structural_break_window_policy"]>;
    adjustmentMode: NonNullable<EngineConfig["greenfield_adjustment_mode"]>;
  };
}

export interface AdjustmentAuditEntry {
  adjusterId: AdjusterId;
  field: string;
  period: string;
  before: number | string | boolean | null;
  after: number | string | boolean | null;
  delta: number | null;
  reason: string;
  driven_by: Array<{ detectorId: DetectorId; signalId: string }>;
  validationStatus: "pending" | "accepted" | "rejected";
  rejectedBy: string[];
}

export interface AdjustmentPipelineResult {
  adjusted: NormalizedPeriod[];
  auditTrail: AdjustmentAuditEntry[];
  analysisWindow: AnalysisWindow;
}

export interface AdjustmentDiffRow {
  period: string;
  field: string;
  before: number | string | boolean | null;
  after: number | string | boolean | null;
  delta: number | null;
  adjusterId: AdjusterId;
  validationStatus: "accepted" | "rejected";
  reason: string;
}

export interface AdjustmentValidationReport {
  status: "accepted" | "degraded" | "rejected";
  checks: Array<{ key: string; period: string | null; status: "passed" | "warning" | "failed"; message: string }>;
  diffTable: AdjustmentDiffRow[];
  acceptedCount: number;
  rejectedCount: number;
}

export interface ConfidenceScore {
  level: "low" | "medium" | "high" | "blocked";
  score: number;
  penalties: Array<{ reason: string; points: number; signalId?: string | undefined }>;
  bonuses: Array<{ reason: string; points: number; signalId?: string | undefined }>;
  caps: Array<{ reason: string; cap: number }>;
}

export interface MarketExpectationContext {
  marginOfSafetyPct?: number | null | undefined;
  reverseDcfSaturated?: boolean | undefined;
  price?: number | null | undefined;
  intrinsicValue?: number | null | undefined;
}

export interface GreenfieldRunContext {
  asOf?: Date | string | undefined;
  marketExpectation?: MarketExpectationContext | null | undefined;
}

export interface GreenfieldPipelineInput {
  rawData: RawPeriodData[];
  config: EngineConfig;
  recastData?: RecastPeriod[] | undefined;
  context?: GreenfieldRunContext | undefined;
}

export interface GreenfieldPipelineResult {
  asReported: NormalizedPeriod[];
  adjusted: NormalizedPeriod[];
  signals: AnomalySignal[];
  triage: TriageResult;
  auditTrail: AdjustmentAuditEntry[];
  validation: AdjustmentValidationReport;
  confidence: {
    asReported: ConfidenceScore;
    adjusted: ConfidenceScore;
  };
  analysisWindow: AnalysisWindow;
}
