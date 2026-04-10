import type { AnalysisTraceabilityEnvelope } from "./analysisTraceability";
import type { RecastPeriod } from "./types";
import type { ScopeAssessment, AnalysisFamily as ScopeAnalysisFamily } from "./scopePolicy";

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
  advances: number | null;
  premiumEarned: number | null;
  claimsExpense: number | null;
}

export interface FinancialInstitutionAnalysisResult {
  family: "financial-institution";
  subtype: FinancialInstitutionSubtype;
  periods: FinancialInstitutionPeriodSnapshot[];
  traceability: AnalysisTraceabilityEnvelope | null;
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
