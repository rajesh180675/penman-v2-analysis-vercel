import type { ValuationModelResult } from "../modelCatalog";
import { substituteEvidenceWeightedSynthesisContribution, type EvidenceSynthesisSubstitutionDecision } from "../valuationEvidence/evidenceWeightedSynthesis";
import type { EvidenceIndependenceGroup, EvidenceWeightedValuationSynthesis } from "../valuationEvidence/types";
import type { GovernedAdvancedModelInput, GovernedAdvancedModelResult } from "./execution";

export const REAL_OPTIONS_COMPOSITION_SCHEMA_VERSION = "2026-07-real-options-composition-v3" as const;

export interface RealOptionsCompositionDossier {
  readonly modelId: "advanced.real-options-rd-pipeline";
  readonly issuerId: string;
  readonly sidecarId: string;
  readonly effectiveAsOf: string;
  readonly baseModelId: string;
  readonly baseCaseId: string | null;
  readonly baseExcludesOptionality: boolean;
  readonly synthesisTargetModelKey: string;
  readonly synthesisTargetIndependenceGroup: EvidenceIndependenceGroup;
  readonly substitutionMode: "replace-exact-base-vote-once";
  /** SHA-256 of the exact GovernedAdvancedModelInput reviewed for composition. */
  readonly advancedInputHash: `sha256:${string}`;
  readonly excludedProjectIds: readonly string[];
  readonly maximumAdjustmentToBaseRatio: number;
  readonly evidenceRefs: readonly string[];
  readonly transformationRefs: readonly string[];
}

export interface CompositionPolicyReviewEvidence {
  readonly reviewerPrincipalId: string;
  readonly decision: "approved" | "rejected";
  readonly evidenceRef: string;
  readonly reviewedAt: string;
}

export interface ApprovedRealOptionsCompositionPolicy {
  readonly schemaVersion: typeof REAL_OPTIONS_COMPOSITION_SCHEMA_VERSION;
  readonly dossierHash: `sha256:${string}`;
  readonly dossier: RealOptionsCompositionDossier;
  readonly reviewerPrincipalIds: readonly string[];
  readonly reviewEvidenceRefs: readonly string[];
  readonly approvedAt: string;
}

export type RealOptionsCompositionApprovalDecision =
  | { readonly status: "approved"; readonly blockerCodes: readonly string[]; readonly policy: ApprovedRealOptionsCompositionPolicy }
  | { readonly status: "blocked"; readonly blockerCodes: readonly string[]; readonly policy: null };

function dateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nonblankUnique(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => value.trim()) && new Set(values).size === values.length;
}

const SYNTHESIS_TARGET_BY_BASE_MODEL: Readonly<Record<string, {
  readonly caseId: string;
  readonly modelKey: string;
  readonly independenceGroup: EvidenceIndependenceGroup;
}>> = Object.freeze({
  "industrial.penman.residual-income": { caseId: "base", modelKey: "accrual-riv-reoi", independenceGroup: "accrual-history" },
  "industrial.penman.residual-operating-income": { caseId: "base", modelKey: "accrual-riv-reoi", independenceGroup: "accrual-history" },
  "industrial.cash-statement-fcff-dcf": { caseId: "base", modelKey: "cash-fcff-dcf", independenceGroup: "cash-statement" },
  "industrial.ev-ebitda-peer": { caseId: "base", modelKey: "relative-ev-ebitda", independenceGroup: "peer-market" },
});

function hasAuthoritativeSynthesisTarget(dossier: RealOptionsCompositionDossier): boolean {
  const expected = SYNTHESIS_TARGET_BY_BASE_MODEL[dossier.baseModelId];
  return Boolean(expected
    && dossier.baseCaseId === expected.caseId
    && dossier.synthesisTargetModelKey === expected.modelKey
    && dossier.synthesisTargetIndependenceGroup === expected.independenceGroup);
}

export function evaluateRealOptionsCompositionApproval(
  dossierHash: string,
  dossier: RealOptionsCompositionDossier,
  reviews: readonly CompositionPolicyReviewEvidence[],
): RealOptionsCompositionApprovalDecision {
  const blockers: string[] = [];
  if (!/^sha256:[0-9a-f]{64}$/.test(dossierHash)) blockers.push("DOSSIER_HASH_INVALID");
  if (dossier.modelId !== "advanced.real-options-rd-pipeline") blockers.push("MODEL_MISMATCH");
  if (!dossier.issuerId.trim() || !dossier.sidecarId.trim() || !dossier.baseModelId.trim() || (dossier.baseCaseId !== null && !dossier.baseCaseId.trim()) || !dateOnly(dossier.effectiveAsOf)) blockers.push("BINDING_INVALID");
  if (!dossier.baseExcludesOptionality) blockers.push("BASE_OPTIONALITY_EXCLUSION_REQUIRED");
  if (!dossier.synthesisTargetModelKey.trim() || !dossier.synthesisTargetIndependenceGroup.trim() || dossier.substitutionMode !== "replace-exact-base-vote-once") blockers.push("SYNTHESIS_TARGET_INVALID");
  if (!/^sha256:[0-9a-f]{64}$/.test(dossier.advancedInputHash)) blockers.push("ADVANCED_INPUT_HASH_INVALID");
  if (!hasAuthoritativeSynthesisTarget(dossier)) blockers.push("SYNTHESIS_TARGET_MODEL_BINDING_INVALID");
  if (!nonblankUnique(dossier.excludedProjectIds)) blockers.push("EXCLUDED_PROJECTS_INVALID");
  if (!(dossier.maximumAdjustmentToBaseRatio > 0 && dossier.maximumAdjustmentToBaseRatio <= 1)) blockers.push("ADJUSTMENT_LIMIT_INVALID");
  if (!nonblankUnique(dossier.evidenceRefs) || !nonblankUnique(dossier.transformationRefs)) blockers.push("POLICY_LINEAGE_REQUIRED");
  if (reviews.some((review) => review.decision === "rejected")) blockers.push("REVIEW_REJECTED");
  const approvals = reviews.filter((review) => review.decision === "approved" && review.reviewerPrincipalId.trim() && review.evidenceRef.trim() && Number.isFinite(Date.parse(review.reviewedAt)));
  if (new Set(approvals.map((review) => review.reviewerPrincipalId)).size < 2) blockers.push("DUAL_REVIEW_REQUIRED");
  if (new Set(approvals.map((review) => review.evidenceRef)).size < 2) blockers.push("INDEPENDENT_REVIEW_EVIDENCE_REQUIRED");
  if (blockers.length) return Object.freeze({ status: "blocked", blockerCodes: Object.freeze([...new Set(blockers)]), policy: null });
  const approvedAt = approvals.map((review) => new Date(review.reviewedAt).toISOString()).sort().at(-1)!;
  return Object.freeze({
    status: "approved",
    blockerCodes: Object.freeze([]),
    policy: Object.freeze({
      schemaVersion: REAL_OPTIONS_COMPOSITION_SCHEMA_VERSION,
      dossierHash: dossierHash as `sha256:${string}`,
      dossier: structuredClone(dossier),
      reviewerPrincipalIds: Object.freeze([...new Set(approvals.map((review) => review.reviewerPrincipalId))]),
      reviewEvidenceRefs: Object.freeze([...new Set(approvals.map((review) => review.evidenceRef))]),
      approvedAt,
    }),
  });
}

export type RealOptionsCompositionCandidate =
  | {
      readonly status: "eligible-candidate";
      readonly baseModelId: string;
      readonly baseCaseId: string | null;
      readonly basePerShare: number;
      readonly optionalityPerShare: number;
      readonly composedPerShare: number;
      readonly adjustmentToBaseRatio: number;
      readonly dossierHash: `sha256:${string}`;
      readonly synthesisTargetModelKey: string;
      readonly synthesisTargetIndependenceGroup: EvidenceIndependenceGroup;
      readonly evidenceRefs: readonly string[];
      readonly transformationRefs: readonly string[];
      readonly eligibleForIntrinsicSynthesis: false;
    }
  | { readonly status: "blocked"; readonly blockerCodes: readonly string[]; readonly eligibleForIntrinsicSynthesis: false };

export function evaluateRealOptionsCompositionCandidate(input: {
  readonly request: Extract<GovernedAdvancedModelInput, { modelId: "advanced.real-options-rd-pipeline" }>;
  readonly result: GovernedAdvancedModelResult;
  readonly policy: ApprovedRealOptionsCompositionPolicy;
  readonly baseResult: ValuationModelResult | null;
}): RealOptionsCompositionCandidate {
  const blockers: string[] = [];
  const dossier = input.policy.dossier;
  const base = input.baseResult;
  const reconstructedApproval = evaluateRealOptionsCompositionApproval(input.policy.dossierHash, dossier, input.policy.reviewerPrincipalIds.map((reviewerPrincipalId, index) => ({
    reviewerPrincipalId,
    decision: "approved" as const,
    evidenceRef: input.policy.reviewEvidenceRefs[index] ?? "",
    reviewedAt: input.policy.approvedAt,
  })));
  if (input.policy.schemaVersion !== REAL_OPTIONS_COMPOSITION_SCHEMA_VERSION || reconstructedApproval.status !== "approved") blockers.push("POLICY_APPROVAL_INVALID");
  if (input.result.status !== "computed" || !input.result.eligibleForProductionUse || !input.result.eligibleForIntrinsicComposition || !input.result.valuationBridge) blockers.push("ADVANCED_RESULT_NOT_COMPOSABLE");
  if (dossier.issuerId !== input.request.issuerId || dossier.sidecarId !== input.request.sidecarId || dossier.effectiveAsOf > input.request.asOf || input.policy.approvedAt.slice(0, 10) > input.request.asOf) blockers.push("POLICY_BINDING_MISMATCH");
  const requestedProjects = [...new Set(input.request.input.projects.map((project) => project.id))].sort();
  const excludedProjects = [...dossier.excludedProjectIds].sort();
  if (requestedProjects.length !== excludedProjects.length || requestedProjects.some((project, index) => project !== excludedProjects[index])) blockers.push("PROJECT_EXCLUSION_MISMATCH");
  if (!base || base.status !== "computed" || base.modelId !== dossier.baseModelId || base.caseId !== dossier.baseCaseId || !(base.perShare != null && Number.isFinite(base.perShare) && base.perShare > 0) || !base.evidenceRefs.length) blockers.push("BASE_RESULT_MISMATCH");
  if (blockers.length || input.result.status !== "computed" || !input.result.valuationBridge || !base || base.status !== "computed" || base.perShare == null) {
    return Object.freeze({ status: "blocked", blockerCodes: Object.freeze([...new Set(blockers)]), eligibleForIntrinsicSynthesis: false });
  }
  const optionalityPerShare = input.result.valuationBridge.perShareAdjustment;
  const adjustmentToBaseRatio = optionalityPerShare / base.perShare;
  if (!(optionalityPerShare > 0) || !Number.isFinite(adjustmentToBaseRatio) || adjustmentToBaseRatio > dossier.maximumAdjustmentToBaseRatio) {
    return Object.freeze({ status: "blocked", blockerCodes: Object.freeze(["ADJUSTMENT_LIMIT_EXCEEDED"]), eligibleForIntrinsicSynthesis: false });
  }
  return Object.freeze({
    status: "eligible-candidate",
    baseModelId: base.modelId,
    baseCaseId: base.caseId,
    basePerShare: base.perShare,
    optionalityPerShare,
    composedPerShare: base.perShare + optionalityPerShare,
    adjustmentToBaseRatio,
    dossierHash: input.policy.dossierHash,
    synthesisTargetModelKey: dossier.synthesisTargetModelKey,
    synthesisTargetIndependenceGroup: dossier.synthesisTargetIndependenceGroup,
    evidenceRefs: Object.freeze([...new Set([...base.evidenceRefs, ...input.result.evidenceRefs, ...dossier.evidenceRefs, ...input.policy.reviewEvidenceRefs])]),
    transformationRefs: Object.freeze([...new Set([...base.transformationRefs, ...input.result.transformationRefs, ...dossier.transformationRefs])]),
    // Activation is a separate audited step that must replace this exact base
    // vote; the candidate itself is never a standalone synthesis contribution.
    eligibleForIntrinsicSynthesis: false,
  });
}

/**
 * Activate a reviewed candidate only by replacing its exact named synthesis
 * vote. Candidate evaluation and activation remain separate audit events.
 */
export function applyRealOptionsCompositionCandidate(input: {
  readonly synthesis: EvidenceWeightedValuationSynthesis;
  readonly policy: ApprovedRealOptionsCompositionPolicy;
  readonly candidate: RealOptionsCompositionCandidate;
}): EvidenceSynthesisSubstitutionDecision {
  if (input.candidate.status !== "eligible-candidate") {
    return {
      status: "blocked",
      blockerCodes: ["COMPOSITION_CANDIDATE_NOT_ELIGIBLE", ...input.candidate.blockerCodes],
      eligibleForIntrinsicSynthesis: false,
      synthesis: input.synthesis,
    };
  }
  const dossier = input.policy.dossier;
  if (
    input.policy.schemaVersion !== REAL_OPTIONS_COMPOSITION_SCHEMA_VERSION
    || input.candidate.dossierHash !== input.policy.dossierHash
    || input.candidate.baseModelId !== dossier.baseModelId
    || input.candidate.baseCaseId !== dossier.baseCaseId
    || input.candidate.synthesisTargetModelKey !== dossier.synthesisTargetModelKey
    || input.candidate.synthesisTargetIndependenceGroup !== dossier.synthesisTargetIndependenceGroup
    || dossier.substitutionMode !== "replace-exact-base-vote-once"
  ) {
    return { status: "blocked", blockerCodes: ["COMPOSITION_ACTIVATION_BINDING_MISMATCH"], eligibleForIntrinsicSynthesis: false, synthesis: input.synthesis };
  }
  return substituteEvidenceWeightedSynthesisContribution({
    synthesis: input.synthesis,
    targetModelKey: dossier.synthesisTargetModelKey,
    targetIndependenceGroup: dossier.synthesisTargetIndependenceGroup,
    dossierHash: input.policy.dossierHash,
    baseModelId: input.candidate.baseModelId,
    baseCaseId: input.candidate.baseCaseId,
    basePerShare: input.candidate.basePerShare,
    optionalityPerShare: input.candidate.optionalityPerShare,
    composedPerShare: input.candidate.composedPerShare,
    evidenceRefs: input.candidate.evidenceRefs,
    transformationRefs: input.candidate.transformationRefs,
  });
}
