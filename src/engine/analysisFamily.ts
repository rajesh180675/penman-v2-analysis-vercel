import type { AnalysisTraceabilityEnvelope } from "./analysisTraceability";
import type { RecastPeriod } from "./types";
import type { ScopeAssessment, AnalysisFamily as ScopeAnalysisFamily } from "./scopePolicy";
import type { BankValuationBundle } from "./bankValuation";
import type { BankPeriodMetrics } from "./bankPipeline";
import type { BankAssetQualityResult } from "./bankAssetQuality";

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
  bankMetrics?: BankPeriodMetrics[] | undefined;
  /** Phase B5 — derived asset-quality signals (NPA cycle, PCR trend,
   *  slippage trajectory, loan-growth vs system, deposit franchise,
   *  capital buffer). Each signal is independently skip-with-reason.
   *  Always present when subtype is "bank" or "nbfc"; carries skip-reasons
   *  on every signal when no quality_indicators sidecar was provided. */
  assetQuality?: BankAssetQualityResult | undefined;
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
