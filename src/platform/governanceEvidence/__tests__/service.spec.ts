import { describe, expect, it, vi } from "vitest";
import type { ModelPromotionDossier, RealOptionsCompositionDossier } from "../../../engine/advancedModelGovernance";
import type { CompositionReview, GovernanceEvidenceRepository, PromotionReview, StoredCompositionDossier, StoredCompositionReview, StoredPromotionDossier, StoredPromotionReview } from "../contracts";
import { GovernanceEvidenceService } from "../service";
import type { PlatformSecurityBoundary } from "../../security";
import type { WorkspaceAccessContext } from "../../workspaceScope";
import { reproducibilityHash } from "../../../lib/evidenceLocking";

const context: WorkspaceAccessContext = { principal: { kind: "server-session", principalId: "admin-1", organizationId: "org-1", userId: "admin-1" }, scope: { organizationId: "org-1", workspaceId: "workspace-1" } };
const dossier: ModelPromotionDossier = {
  modelId: "advanced.esg-adjusted-ke", implementationIntegration: "wired", realIssuerGoldenCount: 2,
  factCoverageRatio: 1, guardCoverageRatio: 1, lineageCoverageRatio: 1,
  calibration: { status: "not-required", asOf: null, sampleSize: 0, metric: null },
  reviewerPrincipalIds: ["spoofed-1", "spoofed-2"], evidenceRefs: ["artifact:dossier"],
};

function repository() {
  const dossiers: StoredPromotionDossier[] = []; const reviews: StoredPromotionReview[] = [];
  const compositions: StoredCompositionDossier[] = []; const compositionReviews: StoredCompositionReview[] = [];
  const value: GovernanceEvidenceRepository = {
    putScenarioObservation: vi.fn(), queryScenarioObservations: vi.fn(async () => []), putCalibrationReport: vi.fn(),
    putSectorSidecar: vi.fn(), listSectorSidecars: vi.fn(async () => []),
    putPromotionDossier: vi.fn(async (_context, stored, submittedAt) => { dossiers.unshift({ dossierHash: `sha256:${"a".repeat(64)}`, dossier: stored, submittedAt, submittedBy: _context.principal.principalId }); return `sha256:${"a".repeat(64)}`; }),
    listPromotionDossiers: vi.fn(async () => dossiers),
    putPromotionReview: vi.fn(async (reviewContext: WorkspaceAccessContext, review: PromotionReview) => { reviews.push({ ...review, reviewerPrincipalId: reviewContext.principal.principalId }); return "created" as const; }),
    listPromotionReviews: vi.fn(async () => reviews),
    putCompositionDossier: vi.fn(async (dossierContext: WorkspaceAccessContext, stored, submittedAt) => { compositions.unshift({ dossierHash: `sha256:${"b".repeat(64)}`, dossier: stored, submittedAt, submittedBy: dossierContext.principal.principalId }); return `sha256:${"b".repeat(64)}`; }),
    listCompositionDossiers: vi.fn(async () => compositions),
    putCompositionReview: vi.fn(async (reviewContext: WorkspaceAccessContext, review: CompositionReview) => { compositionReviews.push({ ...review, reviewerPrincipalId: reviewContext.principal.principalId }); return "created" as const; }),
    listCompositionReviews: vi.fn(async () => compositionReviews),
  };
  return { value, dossiers, reviews, compositions, compositionReviews };
}

describe("governance evidence service", () => {
  it("discards claimed dossier reviewers and derives review identity from authenticated records", async () => {
    const repo = repository(); const security = { authorize: vi.fn(async () => undefined) } satisfies PlatformSecurityBoundary;
    const service = new GovernanceEvidenceService(repo.value, security);
    const submitted = await service.submitPromotion(context, dossier, "2026-07-13T00:00:00.000Z");
    expect(repo.dossiers[0]!.dossier.reviewerPrincipalIds).toEqual([]);
    expect(submitted.decision.blockerCodes).toContain("DUAL_REVIEW");
    await service.reviewPromotion({ ...context, principal: { ...context.principal, principalId: "reviewer-1", userId: "reviewer-1" } }, { dossierHash: submitted.dossierHash, decision: "approved", evidenceRef: "review:1", reviewedAt: "2026-07-13T01:00:00.000Z" });
    await service.reviewPromotion({ ...context, principal: { ...context.principal, principalId: "reviewer-2", userId: "reviewer-2" } }, { dossierHash: submitted.dossierHash, decision: "approved", evidenceRef: "review:2", reviewedAt: "2026-07-13T02:00:00.000Z" });
    const evaluated = await service.evaluateLatestPromotion(context, dossier.modelId);
    expect(evaluated.dossier.reviewerPrincipalIds).toEqual(["reviewer-1", "reviewer-2"]);
    expect(evaluated.decision.blockerCodes).not.toContain("DUAL_REVIEW");
    expect(evaluated.decision.blockerCodes).toContain("IMPLEMENTATION_WIRED");
  });

  it("treats a persisted rejecting review as a promotion veto", async () => {
    const repo = repository(); const service = new GovernanceEvidenceService(repo.value, { authorize: vi.fn(async () => undefined) });
    const submitted = await service.submitPromotion(context, dossier, "2026-07-13T00:00:00.000Z");
    repo.reviews.push({ dossierHash: submitted.dossierHash, reviewerPrincipalId: "reviewer-1", decision: "rejected", evidenceRef: "review:reject", reviewedAt: "2026-07-13T01:00:00.000Z" });
    expect((await service.evaluateLatestPromotion(context, dossier.modelId)).decision.blockerCodes).toContain("REVIEW_REJECTED");
  });

  it("derives composition approval from two authenticated reviewers and preserves rejection vetoes", async () => {
    const repo = repository(); const service = new GovernanceEvidenceService(repo.value, { authorize: vi.fn(async () => undefined) });
    const composition: RealOptionsCompositionDossier = {
      modelId: "advanced.real-options-rd-pipeline", issuerId: "issuer-1", sidecarId: "options-1", effectiveAsOf: "2026-07-13",
      baseModelId: "industrial.penman.residual-income", baseCaseId: "base", baseExcludesOptionality: true,
      synthesisTargetModelKey: "accrual-riv-reoi", synthesisTargetIndependenceGroup: "accrual-history", substitutionMode: "replace-exact-base-vote-once",
      advancedInputHash: `sha256:${"f".repeat(64)}`,
      excludedProjectIds: ["drug-1"], maximumAdjustmentToBaseRatio: 0.25,
      evidenceRefs: ["artifact:composition"], transformationRefs: ["transform:composition"],
    };
    const submitted = await service.submitComposition(context, composition, "2026-07-13T00:00:00.000Z");
    expect(submitted.decision.blockerCodes).toContain("DUAL_REVIEW_REQUIRED");
    await service.reviewComposition({ ...context, principal: { ...context.principal, principalId: "reviewer-1" } }, { dossierHash: submitted.dossierHash, decision: "approved", evidenceRef: "review:composition:1", reviewedAt: "2026-07-13T01:00:00.000Z" });
    await service.reviewComposition({ ...context, principal: { ...context.principal, principalId: "reviewer-2" } }, { dossierHash: submitted.dossierHash, decision: "approved", evidenceRef: "review:composition:2", reviewedAt: "2026-07-13T02:00:00.000Z" });
    expect((await service.evaluateLatestComposition(context, composition.issuerId, composition.sidecarId)).decision.status).toBe("approved");
    repo.compositionReviews.push({ dossierHash: submitted.dossierHash, reviewerPrincipalId: "reviewer-3", decision: "rejected", evidenceRef: "review:composition:reject", reviewedAt: "2026-07-13T03:00:00.000Z" });
    expect((await service.evaluateLatestComposition(context, composition.issuerId, composition.sidecarId)).decision.blockerCodes).toContain("REVIEW_REJECTED");
  });

  it("resolves exact run attestations only after durable promotion and composition approval", async () => {
    const repo = repository(); const service = new GovernanceEvidenceService(repo.value, { authorize: vi.fn(async () => undefined) });
    const promotion = {
      modelId: "advanced.real-options-rd-pipeline", implementationIntegration: "wired" as const, realIssuerGoldenCount: 1,
      factCoverageRatio: 1, guardCoverageRatio: 1, lineageCoverageRatio: 1,
      calibration: { status: "not-required" as const, asOf: null, sampleSize: 0, metric: null },
      reviewerPrincipalIds: [], evidenceRefs: ["artifact:promotion"],
    };
    const promoted = await service.submitPromotion(context, promotion, "2026-07-12T00:00:00.000Z");
    await service.reviewPromotion({ ...context, principal: { ...context.principal, principalId: "reviewer-1" } }, { dossierHash: promoted.dossierHash, decision: "approved", evidenceRef: "promotion:review:1", reviewedAt: "2026-07-12T01:00:00.000Z" });
    await service.reviewPromotion({ ...context, principal: { ...context.principal, principalId: "reviewer-2" } }, { dossierHash: promoted.dossierHash, decision: "approved", evidenceRef: "promotion:review:2", reviewedAt: "2026-07-12T02:00:00.000Z" });
    const request = {
      modelId: "advanced.real-options-rd-pipeline" as const, issuerId: "issuer-1", asOf: "2026-07-13", sidecarId: "options-1", sidecarStatus: "approved" as const,
      evidenceRefs: ["artifact:options"], transformationRefs: ["transform:options"], outputBridge: { sourceMonetaryUnit: "INR_CRORE" as const, sharesOutstandingCr: 10, valueRole: "incremental-equity-adjustment" as const },
      input: { riskFreeRate: 0.07, projects: [{ id: "drug-1", stage: "phase-3", underlyingValue: 100, developmentCost: 80, timeToDecisionYears: 2, probabilityOfSuccess: 0.5, volatility: 0.4 }] },
    };
    const composition: RealOptionsCompositionDossier = {
      modelId: "advanced.real-options-rd-pipeline", issuerId: "issuer-1", sidecarId: "options-1", effectiveAsOf: "2026-07-12",
      baseModelId: "industrial.cash-statement-fcff-dcf", baseCaseId: "base", baseExcludesOptionality: true,
      synthesisTargetModelKey: "cash-fcff-dcf", synthesisTargetIndependenceGroup: "cash-statement", substitutionMode: "replace-exact-base-vote-once",
      advancedInputHash: `sha256:${await reproducibilityHash(request)}`,
      excludedProjectIds: ["drug-1"], maximumAdjustmentToBaseRatio: 0.25,
      evidenceRefs: ["artifact:composition"], transformationRefs: ["transform:composition"],
    };
    const composed = await service.submitComposition(context, composition, "2026-07-12T00:00:00.000Z");
    await service.reviewComposition({ ...context, principal: { ...context.principal, principalId: "reviewer-1" } }, { dossierHash: composed.dossierHash, decision: "approved", evidenceRef: "composition:review:1", reviewedAt: "2026-07-12T01:00:00.000Z" });
    await service.reviewComposition({ ...context, principal: { ...context.principal, principalId: "reviewer-2" } }, { dossierHash: composed.dossierHash, decision: "approved", evidenceRef: "composition:review:2", reviewedAt: "2026-07-12T02:00:00.000Z" });
    const resolved = await service.resolveAdvancedModels(context, [request]);
    expect(resolved[0]).toMatchObject({ request, dossierHash: promoted.dossierHash, promotionDecision: { status: "eligible" }, compositionPolicy: { dossierHash: composed.dossierHash } });
    await expect(service.resolveAdvancedModels(context, [{ ...request, input: { ...request.input, projects: [{ ...request.input.projects[0]!, underlyingValue: 101 }] } }]))
      .rejects.toMatchObject({ code: "REAL_OPTIONS_REQUEST_BINDING_MISMATCH" });
    repo.compositionReviews.push({ dossierHash: composed.dossierHash, reviewerPrincipalId: "reviewer-3", decision: "rejected", evidenceRef: "composition:reject", reviewedAt: "2026-07-13T00:00:00.000Z" });
    await expect(service.resolveAdvancedModels(context, [request])).rejects.toMatchObject({ code: "REAL_OPTIONS_COMPOSITION_BLOCKED", blockerCodes: expect.arrayContaining(["REVIEW_REJECTED"]) });
  });
});
