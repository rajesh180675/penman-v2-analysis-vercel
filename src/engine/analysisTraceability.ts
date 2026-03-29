import { AnalysisPolicyVersions, getAnalysisPolicyVersions } from "./policyVersions";
import { MappingAuditReport, QualityGateReport } from "./mappingAudit";

export interface AnalysisTraceabilityEnvelope {
  schemaVersion: string;
  generatedAt: string | null;
  runContext: {
    runId: string | null;
    companyId: string | null;
    sourceMode: string | null;
    periodCount: number;
    latestPeriod: string | null;
  };
  policyVersions: AnalysisPolicyVersions;
  qualityGate: {
    tier: "Tier 1" | "Tier 2" | "Tier 3" | "Unknown";
    valuationBlocked: boolean;
    blockingReasons: string[];
    scopeClassification: string | null;
    scopeBlocked: boolean;
  };
  mappingCoverage: {
    unresolvedBySeverity: Record<"critical" | "warning" | "info", number>;
    unresolvedByTier: Record<"Tier A" | "Tier B" | "Tier C" | "Tier D", number>;
    outOfSpecLabelCount: number;
    actionableOutOfSpecLabelCount: number;
    backlogByAction: Record<"add-to-spec" | "group-to-existing" | "ignore-non-core" | "review", number>;
  };
}

export function buildAnalysisTraceability(params: {
  generatedAt?: string | null;
  runId?: string | null;
  companyId?: string | null;
  sourceMode?: string | null;
  periodCount?: number;
  latestPeriod?: string | null;
  qualityGate?: QualityGateReport | null;
  mappingAudit?: MappingAuditReport | null;
  policyVersions?: AnalysisPolicyVersions | null;
}): AnalysisTraceabilityEnvelope {
  const qualityGate = params.qualityGate;
  const coverageSummary = qualityGate?.coverageSummary ?? params.mappingAudit?.coverageSummary ?? null;
  const policyVersions = params.policyVersions ?? getAnalysisPolicyVersions();

  return {
    schemaVersion: policyVersions.traceabilitySchemaVersion,
    generatedAt: params.generatedAt ?? null,
    runContext: {
      runId: params.runId ?? null,
      companyId: params.companyId ?? null,
      sourceMode: params.sourceMode ?? null,
      periodCount: params.periodCount ?? 0,
      latestPeriod: params.latestPeriod ?? null,
    },
    policyVersions,
    qualityGate: {
      tier: qualityGate?.tier ?? "Unknown",
      valuationBlocked: Boolean(qualityGate?.valuationBlocked),
      blockingReasons: qualityGate?.blockingReasons ?? [],
      scopeClassification: qualityGate?.scopeAssessment?.classification ?? null,
      scopeBlocked: Boolean(qualityGate?.scopeAssessment?.blocked),
    },
    mappingCoverage: {
      unresolvedBySeverity: {
        critical: coverageSummary?.unresolvedBySeverity?.critical?.length ?? 0,
        warning: coverageSummary?.unresolvedBySeverity?.warning?.length ?? 0,
        info: coverageSummary?.unresolvedBySeverity?.info?.length ?? 0,
      },
      unresolvedByTier: {
        "Tier A": coverageSummary?.unresolvedByTier?.["Tier A"]?.length ?? 0,
        "Tier B": coverageSummary?.unresolvedByTier?.["Tier B"]?.length ?? 0,
        "Tier C": coverageSummary?.unresolvedByTier?.["Tier C"]?.length ?? 0,
        "Tier D": coverageSummary?.unresolvedByTier?.["Tier D"]?.length ?? 0,
      },
      outOfSpecLabelCount: params.mappingAudit?.outOfSpecLabels?.length ?? 0,
      actionableOutOfSpecLabelCount: params.mappingAudit?.backlogSummary?.actionableCount ?? 0,
      backlogByAction: {
        "add-to-spec": params.mappingAudit?.backlogSummary?.totalsByAction?.["add-to-spec"] ?? 0,
        "group-to-existing": params.mappingAudit?.backlogSummary?.totalsByAction?.["group-to-existing"] ?? 0,
        "ignore-non-core": params.mappingAudit?.backlogSummary?.totalsByAction?.["ignore-non-core"] ?? 0,
        review: params.mappingAudit?.backlogSummary?.totalsByAction?.review ?? 0,
      },
    },
  };
}
