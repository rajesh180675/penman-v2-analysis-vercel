import type { AnalysisTraceabilityEnvelope } from "./analysisTraceability";
import type { RecastPeriod } from "./types";
import type { ScopeAssessment, AnalysisFamily as ScopeAnalysisFamily } from "./scopePolicy";
import type { BankValuationBundle } from "./bankValuation";
import type { BankPeriodMetrics } from "./bankPipeline";

export type AnalysisFamily = ScopeAnalysisFamily;
export type FinancialInstitutionSubtype = "bank" | "nbfc" | "insurance" | "generic-financial";

export interface IndustrialAnalysisResult {
  family: "industrial";
  periods: RecastPeriod[];
  traceability: AnalysisTraceabilityEnvelope | null;
}

export interface FinancialInstitutionPeriodSnapshot {
  period_end: string;
  bookValue: number | null;
  earnings: number | null;
  deposits: number | null;
  /** Phase I — surfaced for NBFC subtype where borrowings are the primary funding source. */
  borrowings: number | null;
  advances: number | null;
  premiumEarned: number | null;
  claimsExpense: number | null;
}

export interface FinancialInstitutionAnalysisResult {
  family: "financial-institution";
  subtype: FinancialInstitutionSubtype;
  periods: FinancialInstitutionPeriodSnapshot[];
  traceability: AnalysisTraceabilityEnvelope | null;
  /** Phase B4 — bank/NBFC valuation models. null for insurance/generic until those pipelines exist. */
  valuation: BankValuationBundle | null;
  /** Phase K — full bank/NBFC metrics with derived ratios (NIM, ROA, ROE,
   *  spread, leverage, debt mix). Optional for back-compat with consumers
   *  that only need the per-period snapshot. */
  bankMetrics?: BankPeriodMetrics[];
}

export type AnalysisResult = IndustrialAnalysisResult | FinancialInstitutionAnalysisResult;

export function resolveAnalysisFamily(scope: ScopeAssessment): AnalysisFamily {
  return scope.analysisFamily;
}

export function isIndustrialAnalysis(result: AnalysisResult): result is IndustrialAnalysisResult {
  return result.family === "industrial";
}

export function isFinancialInstitutionAnalysis(result: AnalysisResult): result is FinancialInstitutionAnalysisResult {
  return result.family === "financial-institution";
}
