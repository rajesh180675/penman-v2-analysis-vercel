import { AnalysisPolicyVersions, getAnalysisPolicyVersions } from "./policyVersions";
import { AnalysisStatusSummary } from "./analysisStatus";
import { MappingAuditReport, QualityGateReport } from "./mappingAudit";
import { BacklogPriority, BacklogTriageAction } from "./mappingBacklogPolicy";

export interface TraceabilityBacklogPreview {
  statement: string;
  key: string;
  action: BacklogTriageAction;
  priority: BacklogPriority;
  periodsObserved: number;
  latestValue: number | null;
}

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
  confidence: {
    status: "production-ready" | "guarded" | "blocked";
    headline: string;
    tone: "emerald" | "amber" | "red";
    blockingCount: number;
    diagnosticCount: number;
    optionalCount: number;
  };
  mappingCoverage: {
    unresolvedBySeverity: Record<"critical" | "warning" | "info", number>;
    unresolvedByTier: Record<"Tier A" | "Tier B" | "Tier C" | "Tier D", number>;
    outOfSpecLabelCount: number;
    actionableOutOfSpecLabelCount: number;
    backlogByAction: Record<"add-to-spec" | "group-to-existing" | "ignore-non-core" | "review", number>;
  };
  governance: {
    contentClass: string | null;
    retentionDays: number | null;
    runInspectorEnabled: boolean | null;
  };
  analysisContext: {
    rawPeriodCount: number;
    recastPeriodCount: number;
    hasRecastData: boolean;
    hasDebugInfo: boolean;
    debugFiles: number;
    rawMetricKeyCount: number;
    engineError: string | null;
  };
  backlogPreview: TraceabilityBacklogPreview[];
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
  analysisStatus?: AnalysisStatusSummary | null;
  contentClass?: string | null;
  retentionDays?: number | null;
  runInspectorEnabled?: boolean | null;
  recastPeriodCount?: number;
  hasDebugInfo?: boolean;
  debugFiles?: number;
  rawMetricKeyCount?: number;
  engineError?: string | null;
}): AnalysisTraceabilityEnvelope {
  const qualityGate = params.qualityGate;
  const coverageSummary = qualityGate?.coverageSummary ?? params.mappingAudit?.coverageSummary ?? null;
  const policyVersions = params.policyVersions ?? getAnalysisPolicyVersions();
  const analysisStatus = params.analysisStatus;
  const blockingCount = coverageSummary?.unresolvedBySeverity?.critical?.length ?? 0;
  const diagnosticCount = coverageSummary?.unresolvedBySeverity?.warning?.length ?? 0;
  const optionalCount = coverageSummary?.unresolvedBySeverity?.info?.length ?? 0;
  const backlogPreview = (params.mappingAudit?.backlogSummary?.topActionable ?? [])
    .slice(0, 5)
    .map((entry) => ({
      statement: entry.statement,
      key: entry.key,
      action: entry.triage.action,
      priority: entry.triage.priority,
      periodsObserved: entry.periodsObserved,
      latestValue: entry.latestValue,
    }));

  return {
    schemaVersion: policyVersions.traceabilitySchemaVersion,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
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
    confidence: {
      status: analysisStatus?.status ?? "guarded",
      headline: analysisStatus?.headline ?? "Traceability confidence status unavailable.",
      tone: analysisStatus?.tone ?? "amber",
      blockingCount: analysisStatus?.blockingCount ?? blockingCount,
      diagnosticCount: analysisStatus?.diagnosticCount ?? diagnosticCount,
      optionalCount: analysisStatus?.optionalCount ?? optionalCount,
    },
    mappingCoverage: {
      unresolvedBySeverity: {
        critical: blockingCount,
        warning: diagnosticCount,
        info: optionalCount,
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
    governance: {
      contentClass: params.contentClass ?? null,
      retentionDays: params.retentionDays ?? null,
      runInspectorEnabled: params.runInspectorEnabled ?? null,
    },
    analysisContext: {
      rawPeriodCount: params.periodCount ?? 0,
      recastPeriodCount: params.recastPeriodCount ?? 0,
      hasRecastData: (params.recastPeriodCount ?? 0) > 0,
      hasDebugInfo: Boolean(params.hasDebugInfo),
      debugFiles: params.debugFiles ?? 0,
      rawMetricKeyCount: params.rawMetricKeyCount ?? 0,
      engineError: params.engineError ?? null,
    },
    backlogPreview,
  };
}
