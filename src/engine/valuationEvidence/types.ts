import type { ValuationScenarioCard } from "../valuationCommandCenter";

export type ValuationAssumptionKey =
  | "revenue_growth"
  | "core_margin"
  | "asset_turnover"
  | "rnoa"
  | "reinvestment_rate"
  | "capex_intensity"
  | "working_capital_drag"
  | "fade_rate"
  | "terminal_growth"
  | "ke"
  | "kw"
  | "model_weight"
  | "store_count_growth"
  | "revenue_per_store"
  | "same_store_sales_growth"
  | "capex_per_store"
  | "lease_burden_per_store";

export type EvidenceSourceType =
  | "reported-history"
  | "clean-window-history"
  | "forecast-holdout"
  | "peer-percentile"
  | "sector-prior"
  | "macro-source"
  | "management-guidance"
  | "operational-driver-sidecar"
  | "user-override"
  | "price-derived"
  | "source-unavailable";

export type EvidenceIndependenceGroup =
  | "accrual-history"
  | "cash-statement"
  | "market-price"
  | "peer-market"
  | "sector-static"
  | "operational-driver"
  | "user-input";

export interface DefensibleRange {
  low: number | null;
  high: number | null;
  basis: string;
}

export interface ValuationAssumptionEvidence {
  key: ValuationAssumptionKey;
  label: string;
  value: number | null;
  unit: "fraction" | "inr-crore" | "inr-per-share" | "years" | "ratio" | "count";
  scenarioKey?: ValuationScenarioCard["key"] | undefined;
  sourceType: EvidenceSourceType;
  sourceLabel: string;
  sourceRef?: string | null | undefined;
  sourcePeriodWindow?: { from: string; to: string; periods: number } | null | undefined;
  independenceGroup: EvidenceIndependenceGroup;
  priceDerived: boolean;
  eligibleForIntrinsicConfidence: boolean;
  confidence: "high" | "medium" | "low" | "unavailable";
  defensibleRange: DefensibleRange;
  warnings: string[];
}

export interface ValuationEvidenceLedger {
  schemaVersion: "2026-06-valuation-evidence-v1";
  periodEnd: string | null;
  companyId?: string | null | undefined;
  rows: ValuationAssumptionEvidence[];
  summary: {
    total: number;
    unsupportedCount: number;
    priceDerivedCount: number;
    confidenceEligibleCount: number;
    highConfidenceCount: number;
    sourceUnavailableCount: number;
  };
}

export type ForecastHoldoutMetric =
  | "sales"
  | "core_margin"
  | "rnoa"
  | "cfo"
  | "capex"
  | "fcf_cash"
  | "cse"
  | "noa";

export interface ForecastHoldoutMetricError {
  metric: ForecastHoldoutMetric;
  actual: number | null;
  predicted: number | null;
  absoluteError: number | null;
  percentageError: number | null;
  benchmarkPredicted?: number | null | undefined;
  benchmarkPercentageError?: number | null | undefined;
  status: "confirmed" | "degraded" | "failed" | "unavailable";
}

export interface ForecastHoldoutFold {
  trainWindow: { from: string; to: string; periods: number };
  testPeriod: string;
  metrics: ForecastHoldoutMetricError[];
}

export interface ForecastHoldoutSummary {
  available: boolean;
  reason?: string | undefined;
  folds: ForecastHoldoutFold[];
  aggregate: {
    metricMape: Partial<Record<ForecastHoldoutMetric, number>>;
    weightedMape: number | null;
    status: "confirmed" | "degraded" | "failed" | "unavailable";
    confidencePenaltyPct: number;
    valuationRangeWideningPct: number;
    /** Rolling-origin calibration disclosure. Optional on migrated payloads. */
    calibrationStatus?: "calibrated" | "degraded" | "failed" | "unavailable" | undefined;
    sampleSize?: number | undefined;
    minimumTrainPeriods?: number | undefined;
    benchmark?: {
      readonly name: "last-observation-carried-forward";
      readonly weightedMape: number | null;
      readonly skillVsBenchmark: number | null;
    } | undefined;
    noLookAhead?: {
      readonly status: "confirmed";
      readonly policy: "strict-prior-period-training";
    } | undefined;
  };
}

export type MarketImpliedExpectationKey =
  | "implied_growth"
  | "implied_rnoa"
  | "implied_fade"
  | "implied_cap"
  | "implied_terminal_roic"
  | "implied_ke";

export interface MarketImpliedExpectationRow {
  key: MarketImpliedExpectationKey;
  value: number | null;
  cap?: number | null | undefined;
  saturated: boolean;
  comparisonAnchor: number | null;
  gap: number | null;
  priceDerived: true;
  interpretation: "reasonable" | "optimistic" | "priced_for_perfection" | "model_saturated" | "unavailable";
}

export interface MarketImpliedExpectationLedger {
  marketPrice: number | null;
  asOf: string | null;
  rows: MarketImpliedExpectationRow[];
  intrinsicConfidenceEffect: "none";
  warning: string;
}

export interface DefensibilityChecklistItem {
  key:
    | "assumption-evidence"
    | "forecast-holdout-skill"
    | "price-derived-isolation"
    | "paradigm-independence"
    | "range-widening";
  label: string;
  passed: boolean;
  detail: string;
}

export interface EvidenceWeightedModelContribution {
  modelKey: string;
  label: string;
  independenceGroup: EvidenceIndependenceGroup;
  perShare: number | null;
  baseReliability: number;
  evidenceCoveragePenalty: number;
  forecastSkillPenalty: number;
  priceDerivedPenalty: number;
  finalWeight: number;
  includedInIntrinsicRange: boolean;
  reason: string;
  /** Present only after a governed adjustment replaced this exact base vote. */
  substitution?: EvidenceSynthesisSubstitutionTrace | undefined;
}

export interface EvidenceSynthesisSubstitutionTrace {
  readonly policyVersion: "2026-07-evidence-synthesis-substitution-v1";
  readonly dossierHash: `sha256:${string}`;
  readonly baseModelId: string;
  readonly baseCaseId: string | null;
  readonly basePerShare: number;
  readonly optionalityPerShare: number;
  readonly composedPerShare: number;
  readonly evidenceRefs: readonly string[];
  readonly transformationRefs: readonly string[];
}

export interface EvidenceSynthesisCompositionDiagnostics {
  readonly policyVersion: "2026-07-evidence-synthesis-substitution-v1";
  readonly appliedCount: number;
  readonly dossierHashes: readonly `sha256:${string}`[];
  readonly targetModelKeys: readonly string[];
  readonly totalOptionalityPerShare: number;
  readonly countingPolicy: "replace-exact-base-vote-once";
}

/**
 * One vote after algebraically or evidentially correlated model outputs have
 * been collapsed. The group weight is deliberately bounded by its strongest
 * member; adding another formula in the same group cannot add another vote.
 */
export interface CollapsedEvidenceFamilyContribution {
  independenceGroup: EvidenceIndependenceGroup;
  modelKeys: string[];
  labels: string[];
  perShare: number;
  groupWeight: number;
  memberContributionCount: number;
}

export interface EvidenceSynthesisIndependenceDiagnostics {
  policyVersion: "2026-07-independence-synthesis-v1";
  eligibleContributionCount: number;
  independentGroupCount: number;
  correlatedContributionCount: number;
  weightingPolicy: "maximum-member-reliability";
  familyValuePolicy: "reliability-weighted-median";
  rangePolicy: "weighted-p20-p80";
  groups: CollapsedEvidenceFamilyContribution[];
  rawLowPerShare: number | null;
  rawHighPerShare: number | null;
  robustLowPerShare: number | null;
  robustHighPerShare: number | null;
  maximumGroupSpreadRatio: number | null;
  criticalDivergence: boolean;
}

export interface EvidenceWeightedValuationSynthesis {
  contributions: EvidenceWeightedModelContribution[];
  /** Optional for persisted pre-substitution syntheses. */
  compositionDiagnostics?: EvidenceSynthesisCompositionDiagnostics | undefined;
  /**
   * Optional only for backwards compatibility with persisted v1 command-center
   * fixtures. Newly computed syntheses always emit these diagnostics.
   */
  independenceDiagnostics?: EvidenceSynthesisIndependenceDiagnostics | undefined;
  intrinsicRange: {
    lowPerShare: number | null;
    midPerShare: number | null;
    highPerShare: number | null;
    rangeWideningPct: number;
  };
  marketExpectationRange: {
    pricePerShare: number | null;
    requiredGrowth: number | null;
    requiredRnoa: number | null;
    saturated: boolean;
  };
  defensibility: {
    status: "confirmed" | "guarded" | "blocked";
    checklist: DefensibilityChecklistItem[];
    summary: string;
  };
}

export interface AntiTautologySummary {
  evidenceLedgerRef: {
    hasLedger: boolean;
    assumptionCount: number;
    unsupportedCount: number;
    priceDerivedCount: number;
    checksum: string | null;
  };
  forecastHoldout: {
    available: boolean;
    status: ForecastHoldoutSummary["aggregate"]["status"];
    weightedMape: number | null;
    valuationRangeWideningPct: number;
    calibrationStatus?: ForecastHoldoutSummary["aggregate"]["calibrationStatus"] | undefined;
    sampleSize?: number | undefined;
    benchmarkSkill?: number | null | undefined;
    noLookAheadStatus?: "confirmed" | undefined;
  };
  priceDerivedIsolation: {
    reverseDcfExcludedFromIntrinsicConfidence: boolean;
    priceDerivedAssumptionsUsedForIntrinsic: number;
  };
  paradigmIndependence: {
    independentLensCount: number;
    criticalDivergence: boolean;
  };
  sectorDriverCoverage: {
    status: "confirmed" | "partial" | "unavailable";
    driverCount: number;
    sourceUnavailableCount: number;
  };
}
