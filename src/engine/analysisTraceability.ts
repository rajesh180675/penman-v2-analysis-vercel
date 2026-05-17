import { AnalysisPolicyVersions, getAnalysisPolicyVersions } from "./policyVersions";
import { AnalysisStatusSummary } from "./analysisStatus";
import { MappingAuditReport, QualityGateReport } from "./mappingAudit";
import { BacklogPriority, BacklogTriageAction } from "./mappingBacklogPolicy";
import { CapitalineParseDebug } from "./capitalineParser";
import { evaluateParserFidelity, ParserFidelitySummary } from "./parserFidelity";
import { EngineConfig, RawPeriodData, RecastPeriod } from "./types";
import { evaluateReconciliationResiduals, ReconciliationResidualSummary } from "./reconciliationResiduals";
import { SourceParserDiagnostics } from "./parserDiagnostics";

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

/**
 * Phase A6 — multi-standard ingestion provenance surfaced in the
 * traceability envelope. Tracks how many periods came from each
 * accounting standard so downstream UI / rigor checks can flag runs
 * that lean on lower-confidence (pre-Ind-AS) data.
 */
export type AccountingStandardLabel =
  | "ind-as"
  | "revised-sch-vi"
  | "standard"
  | "unknown";

export interface AccountingStandardCoverage {
  /** Standard with the most periods. Falls back to "unknown" when raw
   *  data carries no provenance (legacy fixtures, screener imports). */
  dominantStandard: AccountingStandardLabel;
  /** Period count per standard. */
  periodsByStandard: Record<AccountingStandardLabel, number>;
  /** Periods whose dominant standard is non-Ind-AS (medium/low confidence). */
  preIndASPeriods: number;
  /** True when ≥2 distinct standards contributed periods. */
  hasMultiStandardData: boolean;
  /** Confidence band: "high" if all periods are Ind-AS, "medium" if any
   *  Revised-Sch-VI, "low" if any Standard or Unknown periods, "unknown"
   *  when raw data has no accounting_standard tag at all. */
  confidence: "high" | "medium" | "low" | "unknown";
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
  parserFidelity: ParserFidelitySummary;
  reconciliation: ReconciliationResidualSummary;
  /** Phase A6 — distribution of accounting standards across raw periods. */
  accountingStandardCoverage: AccountingStandardCoverage;
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

/**
 * Phase A6 — derive accounting-standard coverage from raw period data.
 * Returns a coverage summary even when raw data is null or carries no
 * provenance (legacy fixtures, screener imports), in which case the
 * confidence band defaults to "unknown".
 */
export function computeAccountingStandardCoverage(
  rawData: RawPeriodData[] | null | undefined,
): AccountingStandardCoverage {
  const periodsByStandard: Record<AccountingStandardLabel, number> = {
    "ind-as": 0,
    "revised-sch-vi": 0,
    standard: 0,
    unknown: 0,
  };

  let taggedCount = 0;
  for (const period of rawData ?? []) {
    const tag = period.accounting_standard;
    if (tag) {
      taggedCount++;
      periodsByStandard[tag] = (periodsByStandard[tag] ?? 0) + 1;
    } else {
      periodsByStandard.unknown += 1;
    }
  }

  // Determine dominant standard by count, with precedence as tiebreaker
  // (Ind-AS > REV > Standard > Unknown).
  const PRECEDENCE: Record<AccountingStandardLabel, number> = {
    "ind-as": 4,
    "revised-sch-vi": 3,
    standard: 2,
    unknown: 1,
  };
  let dominantStandard: AccountingStandardLabel = "unknown";
  let bestCount = -1;
  let bestPrec = -1;
  for (const std of ["ind-as", "revised-sch-vi", "standard", "unknown"] as const) {
    const cnt = periodsByStandard[std];
    if (cnt > bestCount || (cnt === bestCount && PRECEDENCE[std] > bestPrec)) {
      bestCount = cnt;
      bestPrec = PRECEDENCE[std];
      dominantStandard = std;
    }
  }

  const distinctContributing = (
    Object.keys(periodsByStandard) as AccountingStandardLabel[]
  ).filter((k) => periodsByStandard[k] > 0).length;

  const preIndASPeriods =
    periodsByStandard["revised-sch-vi"] +
    periodsByStandard.standard +
    // Untagged periods (legacy fixtures) count as pre-Ind-AS only when
    // there was no tagging at all — otherwise they're indistinguishable
    // from genuinely-Ind-AS periods that simply weren't reflagged.
    (taggedCount === 0 ? periodsByStandard.unknown : 0);

  // Confidence band:
  // - "unknown" when no period carries a tag at all
  // - "high" when 100% of tagged periods are Ind-AS
  // - "medium" when any Revised-Sch-VI period exists (but no Standard/Unknown)
  // - "low" when any Standard or tagged-Unknown periods contribute
  let confidence: "high" | "medium" | "low" | "unknown";
  if (taggedCount === 0) {
    confidence = "unknown";
  } else if (
    periodsByStandard.standard > 0 ||
    // Tagged "unknown" — parser couldn't determine standard
    (taggedCount > 0 && periodsByStandard.unknown > 0)
  ) {
    confidence = "low";
  } else if (periodsByStandard["revised-sch-vi"] > 0) {
    confidence = "medium";
  } else {
    confidence = "high";
  }

  return {
    dominantStandard,
    periodsByStandard,
    preIndASPeriods,
    hasMultiStandardData: distinctContributing >= 2,
    confidence,
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
  analysisStatus?: AnalysisStatusSummary | null;
  contentClass?: string | null;
  retentionDays?: number | null;
  runInspectorEnabled?: boolean | null;
  recastPeriodCount?: number;
  hasDebugInfo?: boolean;
  debugFiles?: number;
  rawMetricKeyCount?: number;
  engineError?: string | null;
  rawData?: RawPeriodData[] | null;
  recastData?: RecastPeriod[] | null;
  config?: EngineConfig | null;
  debugInfo?: CapitalineParseDebug | null;
  parserDiagnostics?: SourceParserDiagnostics | null;
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
  const rawPeriodCount = params.periodCount ?? params.rawData?.length ?? 0;
  const recastPeriodCount = params.recastPeriodCount ?? params.recastData?.length ?? 0;
  const hasRawData = rawPeriodCount > 0;
  const hasRecastData = recastPeriodCount > 0;
  const hasEngineError = Boolean(params.engineError);
  const hasBlockingIssues = blockingCount > 0;
  const valuationBlocked = Boolean(qualityGate?.valuationBlocked);
  const scopeBlocked = Boolean(qualityGate?.scopeAssessment?.blocked);
  const valuationStatus = analysisStatus?.valuationStatus ?? "unknown";
  const statusBlockingCount = analysisStatus?.effectiveBlockingCount ?? analysisStatus?.blockingCount ?? blockingCount;
  const statusDiagnosticCount = analysisStatus?.effectiveDiagnosticCount ?? analysisStatus?.diagnosticCount ?? diagnosticCount;
  const statusOptionalCount = analysisStatus?.effectiveOptionalCount ?? analysisStatus?.optionalCount ?? optionalCount;
  const parserFidelity = evaluateParserFidelity({
    sourceMode: params.sourceMode ?? null,
    rawData: params.rawData ?? null,
    debugInfo: params.debugInfo ?? null,
    periodCount: params.periodCount ?? 0,
    rawMetricKeyCount: params.rawMetricKeyCount ?? 0,
    parserDiagnostics: params.parserDiagnostics ?? null,
  });
  const reconciliation = evaluateReconciliationResiduals({
    recastData: params.recastData ?? null,
    config: params.config ?? null,
  });
  const structuralAchieved = hasRawData && hasRecastData && !scopeBlocked && !hasBlockingIssues && reconciliation.status !== "failed";
  const checkpoints: AnalysisRigorCheckpoint[] = [
    {
      level: "syntactically-valid",
      label: "Syntactically valid",
      achieved: hasRawData && !hasEngineError && parserFidelity.status !== "failed" && parserFidelity.score >= 60,
      detail: !hasRawData
        ? "No raw periods were persisted for this run."
        : hasEngineError
          ? "Raw periods exist, but the engine still raised an execution error."
          : parserFidelity.status === "failed" || parserFidelity.score < 60
            ? `Parser fidelity did not clear the syntactic threshold (${parserFidelity.score}/100). ${parserFidelity.summary}`
            : `Parser fidelity cleared the syntactic threshold (${parserFidelity.score}/100) and no engine error was recorded.`,
    },
    {
      level: "structurally-reconciled",
      label: "Structurally reconciled",
      achieved: structuralAchieved,
      detail: scopeBlocked
        ? "Scope policy blocked this dataset before structural reconciliation could clear."
        : hasBlockingIssues
          ? `${blockingCount} blocking mapping or identity issues remain unresolved.`
          : reconciliation.status === "failed"
            ? `Structural residual thresholds did not clear. ${reconciliation.summary}`
            : reconciliation.status === "degraded"
              ? `Structural residual thresholds cleared without critical breaches, but warning-level residuals remain. ${reconciliation.summary}`
          : hasRecastData
            ? `Recast statements exist and structural residual checks cleared. ${reconciliation.summary}`
            : "No recast statements were produced yet.",
    },
    {
      level: "economically-plausible",
      label: "Economically plausible",
      achieved: structuralAchieved && !valuationBlocked,
      detail: valuationBlocked
        ? "Valuation-critical issues still block the run, so economic plausibility is not established."
        : structuralAchieved
          ? "The run cleared structural blockers and no valuation-critical issues remain."
          : "Economic plausibility cannot be asserted until structural reconciliation clears.",
    },
    {
      level: "valuation-eligible",
      label: "Valuation eligible",
      achieved: structuralAchieved && !valuationBlocked && valuationStatus !== "guarded" && valuationStatus !== "unknown",
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
  const valuationGateFailures = [
    scopeBlocked,
    valuationBlocked,
    reconciliation.status === "failed",
    parserFidelity.status === "failed",
  ].filter(Boolean).length;

  return {
    schemaVersion: policyVersions.traceabilitySchemaVersion,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    runContext: {
      runId: params.runId ?? null,
      companyId: params.companyId ?? null,
      sourceMode: params.sourceMode ?? null,
      periodCount: rawPeriodCount,
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
      blockingCount: Math.max(statusBlockingCount, valuationGateFailures),
      diagnosticCount: statusDiagnosticCount,
      optionalCount: statusOptionalCount,
    },
    parserFidelity,
    reconciliation,
    accountingStandardCoverage: computeAccountingStandardCoverage(params.rawData),
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
      rawPeriodCount,
      recastPeriodCount,
      hasRecastData,
      hasDebugInfo: params.hasDebugInfo ?? Boolean(params.debugInfo),
      debugFiles: params.debugFiles ?? params.debugInfo?.files?.length ?? 0,
      rawMetricKeyCount: params.rawMetricKeyCount ?? params.debugInfo?.rawMetricKeys?.length ?? 0,
      engineError: params.engineError ?? null,
    },
    backlogPreview,
  };
}
