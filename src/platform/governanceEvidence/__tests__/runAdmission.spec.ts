import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { AnalysisRunDraftV1 } from "../../../engine/analysisRun";
import {
  evaluateModelPromotion,
  evaluateRealOptionsCompositionApproval,
  type ModelPromotionDossier,
  type RealOptionsCompositionDossier,
} from "../../../engine/advancedModelGovernance";
import { CURRENT_MODEL_REGISTRY } from "../../../engine/modelCatalog";
import type { ArtifactPayload } from "../../artifactRepository";
import type { WorkspaceAccessContext, WorkspaceScope } from "../../workspaceScope";
import type { GovernanceEvidenceRepository, StoredCompositionReview, StoredPromotionReview } from "../contracts";
import { GovernedRunAdmissionVerifier, RunGovernanceAdmissionError } from "../runAdmission";
import { canonicalize } from "../../../lib/evidenceLocking";

const context: WorkspaceAccessContext = {
  principal: { kind: "server-session", principalId: "admin-1", organizationId: "org-1", userId: "admin-1" },
  scope: { organizationId: "org-1", workspaceId: "workspace-1" },
};
const promotionHash = `sha256:${"c".repeat(64)}`;
const compositionHash = `sha256:${"d".repeat(64)}`;

function fixture() {
  const advancedRequest = {
    modelId: "advanced.real-options-rd-pipeline" as const, issuerId: "issuer-1", asOf: "2026-07-10", sidecarId: "options-1", sidecarStatus: "approved" as const,
    evidenceRefs: ["artifact:options"], transformationRefs: ["transform:options"], outputBridge: { sourceMonetaryUnit: "INR_CRORE" as const, sharesOutstandingCr: 10, valueRole: "incremental-equity-adjustment" as const },
    input: { riskFreeRate: 0.07, projects: [{ id: "drug-1", stage: "phase-3", underlyingValue: 100, developmentCost: 80, timeToDecisionYears: 2, probabilityOfSuccess: 0.5, volatility: 0.4 }] },
  };
  const advancedInputHash = `sha256:${createHash("sha256").update(canonicalize(advancedRequest)).digest("hex")}` as const;
  const promotionRecord: ModelPromotionDossier = {
    modelId: "advanced.real-options-rd-pipeline", implementationIntegration: "wired", realIssuerGoldenCount: 1,
    factCoverageRatio: 1, guardCoverageRatio: 1, lineageCoverageRatio: 1,
    calibration: { status: "not-required", asOf: null, sampleSize: 0, metric: null },
    reviewerPrincipalIds: [], evidenceRefs: ["artifact:promotion"],
  };
  const promotionReviews: StoredPromotionReview[] = [
    { dossierHash: promotionHash, reviewerPrincipalId: "reviewer-1", decision: "approved", evidenceRef: "promotion:review:1", reviewedAt: "2026-07-08T01:00:00.000Z" },
    { dossierHash: promotionHash, reviewerPrincipalId: "reviewer-2", decision: "approved", evidenceRef: "promotion:review:2", reviewedAt: "2026-07-08T02:00:00.000Z" },
  ];
  const promotionDossier = {
    ...promotionRecord,
    reviewerPrincipalIds: promotionReviews.map((review) => review.reviewerPrincipalId),
    evidenceRefs: [...promotionRecord.evidenceRefs, ...promotionReviews.map((review) => review.evidenceRef)],
  };
  const promotion = evaluateModelPromotion(CURRENT_MODEL_REGISTRY.require(promotionRecord.modelId), promotionDossier);
  const compositionDossier: RealOptionsCompositionDossier = {
    modelId: "advanced.real-options-rd-pipeline", issuerId: "issuer-1", sidecarId: "options-1", effectiveAsOf: "2026-07-09",
    baseModelId: "industrial.cash-statement-fcff-dcf", baseCaseId: "base", baseExcludesOptionality: true,
    synthesisTargetModelKey: "cash-fcff-dcf", synthesisTargetIndependenceGroup: "cash-statement", substitutionMode: "replace-exact-base-vote-once",
    advancedInputHash,
    excludedProjectIds: ["drug-1"], maximumAdjustmentToBaseRatio: 0.25,
    evidenceRefs: ["artifact:composition"], transformationRefs: ["transform:composition"],
  };
  const compositionReviews: StoredCompositionReview[] = [
    { dossierHash: compositionHash, reviewerPrincipalId: "reviewer-1", decision: "approved", evidenceRef: "composition:review:1", reviewedAt: "2026-07-09T01:00:00.000Z" },
    { dossierHash: compositionHash, reviewerPrincipalId: "reviewer-2", decision: "approved", evidenceRef: "composition:review:2", reviewedAt: "2026-07-09T02:00:00.000Z" },
  ];
  const approval = evaluateRealOptionsCompositionApproval(compositionHash, compositionDossier, compositionReviews);
  if (approval.status !== "approved") throw new Error("Fixture composition must be approved.");
  const trace = {
    policyVersion: "2026-07-evidence-synthesis-substitution-v1" as const,
    dossierHash: compositionHash, baseModelId: compositionDossier.baseModelId, baseCaseId: "base",
    basePerShare: 100, optionalityPerShare: 5, composedPerShare: 105,
    evidenceRefs: ["artifact:base", "artifact:options", ...approval.policy.reviewEvidenceRefs],
    transformationRefs: ["transform:base", "transform:options"],
  };
  const execution = {
    request: advancedRequest,
    promotionDossierHash: promotionHash,
    promotionDossier,
    promotion,
    compositionPolicy: approval.policy,
    compositionCandidate: {
      status: "eligible-candidate" as const, baseModelId: trace.baseModelId, baseCaseId: trace.baseCaseId,
      basePerShare: 100, optionalityPerShare: 5, composedPerShare: 105, adjustmentToBaseRatio: 0.05,
      dossierHash: compositionHash, synthesisTargetModelKey: "cash-fcff-dcf", synthesisTargetIndependenceGroup: "cash-statement" as const,
      evidenceRefs: trace.evidenceRefs, transformationRefs: trace.transformationRefs, eligibleForIntrinsicSynthesis: false as const,
    },
  };
  const run = { issuerId: "issuer-1", asOf: "2026-07-10", status: "completed" } as AnalysisRunDraftV1;
  return { promotionRecord, promotionReviews, compositionDossier, compositionReviews, execution, trace, run };
}

function artifact(kind: "evidence" | "synthesis", schemaVersion: string, payload: unknown): ArtifactPayload {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return {
    ref: { kind, schemaVersion, contentHash: `sha256:${(kind === "evidence" ? "a" : "b").repeat(64)}` as `sha256:${string}`, mediaType: "application/json", byteLength: bytes.byteLength },
    metadata: { kind, schemaVersion, mediaType: "application/json", contentClass: "analysis-run-artifact", createdAt: "2026-07-10T00:00:00.000Z", issuerId: "issuer-1", retentionUntil: null },
    bytes,
  } as ArtifactPayload;
}

function artifacts(value: ReturnType<typeof fixture>, execution = value.execution, trace = value.trace): ArtifactPayload[] {
  return [
    artifact("evidence", "2026-07-governed-advanced-model-execution-v5", { evidenceType: "governed-advanced-model-execution", execution }),
    artifact("synthesis", "2026-07-evidence-weighted-synthesis-v2", { synthesis: { contributions: [{ modelKey: "cash-fcff-dcf", independenceGroup: "cash-statement", substitution: trace }] } }),
  ];
}

function repository(value: ReturnType<typeof fixture>, expectedScope = context.scope): GovernanceEvidenceRepository {
  const inScope = (scope: WorkspaceScope) => scope.organizationId === expectedScope.organizationId && scope.workspaceId === expectedScope.workspaceId;
  return {
    putScenarioObservation: vi.fn(), queryScenarioObservations: vi.fn(async () => []), putCalibrationReport: vi.fn(),
    putSectorSidecar: vi.fn(), listSectorSidecars: vi.fn(async () => []),
    putPromotionDossier: vi.fn(),
    listPromotionDossiers: vi.fn(async (scope) => inScope(scope) ? [{ dossierHash: promotionHash, dossier: value.promotionRecord, submittedAt: "2026-07-08T00:00:00.000Z", submittedBy: "admin-1" }] : []),
    putPromotionReview: vi.fn(), listPromotionReviews: vi.fn(async (scope) => inScope(scope) ? value.promotionReviews : []),
    putCompositionDossier: vi.fn(),
    listCompositionDossiers: vi.fn(async (scope) => inScope(scope) ? [{ dossierHash: compositionHash, dossier: value.compositionDossier, submittedAt: "2026-07-09T00:00:00.000Z", submittedBy: "admin-1" }] : []),
    putCompositionReview: vi.fn(), listCompositionReviews: vi.fn(async (scope) => inScope(scope) ? value.compositionReviews : []),
  };
}

describe("governed run admission", () => {
  it("admits an exact run reconstructed from durable authenticated reviews", async () => {
    const value = fixture();
    await expect(new GovernedRunAdmissionVerifier(repository(value)).verify(context, value.run, artifacts(value))).resolves.toBeUndefined();
  });

  it("rejects a client-forged policy even when its artifact is internally consistent", async () => {
    const value = fixture();
    const forged = { ...value.execution, compositionPolicy: { ...value.execution.compositionPolicy, reviewerPrincipalIds: ["attacker-1", "attacker-2"] } };
    await expect(new GovernedRunAdmissionVerifier(repository(value)).verify(context, value.run, artifacts(value, forged)))
      .rejects.toMatchObject({ code: "RUN_GOVERNANCE_ATTESTATION_INVALID", blockerCodes: expect.arrayContaining(["COMPOSITION_DURABLE_POLICY_MISMATCH"]) } satisfies Partial<RunGovernanceAdmissionError>);
  });

  it("rejects cross-workspace records and unknown dossier hashes", async () => {
    const value = fixture();
    const otherContext = { ...context, scope: { ...context.scope, workspaceId: "workspace-2" } };
    await expect(new GovernedRunAdmissionVerifier(repository(value)).verify(otherContext, value.run, artifacts(value)))
      .rejects.toMatchObject({ blockerCodes: expect.arrayContaining(["COMPOSITION_DURABLE_DOSSIER_MISSING", "PROMOTION_DURABLE_DOSSIER_MISSING"]) });
    const unknown = `sha256:${"e".repeat(64)}` as const;
    const forgedExecution = { ...value.execution, compositionPolicy: { ...value.execution.compositionPolicy, dossierHash: unknown }, compositionCandidate: { ...value.execution.compositionCandidate, dossierHash: unknown } };
    const forgedTrace = { ...value.trace, dossierHash: unknown };
    await expect(new GovernedRunAdmissionVerifier(repository(value)).verify(context, value.run, artifacts(value, forgedExecution, forgedTrace)))
      .rejects.toMatchObject({ blockerCodes: expect.arrayContaining(["COMPOSITION_DURABLE_DOSSIER_MISSING"]) });
  });

  it("treats a durable rejecting review as a publication veto", async () => {
    const value = fixture();
    value.compositionReviews.push({ dossierHash: compositionHash, reviewerPrincipalId: "reviewer-3", decision: "rejected", evidenceRef: "composition:reject", reviewedAt: "2026-07-10T00:00:00.000Z" });
    await expect(new GovernedRunAdmissionVerifier(repository(value)).verify(context, value.run, artifacts(value)))
      .rejects.toMatchObject({ blockerCodes: expect.arrayContaining(["COMPOSITION_DURABLE_APPROVAL_BLOCKED", "REVIEW_REJECTED"]) });
  });

  it("rejects a substitution whose candidate and trace do not match", async () => {
    const value = fixture();
    const trace = { ...value.trace, composedPerShare: 106 };
    await expect(new GovernedRunAdmissionVerifier(repository(value)).verify(context, value.run, artifacts(value, value.execution, trace)))
      .rejects.toMatchObject({ blockerCodes: expect.arrayContaining(["COMPOSITION_CANDIDATE_TRACE_MISMATCH"]) });
    const alteredExecution = { ...value.execution, request: { ...value.execution.request, input: { ...value.execution.request.input, projects: [{ ...value.execution.request.input.projects[0]!, volatility: 0.9 }] } } };
    await expect(new GovernedRunAdmissionVerifier(repository(value)).verify(context, value.run, artifacts(value, alteredExecution)))
      .rejects.toMatchObject({ blockerCodes: expect.arrayContaining(["ADVANCED_INPUT_DURABLE_HASH_MISMATCH"]) });
  });
});
