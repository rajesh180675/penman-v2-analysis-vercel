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

export type AnalysisRigorLevel =
  | "syntactically-valid"
  | "structurally-reconciled"
  | "economically-plausible"
  | "valuation-eligible"
  | "production-ready";

export interface AnalysisRigorCheckpoint {
  level: AnalysisRigorLevel;
  label: string;
  achieved: boolean;
  detail: string;
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
  rigor: {
    currentLevel: AnalysisRigorLevel;
    currentLabel: string;
    summary: string;
    achievedLevels: AnalysisRigorLevel[];
    pendingLevels: AnalysisRigorLevel[];
    checkpoints: AnalysisRigorCheckpoint[];
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
  const hasRawData = (params.periodCount ?? 0) > 0;
  const hasRecastData = (params.recastPeriodCount ?? 0) > 0;
  const hasEngineError = Boolean(params.engineError);
  const hasBlockingIssues = blockingCount > 0;
  const valuationBlocked = Boolean(qualityGate?.valuationBlocked);
  const scopeBlocked = Boolean(qualityGate?.scopeAssessment?.blocked);
  const valuationStatus = analysisStatus?.valuationStatus ?? "unknown";
  const checkpoints: AnalysisRigorCheckpoint[] = [
    {
      level: "syntactically-valid",
      label: "Syntactically valid",
      achieved: hasRawData && !hasEngineError,
      detail: hasRawData
        ? hasEngineError
          ? "Raw periods exist, but the engine still raised an execution error."
          : "Raw periods were captured and no engine error was recorded."
        : "No raw periods were persisted for this run.",
    },
    {
      level: "structurally-reconciled",
      label: "Structurally reconciled",
      achieved: hasRawData && hasRecastData && !scopeBlocked && !hasBlockingIssues,
      detail: scopeBlocked
        ? "Scope policy blocked this dataset before structural reconciliation could clear."
        : hasBlockingIssues
          ? `${blockingCount} blocking mapping or identity issues remain unresolved.`
          : hasRecastData
            ? "Recast statements exist and no blocking structural issues remain."
            : "No recast statements were produced yet.",
    },
    {
      level: "economically-plausible",
      label: "Economically plausible",
      achieved: hasRawData && hasRecastData && !scopeBlocked && !hasBlockingIssues && !valuationBlocked,
      detail: valuationBlocked
        ? "Valuation-critical issues still block the run, so economic plausibility is not established."
        : hasRawData && hasRecastData && !scopeBlocked && !hasBlockingIssues
          ? "The run cleared structural blockers and no valuation-critical issues remain."
          : "Economic plausibility cannot be asserted until structural reconciliation clears.",
    },
    {
      level: "valuation-eligible",
      label: "Valuation eligible",
      achieved: hasRawData && hasRecastData && !scopeBlocked && !hasBlockingIssues && !valuationBlocked && valuationStatus !== "guarded" && valuationStatus !== "unknown",
      detail: valuationStatus === "guarded"
        ? "Valuation still depends on a guarded fallback anchor."
        : valuationStatus === "warning" || valuationStatus === "production-ready"
          ? `Valuation status is ${valuationStatus}, so the run remains eligible for valuation use.`
          : "Valuation readiness has not been established yet.",
    },
    {
      level: "production-ready",
      label: "Production-ready",
      achieved: analysisStatus?.status === "production-ready",
      detail: analysisStatus?.status === "production-ready"
        ? "All currently wired release checks passed."
        : analysisStatus?.headline ?? "Production-ready status was not reached.",
    },
  ];
  const achievedLevels = checkpoints.filter((checkpoint) => checkpoint.achieved).map((checkpoint) => checkpoint.level);
  const pendingLevels = checkpoints.filter((checkpoint) => !checkpoint.achieved).map((checkpoint) => checkpoint.level);
  const currentCheckpoint = [...checkpoints].reverse().find((checkpoint) => checkpoint.achieved) ?? checkpoints[0];

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
    rigor: {
      currentLevel: currentCheckpoint.level,
      currentLabel: currentCheckpoint.label,
      summary: currentCheckpoint.detail,
      achievedLevels,
      pendingLevels,
      checkpoints,
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
      hasRecastData,
      hasDebugInfo: Boolean(params.hasDebugInfo),
      debugFiles: params.debugFiles ?? 0,
      rawMetricKeyCount: params.rawMetricKeyCount ?? 0,
      engineError: params.engineError ?? null,
    },
    backlogPreview,
  };
}
