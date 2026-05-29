import { AnalysisPolicyVersions, getAnalysisPolicyVersions } from "./policyVersions";
import { AnalysisStatusSummary } from "./analysisStatus";
import { MappingAuditReport, QualityGateReport } from "./mappingAudit";
import { CapitalineParseDebug } from "./capitalineParser";
import { evaluateParserFidelity } from "./parserFidelity";
import { EngineConfig, RawPeriodData, RecastPeriod } from "./types";
import { evaluateReconciliationResiduals } from "./reconciliationResiduals";
import { SourceParserDiagnostics } from "./parserDiagnostics";
import { detectDistress } from "./distressDetector";
import { summarizeConceptIdentity } from "./conceptOntology";
import { detectCorporateActions } from "./corporateActions";
import { evaluateEconomicSanity } from "./economicSanityGates";
import { summarizeUnusualItemManifest } from "./unusualItemPolicy";
import { buildLineageMap, buildLineageRef } from "./lineageBuilder";
import { appendRunResidualSummary, RESIDUAL_SCORE_PRODUCTION_THRESHOLD } from "../lib/residualsStore";
import { isEnabled } from "../lib/featureFlags";
import { trace } from "../lib/traceLogger";
import { selectStrategy } from "./pipeline/registry";
import "./pipeline/strategies"; // side-effect: register all PipelineStrategies

// Envelope + rigor-ladder types relocated to ./types/traceabilityEnvelope (pure leaf,
// weakness #1 cycle break). Imported back for internal use; re-exported so existing
// "./analysisTraceability" import paths stay valid.
import type {
  AccountingStandardLabel,
  AccountingStandardCoverage,
  AnalysisRigorLevel,
  AnalysisRigorCheckpoint,
  TraceabilityBacklogPreview,
  AnalysisTraceabilityEnvelope,
} from "./types/traceabilityEnvelope";
export type {
  AccountingStandardLabel,
  AccountingStandardCoverage,
  AnalysisRigorLevel,
  AnalysisRigorCheckpoint,
  TraceabilityBacklogPreview,
  AnalysisTraceabilityEnvelope,
};

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
  generatedAt?: string | null | undefined;
  runId?: string | null | undefined;
  companyId?: string | null | undefined;
  sourceMode?: string | null | undefined;
  periodCount?: number | undefined;
  latestPeriod?: string | null | undefined;
  qualityGate?: QualityGateReport | null | undefined;
  mappingAudit?: MappingAuditReport | null | undefined;
  policyVersions?: AnalysisPolicyVersions | null | undefined;
  analysisStatus?: AnalysisStatusSummary | null | undefined;
  contentClass?: string | null | undefined;
  retentionDays?: number | null | undefined;
  runInspectorEnabled?: boolean | null | undefined;
  recastPeriodCount?: number | undefined;
  hasDebugInfo?: boolean | undefined;
  debugFiles?: number | undefined;
  rawMetricKeyCount?: number | undefined;
  engineError?: string | null | undefined;
  rawData?: RawPeriodData[] | null | undefined;
  recastData?: RecastPeriod[] | null | undefined;
  config?: EngineConfig | null | undefined;
  debugInfo?: CapitalineParseDebug | null | undefined;
  parserDiagnostics?: SourceParserDiagnostics | null | undefined;
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
  // Phase I8 — single-period screening mode caps the rigor ladder at
  // syntactically-valid. Time-series levels (structurally-reconciled,
  // economically-plausible, valuation-eligible, production-ready) all
  // require ≥2 periods to be meaningful.
  const screeningOnly = Boolean(qualityGate?.scopeAssessment?.screeningOnly);
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
  // Phase J5: distress gate. Critical or severe distress (negative net
  // worth, going-concern stress) blocks `valuation-eligible` advancement
  // even when structural reconciliation cleared. Equity-side intrinsic
  // values are mathematically defined but economically meaningless on
  // these datasets; advancing the rigor level would mislead reviewers.
  const distress = detectDistress(params.recastData ?? null);
  const distressBlocksValuation = distress.severity === "critical" || distress.severity === "severe";
  // Gap 1 / PR-A — concept identity. When the registry has unresolved
  // critical conflicts, we block valuation-eligible (unless the kill
  // switch is off, in which case we still surface the gate but don't
  // gate rigor on it).
  const conceptIdentity = summarizeConceptIdentity(params.rawData ?? null);
  const conceptIdentityBlockEnabled = isEnabled("rigor.conceptIdentityBlock");
  const conceptIdentityBlocksValuation =
    conceptIdentityBlockEnabled && conceptIdentity.status === "valuation-blocked";
  if (conceptIdentity.conflictCount > 0) {
    trace("config", "conceptIdentity:detected", {
      companyId: params.companyId ?? null,
      conflictCount: conceptIdentity.conflictCount,
      unresolvedCriticalCount: conceptIdentity.unresolvedCriticalCount,
      status: conceptIdentity.status,
      truncated: conceptIdentity.truncated,
      blockEnabled: conceptIdentityBlockEnabled,
    });
  }
  // Gap 2 / PR-B — economic sanity. Walks periods latest → oldest until a
  // clean anchor is found within MAX_ANCHOR_LOOKBACK_PERIODS. When no
  // clean anchor exists, status is "blocked" and rigor cannot reach
  // economically-plausible (unless the kill switch is off).
  // Gap 3 / PR-C — unusual-item manifest is computed first so Gap 2's
  // Check A can consume affectsTerminalEligibility flags.
  const unusualItemManifest = summarizeUnusualItemManifest(
    params.recastData ?? [],
    params.rawData ?? [],
  );
  const corporateActions = detectCorporateActions(params.rawData ?? null);
  const economicSanity = evaluateEconomicSanity(
    params.recastData ?? [],
    params.rawData ?? [],
    corporateActions,
    unusualItemManifest.classifications,
  );
  const economicSanityBlockEnabled = isEnabled("rigor.economicSanityBlock");
  const economicSanityBlocksPlausible =
    economicSanityBlockEnabled && economicSanity.status === "blocked";
  const terminalEligibilityBlockEnabled = isEnabled("rigor.terminalEligibilityBlock");
  const terminalEligibilityBlocksValuation =
    terminalEligibilityBlockEnabled && unusualItemManifest.terminalEligibilityBlocked;
  if (unusualItemManifest.classifications.length > 0) {
    trace("config", "unusualItemManifest:built", {
      companyId: params.companyId ?? null,
      total: unusualItemManifest.classifications.length,
      unclassifiedCount: unusualItemManifest.unclassifiedCount,
      terminalEligibilityBlocked: unusualItemManifest.terminalEligibilityBlocked,
      truncated: unusualItemManifest.truncated,
    });
  }
  if (economicSanity.status !== "passed") {
    trace("config", `economicSanity:${economicSanity.status}`, {
      companyId: params.companyId ?? null,
      anchorPeriod: economicSanity.anchorPeriod,
      anchorReason: economicSanity.anchorReason,
      skippedCount: economicSanity.skippedPeriods.length,
      failedCheckIds: economicSanity.failedChecks.map((c) => c.checkId),
      blockEnabled: economicSanityBlockEnabled,
    });
  }
  const structuralAchieved = hasRawData && hasRecastData && !scopeBlocked && !hasBlockingIssues && reconciliation.status !== "failed";
  const checkpoints: AnalysisRigorCheckpoint[] = [
    {
      level: "syntactically-valid",
      label: "Syntactically valid",
      achieved: hasRawData && !hasEngineError && parserFidelity.status !== "failed" && parserFidelity.score >= 70,
      detail: !hasRawData
        ? "No raw periods were persisted for this run."
        : hasEngineError
          ? "Raw periods exist, but the engine still raised an execution error."
          : parserFidelity.status === "failed" || parserFidelity.score < 70
            ? `Parser fidelity did not clear the syntactic threshold (${parserFidelity.score}/100). ${parserFidelity.summary}`
            : `Parser fidelity cleared the syntactic threshold (${parserFidelity.score}/100) and no engine error was recorded.`,
    },
    {
      level: "structurally-reconciled",
      label: "Structurally reconciled",
      achieved: structuralAchieved && !screeningOnly,
      detail: screeningOnly
        ? "Single-period upload — structural reconciliation requires ≥2 periods. Results are screening-level only."
        : scopeBlocked
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
      achieved: structuralAchieved && !valuationBlocked && !screeningOnly && !economicSanityBlocksPlausible,
      detail: screeningOnly
        ? "Single-period upload — economic plausibility assessment requires ≥2 periods."
        : valuationBlocked
          ? "Valuation-critical issues still block the run, so economic plausibility is not established."
          : economicSanityBlocksPlausible
            ? `Economic sanity gates blocked the run — ${economicSanity.anchorReason}`
            : structuralAchieved
              ? economicSanity.status === "warned"
                ? `Anchor period ${economicSanity.anchorPeriod}; ${economicSanity.failedChecks.length} warning-level signal(s) carried forward.`
                : `Anchor period ${economicSanity.anchorPeriod ?? "—"}; all economic sanity checks passed.`
              : "Economic plausibility cannot be asserted until structural reconciliation clears.",
    },
    {
      level: "valuation-eligible",
      label: "Valuation eligible",
      achieved: structuralAchieved && !valuationBlocked && !distressBlocksValuation && !conceptIdentityBlocksValuation && !terminalEligibilityBlocksValuation && !screeningOnly && valuationStatus !== "guarded" && valuationStatus !== "unknown",
      detail: screeningOnly
        ? "Single-period upload — valuation eligibility requires ≥2 periods for time-series anchoring."
        : distressBlocksValuation
          ? `${distress.severity === "critical" ? "Critical" : "Severe"} financial distress detected (${distress.reasons[0] ?? "negative net worth"}). Equity-side valuation models cannot be trusted; the run is not valuation-eligible.`
          : conceptIdentityBlocksValuation
            ? `Concept identity layer reports ${conceptIdentity.unresolvedCriticalCount} unresolved critical conflict(s). Resolve before treating the run as valuation-eligible.`
            : terminalEligibilityBlocksValuation
              ? `Unusual-item manifest flags ${unusualItemManifest.classifications.filter((c) => c.affectsTerminalEligibility).length} terminal-eligibility-blocking classification(s) (${unusualItemManifest.classifications.filter((c) => c.affectsTerminalEligibility).map((c) => c.category).slice(0, 3).join(", ")}).`
              : valuationStatus === "guarded"
                ? "Valuation still depends on a guarded fallback anchor."
                : valuationStatus === "warning" || valuationStatus === "production-ready"
                  ? `Valuation status is ${valuationStatus}, so the run remains eligible for valuation use.`
                  : "Valuation readiness has not been established yet.",
    },
    {
      level: "production-ready",
      label: "Production-ready",
      achieved: !screeningOnly && analysisStatus?.status === "production-ready",
      detail: screeningOnly
        ? "Single-period upload — production-ready status requires ≥2 periods."
        : analysisStatus?.status === "production-ready"
          ? "All currently wired release checks passed."
          : analysisStatus?.headline ?? "Production-ready status was not reached.",
    },
  ];
  // achievedLevels/pendingLevels are recomputed below after the
  // residual-score downgrade gate may have toggled the production-ready
  // checkpoint. We don't materialize the pre-downgrade values.

  // Gap 7 / PR-G — residual score downgrade.
  // overallResidualScore = weighted blend of:
  //   - parser fidelity gap (1 - score/100), weight 25%
  //   - mapping critical / conflict count (capped 40), weight 25%
  //   - reconciliation max residual ratio * 100 (capped 30), weight 20%
  //   - economic sanity warnings count (capped 20), weight 15%
  //   - unusual-item terminal blockers (capped 30), weight 15%
  // Score is 0-100, lower is better. Above RESIDUAL_SCORE_PRODUCTION_THRESHOLD,
  // production-ready is downgraded to valuation-eligible.
  const parserGap = Math.max(0, 100 - parserFidelity.score);
  const mappingPenalty = Math.min(40, blockingCount * 10 + conceptIdentity.conflictCount);
  const reconPenalty = Math.min(30, (reconciliation.maxResidualRatio ?? 0) * 100);
  const sanityPenalty = Math.min(20, economicSanity.failedChecks.length * 5);
  const unusualPenalty = Math.min(30, unusualItemManifest.classifications.filter((c) => c.affectsTerminalEligibility).length * 10);
  const overallResidualScore = Math.round(
    parserGap * 0.25 + mappingPenalty * 0.25 + reconPenalty * 0.20 + sanityPenalty * 0.15 + unusualPenalty * 0.15,
  );
  const residualScoreDowngradeEnabled = isEnabled("rigor.residualScoreDowngrade");
  const productionReadyAchievedRaw = !screeningOnly && analysisStatus?.status === "production-ready";
  const productionReadyDowngraded =
    productionReadyAchievedRaw && residualScoreDowngradeEnabled && overallResidualScore > RESIDUAL_SCORE_PRODUCTION_THRESHOLD;
  if (productionReadyDowngraded) {
    // Downgrade production-ready to false; keep valuation-eligible
    // intact. This is enforced by replacing the production-ready
    // checkpoint's `achieved` after the fact.
    const idx = checkpoints.findIndex((c) => c.level === "production-ready");
    if (idx >= 0) {
      checkpoints[idx] = {
        ...checkpoints[idx],
        achieved: false,
        detail: `Residual score ${overallResidualScore} exceeds production-ready threshold ${RESIDUAL_SCORE_PRODUCTION_THRESHOLD}; downgraded to valuation-eligible.`,
      };
    }
  }
  // Recompute achieved/pending after downgrade.
  const achievedLevelsFinal = checkpoints.filter((c) => c.achieved).map((c) => c.level);
  const pendingLevelsFinal = checkpoints.filter((c) => !c.achieved).map((c) => c.level);
  const currentCheckpoint = [...checkpoints].reverse().find((checkpoint) => checkpoint.achieved) ?? checkpoints[0];

  // Persist residual summary.
  if (params.runId && params.companyId) {
    appendRunResidualSummary({
      runId: params.runId,
      timestamp: params.generatedAt ?? new Date().toISOString(),
      companyId: params.companyId,
      schemaVersion: policyVersions.traceabilitySchemaVersion,
      parserResiduals: {
        unresolvableRowCount: parserFidelity.errorCount,
        numericParseErrorCount: 0,
        blankRowRate: 0,
      },
      mappingResiduals: {
        unresolvedCriticalCount: blockingCount,
        unresolvedSupportingCount: diagnosticCount,
        conflictCount: conceptIdentity.conflictCount,
      },
      identityResiduals: {
        maxResidualRatio: reconciliation.maxResidualRatio ?? 0,
        failedCheckCount: reconciliation.errorCount,
      },
      valuationBridgeResiduals: {
        intrinsicValueSensitivity: 0,
        terminalValueShare: 0,
      },
      overallResidualScore,
    });
    if (productionReadyDowngraded) {
      trace("config", "residualScore:downgrade", {
        companyId: params.companyId,
        runId: params.runId,
        score: overallResidualScore,
        threshold: RESIDUAL_SCORE_PRODUCTION_THRESHOLD,
      });
    }
  }

  const valuationGateFailures = [
    scopeBlocked,
    valuationBlocked,
    reconciliation.status === "failed",
    parserFidelity.status === "failed",
  ].filter(Boolean).length;

  // Plan 3 PR-3.5 — stamp the dispatched strategy id into the envelope so
  // an audit can reproduce the run with the same code path. Selection is
  // best-effort: when rawData is missing or the registry rejects the
  // payload (e.g. malformed input), leave the field unset.
  let pipelineStrategyId: string | undefined;
  if (params.rawData && params.rawData.length > 0 && params.config) {
    try {
      pipelineStrategyId = selectStrategy(params.rawData, params.config).id;
    } catch (err) {
      trace("config", "pipelineStrategy:selectFailed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    schemaVersion: policyVersions.traceabilitySchemaVersion,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    ...(pipelineStrategyId ? { pipelineStrategyId } : {}),
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
  confidence: (() => {
    // Parser fidelity is a hard gate: if the parser could not produce a
    // trustworthy dataset, downstream confidence is meaningless regardless
    // of what mappingAudit or valuationReadiness say.
    if (parserFidelity.status === "failed") {
      return {
        status: "blocked" as const,
        headline: `Parser fidelity failed — ${parserFidelity.summary}`,
        tone: "red" as const,
        blockingCount: Math.max(statusBlockingCount, valuationGateFailures, 1),
        diagnosticCount: statusDiagnosticCount,
        optionalCount: statusOptionalCount,
      };
    }
    return {
      status: analysisStatus?.status ?? "guarded",
      headline: analysisStatus?.headline ?? "Traceability confidence status unavailable.",
      tone: analysisStatus?.tone ?? "amber",
      blockingCount: Math.max(statusBlockingCount, valuationGateFailures),
      diagnosticCount: statusDiagnosticCount,
      optionalCount: statusOptionalCount,
    };
  })(),
    parserFidelity,
    reconciliation,
    accountingStandardCoverage: computeAccountingStandardCoverage(params.rawData),
    conceptIdentity,
    economicSanity,
    unusualItemManifest,
    lineageRef: buildLineageRef(buildLineageMap({
      recastData: params.recastData ?? null,
      rawData: params.rawData ?? null,
    })),
    rigor: {
      currentLevel: currentCheckpoint.level,
      currentLabel: currentCheckpoint.label,
      summary: currentCheckpoint.detail,
      achievedLevels: achievedLevelsFinal,
      pendingLevels: pendingLevelsFinal,
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
