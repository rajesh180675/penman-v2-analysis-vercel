import { reproducibilityHash } from "../../lib/evidenceLocking";
import { evaluateEconomicSanity } from "../economicSanityGates";
import type { AnalysisWindow, ContentRef } from "../analysisRun";
import type { RawPeriodData, RecastPeriod } from "../types";
import type { EconomicSanitySummary } from "../types/economicSanity";
import {
  resolveValuationReadiness,
  type ValuationReadiness,
} from "../valuationPolicy";

export const ANALYSIS_WINDOW_POLICY_VERSION = "2026-07-unified-window-v1" as const;

export interface AnalystPeriodExclusion {
  readonly period: string;
  readonly reasonCode: string;
  readonly evidenceRefs: readonly ContentRef[];
  readonly confirmed: true;
}

export interface UnifiedAnalysisWindow extends AnalysisWindow {
  readonly policyVersion: typeof ANALYSIS_WINDOW_POLICY_VERSION;
  readonly sourcePeriodCount: number;
  readonly economicStatus: EconomicSanitySummary["status"];
  readonly valuationReadinessStatus: ValuationReadiness["status"];
  readonly blockerCodes: readonly string[];
}

export interface SelectAnalysisWindowInput {
  readonly periods: readonly RecastPeriod[];
  readonly rawData: readonly RawPeriodData[];
  readonly economicSanity?: EconomicSanitySummary | undefined;
  readonly valuationReadiness?: ValuationReadiness | undefined;
  readonly analystExclusions?: readonly AnalystPeriodExclusion[] | undefined;
  readonly minimumPeriods?: number | undefined;
}

export interface SelectFamilyPeriodWindowInput {
  readonly rawData: readonly RawPeriodData[];
  readonly analystExclusions?: readonly AnalystPeriodExclusion[] | undefined;
  readonly minimumPeriods?: number | undefined;
}

function identityWithoutId(window: Omit<UnifiedAnalysisWindow, "windowId">) {
  return window as unknown as Record<string, unknown>;
}

function periodIndex(periods: readonly RecastPeriod[], period: string | null): number {
  if (!period) return -1;
  return periods.findIndex((item) => item.period_end === period);
}

/**
 * Select the one authoritative historical window consumed by assumptions,
 * forecasts, and every intrinsic model. Economic and valuation policies vote
 * once here; downstream models may not independently pick a newer anchor.
 */
export async function selectUnifiedAnalysisWindow(
  input: SelectAnalysisWindowInput,
): Promise<UnifiedAnalysisWindow> {
  const ordered = [...input.periods].sort((left, right) =>
    left.period_end.localeCompare(right.period_end),
  );
  const rawData = [...input.rawData];
  const economic = input.economicSanity ?? evaluateEconomicSanity(ordered, rawData);
  const readiness = input.valuationReadiness ?? resolveValuationReadiness(ordered);
  const minimumPeriods = Math.max(2, input.minimumPeriods ?? 2);
  const rationale: string[] = [economic.anchorReason, ...readiness.reasons];
  const blockerCodes = new Set<string>();

  const duplicatePeriods = ordered
    .map((period) => period.period_end)
    .filter((period, index, all) => all.indexOf(period) !== index);
  if (duplicatePeriods.length > 0) {
    blockerCodes.add("DUPLICATE_PERIOD_IDENTITY");
    rationale.push(`Duplicate period identities: ${Array.from(new Set(duplicatePeriods)).join(", ")}.`);
  }

  const economicIndex = periodIndex(ordered, economic.anchorPeriod);
  const readinessIndex = periodIndex(ordered, readiness.anchorPeriod);
  if (economic.status === "blocked" || economicIndex < 0) {
    blockerCodes.add("ECONOMIC_ANCHOR_BLOCKED");
  }
  if (readinessIndex < 0) {
    blockerCodes.add("VALUATION_ANCHOR_UNAVAILABLE");
  }

  // The strictest (oldest) qualifying anchor wins. This prevents either
  // policy from silently selecting a period rejected by the other.
  let anchorIndex = economicIndex >= 0 && readinessIndex >= 0
    ? Math.min(economicIndex, readinessIndex)
    : -1;
  if (economicIndex >= 0 && readinessIndex >= 0 && economicIndex !== readinessIndex) {
    rationale.push(
      `Anchor policies differed (${economic.anchorPeriod} vs ${readiness.anchorPeriod}); selected strict common anchor ${ordered[anchorIndex]?.period_end ?? "none"}.`,
    );
  }

  const analystExclusions = new Map(
    (input.analystExclusions ?? []).map((exclusion) => [exclusion.period, exclusion]),
  );
  if (anchorIndex >= 0 && analystExclusions.has(ordered[anchorIndex]!.period_end)) {
    while (anchorIndex >= 0 && analystExclusions.has(ordered[anchorIndex]!.period_end)) {
      anchorIndex -= 1;
    }
    rationale.push("The policy anchor was analyst-excluded; selected the latest prior non-excluded period.");
  }

  const anchorPeriod = anchorIndex >= 0 ? ordered[anchorIndex]!.period_end : null;
  const includedPeriods = ordered
    .filter((period, index) =>
      index <= anchorIndex
      && period.ratios != null
      && !analystExclusions.has(period.period_end),
    )
    .map((period) => period.period_end);

  if (includedPeriods.length < minimumPeriods) {
    blockerCodes.add("INSUFFICIENT_WINDOW_HISTORY");
    rationale.push(
      `Selected window has ${includedPeriods.length} usable period(s); policy requires ${minimumPeriods}.`,
    );
  }

  const excludedPeriods: UnifiedAnalysisWindow["excludedPeriods"] = ordered
    .filter((period) => !includedPeriods.includes(period.period_end))
    .map((period) => {
      const sourceIndex = ordered.findIndex((candidate) => candidate.period_end === period.period_end);
      const analyst = analystExclusions.get(period.period_end);
      if (analyst) {
        return {
          period: period.period_end,
          reasonCode: analyst.reasonCode,
          evidenceRefs: analyst.evidenceRefs,
          policy: "analyst-confirmed" as const,
        };
      }
      if (period.ratios == null) {
        return {
          period: period.period_end,
          reasonCode: "MISSING_RATIO_CONTEXT",
          evidenceRefs: [],
          policy: "automatic" as const,
        };
      }
      return {
        period: period.period_end,
        reasonCode: sourceIndex > anchorIndex ? "AFTER_COMMON_POLICY_ANCHOR" : "WINDOW_POLICY_EXCLUDED",
        evidenceRefs: [],
        policy: "automatic" as const,
      };
    });

  const guarded =
    blockerCodes.size === 0
    && (
      economic.status === "warned"
      || readiness.status !== "production-ready"
      || excludedPeriods.length > 0
      || economicIndex !== readinessIndex
    );
  const selectionStatus: UnifiedAnalysisWindow["selectionStatus"] = blockerCodes.size > 0
    ? "blocked"
    : guarded
      ? "guarded"
      : "confirmed";

  const withoutId: Omit<UnifiedAnalysisWindow, "windowId"> = {
    policyVersion: ANALYSIS_WINDOW_POLICY_VERSION,
    includedPeriods,
    excludedPeriods,
    anchorPeriod,
    selectionStatus,
    rationale,
    sourcePeriodCount: ordered.length,
    economicStatus: economic.status,
    valuationReadinessStatus: readiness.status,
    blockerCodes: Array.from(blockerCodes).sort(),
  };
  const digest = await reproducibilityHash(identityWithoutId(withoutId));
  return Object.freeze({
    ...withoutId,
    windowId: `sha256:${digest}`,
  });
}

/**
 * Pins a family-analysis history when an industrial recast does not exist.
 *
 * This deliberately returns a guarded window: raw period identity is enough
 * to make FI and other native-family runs reproducible, but it is not evidence
 * that industrial economic-sanity or valuation-readiness policies passed.
 */
export async function selectFamilyPeriodAnalysisWindow(
  input: SelectFamilyPeriodWindowInput,
): Promise<UnifiedAnalysisWindow> {
  const sourcePeriods = input.rawData.map((period) => period.period_end).sort();
  const orderedPeriods = Array.from(new Set(sourcePeriods));
  const duplicatePeriods = sourcePeriods.filter((period, index, all) => all.indexOf(period) !== index);
  const analystExclusions = new Map(
    (input.analystExclusions ?? []).map((exclusion) => [exclusion.period, exclusion]),
  );
  const includedPeriods = orderedPeriods.filter((period) => !analystExclusions.has(period));
  const minimumPeriods = Math.max(2, input.minimumPeriods ?? 2);
  const blockerCodes = new Set<string>();
  const rationale = [
    "Pinned from native-family raw period identities; industrial recast economic gates are not applicable.",
  ];

  if (duplicatePeriods.length > 0) {
    blockerCodes.add("DUPLICATE_PERIOD_IDENTITY");
    rationale.push(`Duplicate period identities: ${Array.from(new Set(duplicatePeriods)).join(", ")}.`);
  }
  if (includedPeriods.length < minimumPeriods) {
    blockerCodes.add("INSUFFICIENT_WINDOW_HISTORY");
    rationale.push(`Selected window has ${includedPeriods.length} period(s); policy requires ${minimumPeriods}.`);
  }

  const excludedPeriods: UnifiedAnalysisWindow["excludedPeriods"] = orderedPeriods
    .filter((period) => !includedPeriods.includes(period))
    .map((period) => {
      const exclusion = analystExclusions.get(period)!;
      return {
        period,
        reasonCode: exclusion.reasonCode,
        evidenceRefs: exclusion.evidenceRefs,
        policy: "analyst-confirmed" as const,
      };
    });
  const withoutId: Omit<UnifiedAnalysisWindow, "windowId"> = {
    policyVersion: ANALYSIS_WINDOW_POLICY_VERSION,
    includedPeriods,
    excludedPeriods,
    anchorPeriod: includedPeriods.at(-1) ?? null,
    selectionStatus: blockerCodes.size > 0 ? "blocked" : "guarded",
    rationale,
    sourcePeriodCount: orderedPeriods.length,
    economicStatus: "warned",
    valuationReadinessStatus: "guarded",
    blockerCodes: Array.from(blockerCodes).sort(),
  };
  const digest = await reproducibilityHash(identityWithoutId(withoutId));
  return Object.freeze({ ...withoutId, windowId: `sha256:${digest}` });
}
