import { QualityGateReport } from "./mappingAudit";
import { ValuationReadiness } from "./valuationPolicy";

export type AnalysisBadgeTone = "emerald" | "amber" | "red";
export type AnalysisBadgeStatus = "production-ready" | "guarded" | "blocked";

export interface AnalysisStatusSummary {
  status: AnalysisBadgeStatus;
  label: string;
  headline: string;
  summary: string;
  reasons: string[];
  tone: AnalysisBadgeTone;
  qualityTier: "Tier 1" | "Tier 2" | "Tier 3" | "Unknown";
  valuationStatus: ValuationReadiness["status"] | "unknown";
  scopeBlocked: boolean;
  valuationBlocked: boolean;
  blockingCount: number;
  diagnosticCount: number;
  optionalCount: number;
}

export function deriveAnalysisStatus(
  qualityGate?: QualityGateReport | null,
  valuationReadiness?: ValuationReadiness | null,
): AnalysisStatusSummary {
  const blockingCount = qualityGate?.coverageSummary.unresolvedBySeverity.critical.length ?? 0;
  const diagnosticCount = qualityGate?.coverageSummary.unresolvedBySeverity.warning.length ?? 0;
  const optionalCount = qualityGate?.coverageSummary.unresolvedBySeverity.info.length ?? 0;
  const scopeBlocked = Boolean(qualityGate?.scopeAssessment.blocked);
  const valuationBlocked = Boolean(qualityGate?.valuationBlocked);
  const qualityTier = qualityGate?.tier ?? "Unknown";

  if (scopeBlocked) {
    return {
      status: "blocked",
      label: "Blocked",
      headline: "Unsupported scope",
      summary: qualityGate?.scopeAssessment.label ?? "Dataset is outside the supported industrial-company scope.",
      reasons: qualityGate?.scopeAssessment.reasons ?? [],
      tone: "red",
      qualityTier,
      valuationStatus: valuationReadiness?.status ?? "unknown",
      scopeBlocked,
      valuationBlocked,
      blockingCount,
      diagnosticCount,
      optionalCount,
    };
  }

  if (valuationBlocked) {
    return {
      status: "blocked",
      label: "Blocked",
      headline: "Valuation blocked",
      summary: qualityGate?.blockingReasons[0] ?? "Resolve valuation-critical mapping gaps before trusting output.",
      reasons: qualityGate?.blockingReasons ?? [],
      tone: "red",
      qualityTier,
      valuationStatus: valuationReadiness?.status ?? "unknown",
      scopeBlocked,
      valuationBlocked,
      blockingCount,
      diagnosticCount,
      optionalCount,
    };
  }

  if (valuationReadiness?.status === "guarded") {
    return {
      status: "guarded",
      label: "Guarded",
      headline: "Guarded terminal anchor",
      summary: valuationReadiness.reasons[0] ?? "Latest period is contaminated, so valuation falls back to a guarded anchor.",
      reasons: valuationReadiness.reasons,
      tone: "amber",
      qualityTier,
      valuationStatus: valuationReadiness.status,
      scopeBlocked,
      valuationBlocked,
      blockingCount,
      diagnosticCount,
      optionalCount,
    };
  }

  if (valuationReadiness?.status === "warning" || diagnosticCount > 0 || qualityTier === "Tier 2") {
    const reasons = [
      ...(valuationReadiness?.reasons ?? []),
      ...(diagnosticCount > 0 ? [`${diagnosticCount} diagnostic mapping gaps remain.`] : []),
    ];
    return {
      status: "guarded",
      label: "Guarded",
      headline: "Review diagnostics before relying on output",
      summary: reasons[0] ?? "Analysis is usable but still has diagnostic-quality caveats.",
      reasons,
      tone: "amber",
      qualityTier,
      valuationStatus: valuationReadiness?.status ?? "unknown",
      scopeBlocked,
      valuationBlocked,
      blockingCount,
      diagnosticCount,
      optionalCount,
    };
  }

  return {
    status: "production-ready",
    label: "Production-ready",
    headline: "Analysis cleared current release checks",
    summary: "No blocking scope or valuation issues were detected for the loaded dataset.",
    reasons: valuationReadiness?.reasons ?? [],
    tone: "emerald",
    qualityTier,
    valuationStatus: valuationReadiness?.status ?? "unknown",
    scopeBlocked,
    valuationBlocked,
    blockingCount,
    diagnosticCount,
    optionalCount,
  };
}
