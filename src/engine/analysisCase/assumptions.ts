import { reproducibilityHash } from "../../lib/evidenceLocking";
import type { ContentRef, SourcedAssumption } from "../analysisRun";
import type { UnifiedAnalysisWindow } from "./window";

export const ASSUMPTION_SET_SCHEMA_VERSION = "2026-07-assumption-set-v1" as const;

export interface AssumptionCandidate<T = number> {
  readonly assumptionId: string;
  readonly key: string;
  readonly value: T;
  readonly unit: string;
  readonly mode: SourcedAssumption<T>["mode"];
  readonly evidenceRefs: readonly ContentRef[];
  readonly periodWindow: SourcedAssumption<T>["periodWindow"];
  readonly range: SourcedAssumption<T>["range"];
  readonly distribution: SourcedAssumption<T>["distribution"];
  readonly confidence: SourcedAssumption<T>["confidence"];
  readonly reviewerState: SourcedAssumption<T>["reviewerState"];
  readonly required: boolean;
}

export interface AssumptionValidationIssue {
  readonly assumptionId: string;
  readonly code:
    | "DUPLICATE_ASSUMPTION_ID"
    | "NON_FINITE_VALUE"
    | "MISSING_EVIDENCE"
    | "MISSING_PERIOD_WINDOW"
    | "WINDOW_OUTSIDE_ANALYSIS"
    | "INVALID_RANGE"
    | "INVALID_DISTRIBUTION";
  readonly severity: "warning" | "blocker";
  readonly message: string;
}

export interface ResolvedSourcedAssumption<T = unknown> extends SourcedAssumption<T> {
  readonly eligibleForIntrinsicConfidence: boolean;
  readonly validationStatus: "confirmed" | "guarded" | "blocked";
  readonly validationIssues: readonly AssumptionValidationIssue[];
}

export interface SourcedAssumptionSet {
  readonly schemaVersion: typeof ASSUMPTION_SET_SCHEMA_VERSION;
  readonly assumptionSetId: string;
  readonly analysisWindowId: string;
  readonly status: "confirmed" | "guarded" | "blocked";
  readonly assumptions: readonly ResolvedSourcedAssumption[];
  readonly issues: readonly AssumptionValidationIssue[];
  readonly intrinsicEligibleAssumptionIds: readonly string[];
}

function finite(value: unknown): boolean {
  return typeof value !== "number" || Number.isFinite(value);
}

function validateCandidate(
  candidate: AssumptionCandidate<unknown>,
  window: UnifiedAnalysisWindow,
): AssumptionValidationIssue[] {
  const issues: AssumptionValidationIssue[] = [];
  const severity = candidate.required ? "blocker" : "warning";
  if (!finite(candidate.value)) {
    issues.push({
      assumptionId: candidate.assumptionId,
      code: "NON_FINITE_VALUE",
      severity,
      message: "Assumption value must be finite.",
    });
  }

  const historicalMode = candidate.mode === "derived" || candidate.mode === "management-guidance";
  const evidenceRequired = candidate.mode !== "manual-override";
  if (evidenceRequired && candidate.evidenceRefs.length === 0) {
    issues.push({
      assumptionId: candidate.assumptionId,
      code: "MISSING_EVIDENCE",
      severity,
      message: `${candidate.mode} assumptions require an actual evidence reference.`,
    });
  }
  if (historicalMode && candidate.periodWindow == null) {
    issues.push({
      assumptionId: candidate.assumptionId,
      code: "MISSING_PERIOD_WINDOW",
      severity,
      message: `${candidate.mode} assumptions require the period window used to derive them.`,
    });
  }
  if (candidate.periodWindow) {
    const fromIndex = window.includedPeriods.indexOf(candidate.periodWindow.from);
    const toIndex = window.includedPeriods.indexOf(candidate.periodWindow.to);
    if (fromIndex < 0 || toIndex < fromIndex || candidate.periodWindow.observations <= 0) {
      issues.push({
        assumptionId: candidate.assumptionId,
        code: "WINDOW_OUTSIDE_ANALYSIS",
        severity,
        message: "Assumption period window must be contained in the selected analysis window.",
      });
    }
  }
  if (candidate.range) {
    const low = candidate.range.low;
    const high = candidate.range.high;
    if (typeof low === "number" && typeof high === "number" && (!Number.isFinite(low) || !Number.isFinite(high) || low > high)) {
      issues.push({
        assumptionId: candidate.assumptionId,
        code: "INVALID_RANGE",
        severity,
        message: "Numeric assumption range must be finite and ordered low <= high.",
      });
    }
  }
  if (candidate.distribution && Object.values(candidate.distribution.parameters).some((value) => !Number.isFinite(value))) {
    issues.push({
      assumptionId: candidate.assumptionId,
      code: "INVALID_DISTRIBUTION",
      severity,
      message: "Distribution parameters must be finite.",
    });
  }
  return issues;
}

export async function resolveSourcedAssumptionSet(input: {
  readonly window: UnifiedAnalysisWindow;
  readonly candidates: readonly AssumptionCandidate<unknown>[];
}): Promise<SourcedAssumptionSet> {
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const candidate of input.candidates) {
    if (seenIds.has(candidate.assumptionId)) duplicateIds.add(candidate.assumptionId);
    seenIds.add(candidate.assumptionId);
  }

  const assumptions = input.candidates.map((candidate): ResolvedSourcedAssumption => {
    const validationIssues = validateCandidate(candidate, input.window);
    if (duplicateIds.has(candidate.assumptionId)) {
      validationIssues.push({
        assumptionId: candidate.assumptionId,
        code: "DUPLICATE_ASSUMPTION_ID",
        severity: "blocker",
        message: "Assumption ids must be unique within a set.",
      });
    }
    const validationStatus = validationIssues.some((issue) => issue.severity === "blocker")
      ? "blocked"
      : validationIssues.length > 0
        ? "guarded"
        : "confirmed";
    const eligibleForIntrinsicConfidence =
      candidate.mode !== "market-implied"
      && validationStatus !== "blocked"
      && candidate.confidence !== "unavailable";
    return Object.freeze({
      assumptionId: candidate.assumptionId,
      key: candidate.key,
      value: candidate.value,
      unit: candidate.unit,
      mode: candidate.mode,
      evidenceRefs: candidate.evidenceRefs,
      periodWindow: candidate.periodWindow,
      range: candidate.range,
      distribution: candidate.distribution,
      confidence: candidate.confidence,
      reviewerState: candidate.reviewerState,
      eligibleForIntrinsicConfidence,
      validationStatus,
      validationIssues,
    });
  });
  const issues = assumptions.flatMap((assumption) => assumption.validationIssues);
  const status: SourcedAssumptionSet["status"] = input.window.selectionStatus === "blocked" || issues.some((issue) => issue.severity === "blocker")
    ? "blocked"
    : issues.length > 0 || input.window.selectionStatus === "guarded"
      ? "guarded"
      : "confirmed";
  const intrinsicEligibleAssumptionIds = assumptions
    .filter((assumption) => assumption.eligibleForIntrinsicConfidence)
    .map((assumption) => assumption.assumptionId);
  const core = {
    schemaVersion: ASSUMPTION_SET_SCHEMA_VERSION,
    analysisWindowId: input.window.windowId,
    status,
    assumptions,
    issues,
    intrinsicEligibleAssumptionIds,
  };
  const digest = await reproducibilityHash(core as unknown as Record<string, unknown>);
  return Object.freeze({
    ...core,
    assumptionSetId: `sha256:${digest}`,
  });
}
