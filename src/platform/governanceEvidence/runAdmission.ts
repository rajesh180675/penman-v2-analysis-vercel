import type { AnalysisRunDraftV1, AnalysisRunV1 } from "../../engine/analysisRun";
import {
  evaluateModelPromotion,
  evaluateRealOptionsCompositionApproval,
  type ApprovedRealOptionsCompositionPolicy,
  type GovernedAdvancedModelInput,
  type ModelPromotionDecision,
  type ModelPromotionDossier,
  type RealOptionsCompositionCandidate,
} from "../../engine/advancedModelGovernance";
import { CURRENT_MODEL_REGISTRY } from "../../engine/modelCatalog";
import type { EvidenceSynthesisSubstitutionTrace } from "../../engine/valuationEvidence";
import { canonicalize, reproducibilityHash } from "../../lib/evidenceLocking";
import type { ArtifactPayload } from "../artifactRepository";
import type { RunGovernanceAdmissionVerifier } from "../analysisPlatformService";
import type { WorkspaceAccessContext } from "../workspaceScope";
import type { GovernanceEvidenceRepository, StoredPromotionReview } from "./contracts";

export const RUN_GOVERNANCE_ADMISSION_VERSION = "2026-07-run-governance-admission-v1" as const;

export class RunGovernanceAdmissionError extends Error {
  readonly code = "RUN_GOVERNANCE_ATTESTATION_INVALID";
  readonly status = 409;

  constructor(readonly blockerCodes: readonly string[]) {
    super(`Run governance attestation failed: ${blockerCodes.join(", ")}.`);
    this.name = "RunGovernanceAdmissionError";
  }
}

interface PersistedAdvancedExecution {
  readonly request?: GovernedAdvancedModelInput;
  readonly promotionDossierHash?: string | null;
  readonly promotionDossier?: ModelPromotionDossier | null;
  readonly promotion?: ModelPromotionDecision;
  readonly compositionPolicy?: ApprovedRealOptionsCompositionPolicy | null;
  readonly compositionCandidate?: RealOptionsCompositionCandidate | null;
}

interface AppliedSubstitution {
  readonly targetModelKey: string;
  readonly independenceGroup: string;
  readonly trace: EvidenceSynthesisSubstitutionTrace;
}

function parseArtifact(artifact: ArtifactPayload): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(artifact.bytes));
  } catch {
    throw new RunGovernanceAdmissionError(["GOVERNANCE_ARTIFACT_JSON_INVALID"]);
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(left as Record<string, unknown>) === canonicalize(right as Record<string, unknown>);
  } catch {
    return false;
  }
}

function derivedPromotionDecision(modelId: string, dossier: ModelPromotionDossier, reviews: readonly StoredPromotionReview[]): ModelPromotionDecision {
  let decision = evaluateModelPromotion(CURRENT_MODEL_REGISTRY.require(modelId), dossier);
  if (reviews.some((review) => review.decision === "rejected")) decision = Object.freeze({
    ...decision,
    status: "blocked" as const,
    eligibleLifecycle: null,
    blockerCodes: Object.freeze([...new Set([...decision.blockerCodes, "REVIEW_REJECTED"])]),
    checkResults: Object.freeze([...decision.checkResults, {
      checkId: "NO_REJECTING_REVIEW",
      passed: false,
      summary: "A recorded reviewer rejected this promotion dossier.",
    }]),
  });
  return decision;
}

function promotionDossierWithAuthenticatedReviews(record: ModelPromotionDossier, reviews: readonly StoredPromotionReview[]): ModelPromotionDossier {
  const approved = reviews.filter((review) => review.decision === "approved");
  return {
    ...record,
    reviewerPrincipalIds: approved.map((review) => review.reviewerPrincipalId),
    evidenceRefs: [...new Set([...record.evidenceRefs, ...approved.map((review) => review.evidenceRef)])],
  };
}

function readAdvancedExecutions(artifacts: readonly ArtifactPayload[]): PersistedAdvancedExecution[] {
  return artifacts.flatMap((artifact) => {
    if (artifact.ref.kind !== "evidence" || artifact.ref.schemaVersion !== "2026-07-governed-advanced-model-execution-v5") return [];
    const payload = objectValue(parseArtifact(artifact));
    const execution = objectValue(payload?.execution);
    return execution ? [execution as unknown as PersistedAdvancedExecution] : [];
  });
}

function readAppliedSubstitutions(artifacts: readonly ArtifactPayload[]): AppliedSubstitution[] {
  return artifacts.flatMap((artifact) => {
    if (artifact.ref.kind !== "synthesis") return [];
    const payload = objectValue(parseArtifact(artifact));
    const synthesis = objectValue(payload?.synthesis);
    const contributions = Array.isArray(synthesis?.contributions) ? synthesis.contributions : [];
    return contributions.flatMap((raw) => {
      const item = objectValue(raw);
      const trace = objectValue(item?.substitution);
      return item && trace
        ? [{ targetModelKey: String(item.modelKey ?? ""), independenceGroup: String(item.independenceGroup ?? ""), trace: trace as unknown as EvidenceSynthesisSubstitutionTrace }]
        : [];
    });
  });
}

function validateExecutionTrace(execution: PersistedAdvancedExecution, applied: AppliedSubstitution): string[] {
  const blockers: string[] = [];
  const policy = execution.compositionPolicy;
  const candidate = execution.compositionCandidate;
  if (!policy || policy.dossierHash !== applied.trace.dossierHash) blockers.push("COMPOSITION_POLICY_TRACE_MISMATCH");
  if (!candidate || candidate.status !== "eligible-candidate") blockers.push("COMPOSITION_CANDIDATE_TRACE_MISSING");
  if (candidate?.status === "eligible-candidate") {
    if (
      candidate.dossierHash !== applied.trace.dossierHash
      || candidate.baseModelId !== applied.trace.baseModelId
      || candidate.baseCaseId !== applied.trace.baseCaseId
      || candidate.synthesisTargetModelKey !== applied.targetModelKey
      || candidate.synthesisTargetIndependenceGroup !== applied.independenceGroup
      || candidate.basePerShare !== applied.trace.basePerShare
      || candidate.optionalityPerShare !== applied.trace.optionalityPerShare
      || candidate.composedPerShare !== applied.trace.composedPerShare
    ) blockers.push("COMPOSITION_CANDIDATE_TRACE_MISMATCH");
  }
  return blockers;
}

/**
 * Production admission guard. Client-produced artifacts remain untrusted until
 * their exact promotion and composition records are reconstructed from the
 * authenticated workspace repository.
 */
export class GovernedRunAdmissionVerifier implements RunGovernanceAdmissionVerifier {
  constructor(private readonly repository: GovernanceEvidenceRepository) {}

  async verify(
    context: WorkspaceAccessContext,
    run: AnalysisRunDraftV1 | AnalysisRunV1,
    artifacts: readonly ArtifactPayload[],
  ): Promise<void> {
    const blockers: string[] = [];
    const substitutions = readAppliedSubstitutions(artifacts);
    const executions = readAdvancedExecutions(artifacts);
    const dossierHashes = substitutions.map((item) => item.trace.dossierHash);
    if (new Set(dossierHashes).size !== dossierHashes.length) blockers.push("COMPOSITION_DOSSIER_APPLIED_MULTIPLE_TIMES");

    for (const applied of substitutions) {
      const matching = executions.filter((execution) => execution.compositionPolicy?.dossierHash === applied.trace.dossierHash);
      if (matching.length !== 1) {
        blockers.push(matching.length ? "COMPOSITION_EXECUTION_AMBIGUOUS" : "COMPOSITION_EXECUTION_MISSING");
        continue;
      }
      const execution = matching[0]!;
      blockers.push(...validateExecutionTrace(execution, applied));
      const policy = execution.compositionPolicy!;
      if (policy.dossier.issuerId !== run.issuerId || policy.dossier.effectiveAsOf > run.asOf) blockers.push("COMPOSITION_RUN_BINDING_MISMATCH");
      if (!execution.request || policy.dossier.advancedInputHash !== `sha256:${await reproducibilityHash(execution.request as unknown as Record<string, unknown>)}`) blockers.push("ADVANCED_INPUT_DURABLE_HASH_MISMATCH");

      const compositionRecords = await this.repository.listCompositionDossiers(context.scope, run.issuerId, policy.dossier.sidecarId);
      const compositionRecord = compositionRecords.find((record) => record.dossierHash === policy.dossierHash);
      if (!compositionRecord) {
        blockers.push("COMPOSITION_DURABLE_DOSSIER_MISSING");
      } else {
        const reviews = await this.repository.listCompositionReviews(context.scope, compositionRecord.dossierHash);
        const decision = evaluateRealOptionsCompositionApproval(compositionRecord.dossierHash, compositionRecord.dossier, reviews);
        if (decision.status !== "approved") blockers.push("COMPOSITION_DURABLE_APPROVAL_BLOCKED", ...decision.blockerCodes);
        else if (!sameCanonical(decision.policy, policy)) blockers.push("COMPOSITION_DURABLE_POLICY_MISMATCH");
      }

      const promotionHash = execution.promotionDossierHash;
      const modelId = execution.request?.modelId ?? "";
      if (!promotionHash || !/^sha256:[0-9a-f]{64}$/.test(promotionHash) || !modelId) {
        blockers.push("PROMOTION_ATTESTATION_MISSING");
      } else {
        const promotionRecord = (await this.repository.listPromotionDossiers(context.scope, modelId))
          .find((record) => record.dossierHash === promotionHash);
        if (!promotionRecord) {
          blockers.push("PROMOTION_DURABLE_DOSSIER_MISSING");
        } else {
          const reviews = await this.repository.listPromotionReviews(context.scope, promotionHash);
          const dossier = promotionDossierWithAuthenticatedReviews(promotionRecord.dossier, reviews);
          const decision = derivedPromotionDecision(modelId, dossier, reviews);
          if (decision.status !== "eligible") blockers.push("PROMOTION_DURABLE_APPROVAL_BLOCKED", ...decision.blockerCodes);
          if (!sameCanonical(execution.promotionDossier, dossier)) blockers.push("PROMOTION_DURABLE_DOSSIER_MISMATCH");
          if (!sameCanonical(execution.promotion, decision)) blockers.push("PROMOTION_DURABLE_DECISION_MISMATCH");
        }
      }
    }

    if (run.status === "completed") {
      const suppliedCompositionPolicies = executions.filter((execution) => execution.compositionPolicy != null);
      if (suppliedCompositionPolicies.length !== substitutions.length) blockers.push("COMPOSITION_COMPLETED_RUN_COUNT_MISMATCH");
    }
    if (blockers.length) throw new RunGovernanceAdmissionError([...new Set(blockers)]);
  }
}
