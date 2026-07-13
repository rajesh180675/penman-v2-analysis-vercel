import type { CashFlowDcfResult } from "../cashFlowDcf";
import type { ReverseDcfDiagnostics, ValuationScenarioCard } from "../valuationCommandCenter";
import type {
  CollapsedEvidenceFamilyContribution,
  EvidenceIndependenceGroup,
  EvidenceSynthesisSubstitutionTrace,
  EvidenceWeightedModelContribution,
  EvidenceWeightedValuationSynthesis,
  ForecastHoldoutSummary,
  ValuationEvidenceLedger,
} from "./types";

export const EVIDENCE_SYNTHESIS_SUBSTITUTION_POLICY_VERSION = "2026-07-evidence-synthesis-substitution-v1" as const;

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function baseScenario(scenarios: ValuationScenarioCard[]): ValuationScenarioCard | null {
  return scenarios.find((scenario) => scenario.key === "base") ?? scenarios[0] ?? null;
}

function accrualPerShare(card: ValuationScenarioCard | null): number | null {
  if (!card) return null;
  return median([
    card.valuation.perShare?.intrinsic_re_per_share ?? null,
    card.valuation.perShare?.intrinsic_reoi_per_share ?? null,
  ].filter((value): value is number => value != null && Number.isFinite(value)));
}

function contribution(args: {
  modelKey: string;
  label: string;
  independenceGroup: EvidenceIndependenceGroup;
  perShare: number | null;
  baseReliability: number;
  evidenceCoveragePenalty: number;
  forecastSkillPenalty: number;
  priceDerivedPenalty?: number | undefined;
  includedInIntrinsicRange: boolean;
  reason: string;
}): EvidenceWeightedModelContribution {
  const finalWeight = args.includedInIntrinsicRange && args.perShare != null && args.perShare > 0
    ? clamp(args.baseReliability * (1 - args.evidenceCoveragePenalty) * (1 - args.forecastSkillPenalty) * (1 - (args.priceDerivedPenalty ?? 0)), 0, 1)
    : 0;
  return {
    modelKey: args.modelKey,
    label: args.label,
    independenceGroup: args.independenceGroup,
    perShare: finiteOrNull(args.perShare),
    baseReliability: args.baseReliability,
    evidenceCoveragePenalty: args.evidenceCoveragePenalty,
    forecastSkillPenalty: args.forecastSkillPenalty,
    priceDerivedPenalty: args.priceDerivedPenalty ?? 0,
    finalWeight,
    includedInIntrinsicRange: args.includedInIntrinsicRange && finalWeight > 0,
    reason: args.reason,
  };
}

interface WeightedValue {
  readonly key: string;
  readonly value: number;
  readonly weight: number;
}

/** Deterministic weighted quantile using centred cumulative-weight positions. */
function weightedQuantile(values: readonly WeightedValue[], quantile: number): number | null {
  const eligible = values
    .filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0)
    .sort((left, right) => left.value - right.value || left.key.localeCompare(right.key));
  const totalWeight = eligible.reduce((sum, item) => sum + item.weight, 0);
  if (!eligible.length || totalWeight <= 0) return null;
  if (eligible.length === 1) return eligible[0]!.value;

  const target = clamp(quantile, 0, 1);
  let cumulativeWeight = 0;
  const positioned = eligible.map((item) => {
    const position = (cumulativeWeight + item.weight / 2) / totalWeight;
    cumulativeWeight += item.weight;
    return { ...item, position };
  });
  if (target <= positioned[0]!.position) return positioned[0]!.value;
  if (target >= positioned[positioned.length - 1]!.position) return positioned[positioned.length - 1]!.value;

  for (let index = 1; index < positioned.length; index += 1) {
    const right = positioned[index]!;
    if (target > right.position) continue;
    const left = positioned[index - 1]!;
    const span = right.position - left.position;
    const fraction = span > 0 ? (target - left.position) / span : 0;
    return left.value + (right.value - left.value) * fraction;
  }
  return positioned[positioned.length - 1]!.value;
}

/**
 * Collapse every eligible contribution to one independence-group vote.
 * Repeated results for one model are reduced first, then correlated formulas
 * share one family value and a max-not-sum reliability weight.
 */
export function collapseEvidenceWeightedContributions(
  contributions: readonly EvidenceWeightedModelContribution[],
): CollapsedEvidenceFamilyContribution[] {
  const eligible = contributions.filter(
    (item) => item.includedInIntrinsicRange
      && item.perShare != null
      && Number.isFinite(item.perShare)
      && item.perShare > 0
      && Number.isFinite(item.finalWeight)
      && item.finalWeight > 0,
  );
  const byGroup = new Map<EvidenceIndependenceGroup, EvidenceWeightedModelContribution[]>();
  for (const item of eligible) {
    const members = byGroup.get(item.independenceGroup) ?? [];
    members.push(item);
    byGroup.set(item.independenceGroup, members);
  }

  return [...byGroup.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([independenceGroup, members]) => {
      const byModel = new Map<string, EvidenceWeightedModelContribution[]>();
      for (const member of members) {
        const modelMembers = byModel.get(member.modelKey) ?? [];
        modelMembers.push(member);
        byModel.set(member.modelKey, modelMembers);
      }
      const modelValues: WeightedValue[] = [...byModel.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([modelKey, modelMembers]) => ({
          key: modelKey,
          value: median(modelMembers.map((item) => item.perShare!))!,
          weight: Math.max(...modelMembers.map((item) => item.finalWeight)),
        }));
      return {
        independenceGroup,
        modelKeys: modelValues.map((item) => item.key),
        labels: [...new Set(members.map((item) => item.label))].sort(),
        perShare: weightedQuantile(modelValues, 0.5)!,
        groupWeight: Math.max(...modelValues.map((item) => item.weight)),
        memberContributionCount: members.length,
      };
    });
}

function divergenceMetrics(groups: readonly CollapsedEvidenceFamilyContribution[]) {
  const values = groups.map((item) => item.perShare);
  if (!values.length) {
    return { rawLow: null, rawHigh: null, spreadRatio: null, critical: false };
  }
  const rawLow = Math.min(...values);
  const rawHigh = Math.max(...values);
  if (values.length < 2) {
    return { rawLow, rawHigh, spreadRatio: 0, critical: false };
  }
  const center = weightedQuantile(
    groups.map((item) => ({ key: item.independenceGroup, value: item.perShare, weight: item.groupWeight })),
    0.5,
  ) ?? median(values) ?? rawLow;
  const spreadRatio = (rawHigh - rawLow) / Math.max(Math.abs(center), 1);
  return { rawLow, rawHigh, spreadRatio, critical: spreadRatio > 0.5 };
}

export type EvidenceSynthesisSubstitutionDecision =
  | {
      readonly status: "applied";
      readonly blockerCodes: readonly string[];
      readonly eligibleForIntrinsicSynthesis: true;
      readonly synthesis: EvidenceWeightedValuationSynthesis;
    }
  | {
      readonly status: "blocked";
      readonly blockerCodes: readonly string[];
      readonly eligibleForIntrinsicSynthesis: false;
      readonly synthesis: EvidenceWeightedValuationSynthesis;
    };

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1, Math.abs(left), Math.abs(right)) * 1e-9;
}

function rebuildAfterSubstitution(
  source: EvidenceWeightedValuationSynthesis,
  contributions: EvidenceWeightedModelContribution[],
  trace: EvidenceSynthesisSubstitutionTrace,
): EvidenceWeightedValuationSynthesis {
  const included = contributions.filter((item) => item.includedInIntrinsicRange && item.perShare != null);
  const groups = collapseEvidenceWeightedContributions(contributions);
  const weightedGroups = groups.map((item) => ({ key: item.independenceGroup, value: item.perShare, weight: item.groupWeight }));
  const mid = weightedQuantile(weightedGroups, 0.5);
  const robustLow = weightedQuantile(weightedGroups, 0.2);
  const robustHigh = weightedQuantile(weightedGroups, 0.8);
  const widening = source.intrinsicRange.rangeWideningPct;
  const lowPerShare = robustLow != null && mid != null ? Math.max(0, robustLow * (1 - widening)) : robustLow;
  const highPerShare = robustHigh != null ? robustHigh * (1 + widening) : null;
  const divergence = divergenceMetrics(groups);
  const checklist = source.defensibility.checklist.map((item) => item.key === "paradigm-independence"
    ? { ...item, passed: groups.length >= 2, detail: `${groups.length} independent intrinsic lens group(s) available.` }
    : item);
  const status: EvidenceWeightedValuationSynthesis["defensibility"]["status"] = !included.length
    ? "blocked"
    : checklist.every((item) => item.passed) && !divergence.critical
      ? "confirmed"
      : "guarded";
  const previous = source.compositionDiagnostics;
  return {
    ...source,
    contributions,
    compositionDiagnostics: {
      policyVersion: EVIDENCE_SYNTHESIS_SUBSTITUTION_POLICY_VERSION,
      appliedCount: (previous?.appliedCount ?? 0) + 1,
      dossierHashes: [...(previous?.dossierHashes ?? []), trace.dossierHash],
      targetModelKeys: [...(previous?.targetModelKeys ?? []), contributions.find((item) => item.substitution === trace)!.modelKey],
      totalOptionalityPerShare: (previous?.totalOptionalityPerShare ?? 0) + trace.optionalityPerShare,
      countingPolicy: "replace-exact-base-vote-once",
    },
    independenceDiagnostics: {
      policyVersion: "2026-07-independence-synthesis-v1",
      eligibleContributionCount: included.length,
      independentGroupCount: groups.length,
      correlatedContributionCount: Math.max(included.length - groups.length, 0),
      weightingPolicy: "maximum-member-reliability",
      familyValuePolicy: "reliability-weighted-median",
      rangePolicy: "weighted-p20-p80",
      groups,
      rawLowPerShare: divergence.rawLow,
      rawHighPerShare: divergence.rawHigh,
      robustLowPerShare: robustLow,
      robustHighPerShare: robustHigh,
      maximumGroupSpreadRatio: divergence.spreadRatio,
      criticalDivergence: divergence.critical,
    },
    intrinsicRange: { lowPerShare, midPerShare: mid, highPerShare, rangeWideningPct: widening },
    defensibility: {
      status,
      checklist,
      summary: status === "confirmed"
        ? "Intrinsic range includes a governed exact-base substitution and remains supported by independent non-price lenses."
        : status === "blocked"
          ? "Intrinsic defensibility is blocked after governed composition because no eligible intrinsic evidence remains."
          : divergence.critical
            ? "Intrinsic range is guarded after governed composition because independent lenses diverge materially."
            : "Intrinsic range includes a governed exact-base substitution but remains guarded by evidence or independence limits.",
    },
  };
}

/**
 * Replace one exact intrinsic vote with its governed composed value. The
 * adjustment never becomes a new contribution or an additional family vote.
 */
export function substituteEvidenceWeightedSynthesisContribution(input: {
  readonly synthesis: EvidenceWeightedValuationSynthesis;
  readonly targetModelKey: string;
  readonly targetIndependenceGroup: EvidenceIndependenceGroup;
  readonly dossierHash: `sha256:${string}`;
  readonly baseModelId: string;
  readonly baseCaseId: string | null;
  readonly basePerShare: number;
  readonly optionalityPerShare: number;
  readonly composedPerShare: number;
  readonly evidenceRefs: readonly string[];
  readonly transformationRefs: readonly string[];
}): EvidenceSynthesisSubstitutionDecision {
  const blockers: string[] = [];
  if (!/^sha256:[0-9a-f]{64}$/.test(input.dossierHash)) blockers.push("SUBSTITUTION_DOSSIER_HASH_INVALID");
  if (!input.targetModelKey.trim() || !input.targetIndependenceGroup.trim()) blockers.push("SUBSTITUTION_TARGET_INVALID");
  if (!(Number.isFinite(input.basePerShare) && input.basePerShare > 0 && Number.isFinite(input.optionalityPerShare) && input.optionalityPerShare > 0 && Number.isFinite(input.composedPerShare) && input.composedPerShare > 0) || !approximatelyEqual(input.composedPerShare, input.basePerShare + input.optionalityPerShare)) blockers.push("SUBSTITUTION_VALUE_BRIDGE_INVALID");
  if (!input.evidenceRefs.length || !input.transformationRefs.length || input.evidenceRefs.some((ref) => !ref.trim()) || input.transformationRefs.some((ref) => !ref.trim())) blockers.push("SUBSTITUTION_LINEAGE_REQUIRED");
  const targets = input.synthesis.contributions.filter((item) => item.modelKey === input.targetModelKey && item.independenceGroup === input.targetIndependenceGroup);
  if (targets.length !== 1) blockers.push(targets.length ? "SUBSTITUTION_TARGET_AMBIGUOUS" : "SUBSTITUTION_TARGET_MISSING");
  const target = targets[0];
  if (target && (!target.includedInIntrinsicRange || target.perShare == null || !approximatelyEqual(target.perShare, input.basePerShare))) blockers.push("SUBSTITUTION_BASE_VALUE_MISMATCH");
  if (target?.substitution) blockers.push("SUBSTITUTION_TARGET_ALREADY_REPLACED");
  if (input.synthesis.contributions.some((item) => item.substitution?.dossierHash === input.dossierHash)) blockers.push("SUBSTITUTION_DOSSIER_ALREADY_APPLIED");
  if (blockers.length || !target) return { status: "blocked", blockerCodes: [...new Set(blockers)], eligibleForIntrinsicSynthesis: false, synthesis: input.synthesis };
  const trace: EvidenceSynthesisSubstitutionTrace = {
    policyVersion: EVIDENCE_SYNTHESIS_SUBSTITUTION_POLICY_VERSION,
    dossierHash: input.dossierHash,
    baseModelId: input.baseModelId,
    baseCaseId: input.baseCaseId,
    basePerShare: input.basePerShare,
    optionalityPerShare: input.optionalityPerShare,
    composedPerShare: input.composedPerShare,
    evidenceRefs: [...new Set(input.evidenceRefs)],
    transformationRefs: [...new Set(input.transformationRefs)],
  };
  const contributions = input.synthesis.contributions.map((item) => item === target
    ? { ...item, perShare: input.composedPerShare, substitution: trace, reason: `${item.reason} Governed real-options composition replaced this exact base vote; no additional vote was added.` }
    : item);
  return { status: "applied", blockerCodes: [], eligibleForIntrinsicSynthesis: true, synthesis: rebuildAfterSubstitution(input.synthesis, contributions, trace) };
}

export function buildEvidenceWeightedSynthesis(args: {
  scenarios: ValuationScenarioCard[];
  cashFlowDcf: CashFlowDcfResult | null;
  evEbitdaPerShare: number | null;
  reverseDcf: ReverseDcfDiagnostics | null;
  evidenceLedger: ValuationEvidenceLedger;
  forecastHoldout: ForecastHoldoutSummary;
  marketPrice: number | null;
}): EvidenceWeightedValuationSynthesis {
  const card = baseScenario(args.scenarios);
  const evidenceCoveragePenalty = args.evidenceLedger.summary.total > 0
    ? clamp(args.evidenceLedger.summary.unsupportedCount / args.evidenceLedger.summary.total, 0, 0.5)
    : 0.5;
  const forecastSkillPenalty = args.forecastHoldout.aggregate.confidencePenaltyPct;
  const contributions: EvidenceWeightedModelContribution[] = [
    contribution({
      modelKey: "accrual-riv-reoi",
      label: "Accrual RIV/ReOI family",
      independenceGroup: "accrual-history",
      perShare: accrualPerShare(card),
      baseReliability: 0.62,
      evidenceCoveragePenalty,
      forecastSkillPenalty,
      includedInIntrinsicRange: true,
      reason: "RE and ReOI are treated as one accrual-history family, not two independent confirmations.",
    }),
    contribution({
      modelKey: "cash-fcff-dcf",
      label: "Cash-statement FCFF DCF",
      independenceGroup: "cash-statement",
      perShare: args.cashFlowDcf?.perShare ?? null,
      baseReliability: 0.72,
      evidenceCoveragePenalty: Math.min(evidenceCoveragePenalty, 0.3),
      forecastSkillPenalty,
      includedInIntrinsicRange: Boolean(args.cashFlowDcf?.perShare != null && args.cashFlowDcf.perShare > 0),
      reason: args.cashFlowDcf
        ? "Direct cash-statement FCFF lens; independent from the NOA/OI accrual algebra."
        : "Cash-statement FCFF lens unavailable or skipped honestly.",
    }),
    contribution({
      modelKey: "relative-ev-ebitda",
      label: "Relative EV/EBITDA cross-check",
      independenceGroup: "peer-market",
      perShare: args.evEbitdaPerShare,
      baseReliability: 0.38,
      evidenceCoveragePenalty: args.evEbitdaPerShare == null ? 0.5 : evidenceCoveragePenalty,
      forecastSkillPenalty: Math.min(forecastSkillPenalty, 0.15),
      includedInIntrinsicRange: args.evEbitdaPerShare != null && args.evEbitdaPerShare > 0,
      reason: args.evEbitdaPerShare != null
        ? "Peer-market lens included at a lower weight because multiples challenge assumptions but should not dominate intrinsic value."
        : "Peer-market lens unavailable because usable peer multiple data is missing.",
    }),
    contribution({
      modelKey: "reverse-dcf",
      label: "Reverse DCF market-implied expectations",
      independenceGroup: "market-price",
      perShare: args.marketPrice,
      baseReliability: 0,
      evidenceCoveragePenalty: 0,
      forecastSkillPenalty: 0,
      priceDerivedPenalty: 1,
      includedInIntrinsicRange: false,
      reason: "Reverse DCF is quarantined: it explains market expectations but carries zero intrinsic-range weight.",
    }),
  ];

  const included = contributions.filter((item) => item.includedInIntrinsicRange && item.perShare != null);
  const collapsedGroups = collapseEvidenceWeightedContributions(contributions);
  const weightedGroups = collapsedGroups.map((item) => ({
    key: item.independenceGroup,
    value: item.perShare,
    weight: item.groupWeight,
  }));
  const mid = weightedQuantile(weightedGroups, 0.5);
  const robustLow = weightedQuantile(weightedGroups, 0.2);
  const robustHigh = weightedQuantile(weightedGroups, 0.8);
  const widening = args.forecastHoldout.aggregate.valuationRangeWideningPct;
  const lowPerShare = robustLow != null && mid != null ? Math.max(0, robustLow * (1 - widening)) : robustLow;
  const highPerShare = robustHigh != null ? robustHigh * (1 + widening) : null;
  const uniqueIntrinsicGroups = new Set(collapsedGroups.map((item) => item.independenceGroup));
  const priceDerivedMisuse = args.evidenceLedger.rows.filter((row) => row.priceDerived && row.eligibleForIntrinsicConfidence).length;
  const divergence = divergenceMetrics(collapsedGroups);
  const diverged = divergence.critical;
  const checklist = [
    {
      key: "assumption-evidence" as const,
      label: "Assumptions independently sourced",
      passed: args.evidenceLedger.summary.unsupportedCount === args.evidenceLedger.summary.priceDerivedCount,
      detail: `${args.evidenceLedger.summary.unsupportedCount} unsupported rows; price-derived rows are expected to be unsupported.`,
    },
    {
      key: "forecast-holdout-skill" as const,
      label: "Forecast holdout skill",
      passed: args.forecastHoldout.aggregate.status === "confirmed",
      detail: `Holdout status ${args.forecastHoldout.aggregate.status}; weighted MAPE ${args.forecastHoldout.aggregate.weightedMape == null ? "n/a" : (args.forecastHoldout.aggregate.weightedMape * 100).toFixed(1) + "%"}.`,
    },
    {
      key: "price-derived-isolation" as const,
      label: "Price-derived assumptions excluded",
      passed: priceDerivedMisuse === 0,
      detail: `${priceDerivedMisuse} price-derived assumption(s) eligible for intrinsic confidence.`,
    },
    {
      key: "paradigm-independence" as const,
      label: "Independent valuation lenses",
      passed: uniqueIntrinsicGroups.size >= 2,
      detail: `${uniqueIntrinsicGroups.size} independent intrinsic lens group(s) available.`,
    },
    {
      key: "range-widening" as const,
      label: "Range widened for weak evidence",
      passed: widening >= 0,
      detail: `Intrinsic range widened by ${(widening * 100).toFixed(1)}% for forecast/evidence quality.`,
    },
  ];

  const status: EvidenceWeightedValuationSynthesis["defensibility"]["status"] =
    priceDerivedMisuse > 0 || !included.length
      ? "blocked"
      : checklist.every((item) => item.passed) && !diverged
        ? "confirmed"
        : "guarded";

  return {
    contributions,
    independenceDiagnostics: {
      policyVersion: "2026-07-independence-synthesis-v1",
      eligibleContributionCount: included.length,
      independentGroupCount: collapsedGroups.length,
      correlatedContributionCount: Math.max(included.length - collapsedGroups.length, 0),
      weightingPolicy: "maximum-member-reliability",
      familyValuePolicy: "reliability-weighted-median",
      rangePolicy: "weighted-p20-p80",
      groups: collapsedGroups,
      rawLowPerShare: divergence.rawLow,
      rawHighPerShare: divergence.rawHigh,
      robustLowPerShare: robustLow,
      robustHighPerShare: robustHigh,
      maximumGroupSpreadRatio: divergence.spreadRatio,
      criticalDivergence: diverged,
    },
    intrinsicRange: {
      lowPerShare,
      midPerShare: mid,
      highPerShare,
      rangeWideningPct: widening,
    },
    marketExpectationRange: {
      pricePerShare: args.marketPrice,
      requiredGrowth: args.reverseDcf?.impliedOwnerEarningsGrowth ?? null,
      requiredRnoa: args.reverseDcf?.impliedTerminalROIC ?? null,
      saturated: Boolean(
        (args.reverseDcf?.impliedOwnerEarningsGrowth ?? 0) >= 0.4
        || (args.reverseDcf?.impliedTerminalROIC ?? 0) >= 0.8,
      ),
    },
    defensibility: {
      status,
      checklist,
      summary: status === "confirmed"
        ? "Intrinsic range is supported by multiple independent non-price lenses and confirmed holdout evidence."
        : status === "blocked"
          ? "Intrinsic defensibility is blocked because price-derived or missing evidence would otherwise contaminate confidence."
          : diverged
            ? "Intrinsic range is guarded because independent lenses diverge materially."
            : "Intrinsic range is usable but guarded because evidence, forecast skill, or lens independence is incomplete.",
    },
  };
}
