import { calibrateScenarioProbabilities, type ScenarioCalibrationObservation, type ScenarioCalibrationPolicy } from "../../engine/scenarioCalibration";
import { buildSectorOnboardingManifest, type GovernedSectorSidecarApproval, type SectorOnboardingCompany } from "../../engine/sectorCases";
import { CURRENT_MODEL_REGISTRY } from "../../engine/modelCatalog";
import { evaluateModelPromotion, evaluateRealOptionsCompositionApproval, type ApprovedRealOptionsCompositionPolicy, type GovernedAdvancedModelInput, type ModelPromotionDecision, type ModelPromotionDossier, type RealOptionsCompositionDossier } from "../../engine/advancedModelGovernance";
import type { PlatformSecurityBoundary } from "../security";
import type { WorkspaceAccessContext } from "../workspaceScope";
import { reproducibilityHash } from "../../lib/evidenceLocking";
import type { GovernanceEvidenceRepository } from "./contracts";
import type { CompositionReview, PromotionReview } from "./contracts";

export class GovernanceEvidenceService {
  constructor(private readonly repository: GovernanceEvidenceRepository, private readonly security: PlatformSecurityBoundary) {}

  private async evaluatePromotionRecord(scope: WorkspaceAccessContext["scope"], modelId: string) {
    const record = (await this.repository.listPromotionDossiers(scope, modelId))[0];
    if (!record) throw new GovernanceEvidenceServiceError("ADVANCED_MODEL_PROMOTION_MISSING", `No promotion dossier exists for '${modelId}'.`);
    const reviews = await this.repository.listPromotionReviews(scope, record.dossierHash);
    const approved = reviews.filter((review) => review.decision === "approved");
    const dossier = {
      ...record.dossier,
      reviewerPrincipalIds: approved.map((review) => review.reviewerPrincipalId),
      evidenceRefs: [...new Set([...record.dossier.evidenceRefs, ...approved.map((review) => review.evidenceRef)])],
    };
    let decision = evaluateModelPromotion(CURRENT_MODEL_REGISTRY.require(modelId), dossier);
    if (reviews.some((review) => review.decision === "rejected")) decision = Object.freeze({
      ...decision, status: "blocked" as const, eligibleLifecycle: null,
      blockerCodes: Object.freeze([...new Set([...decision.blockerCodes, "REVIEW_REJECTED"])]),
      checkResults: Object.freeze([...decision.checkResults, { checkId: "NO_REJECTING_REVIEW", passed: false, summary: "A recorded reviewer rejected this promotion dossier." }]),
    });
    return Object.freeze({ dossierHash: record.dossierHash, dossier, reviews, decision });
  }

  private async evaluateCompositionRecord(scope: WorkspaceAccessContext["scope"], issuerId: string, sidecarId?: string) {
    const record = (await this.repository.listCompositionDossiers(scope, issuerId, sidecarId))[0];
    if (!record) throw new GovernanceEvidenceServiceError("REAL_OPTIONS_COMPOSITION_MISSING", `No real-options composition dossier exists for '${issuerId}/${sidecarId ?? "latest"}'.`);
    const reviews = await this.repository.listCompositionReviews(scope, record.dossierHash);
    const decision = evaluateRealOptionsCompositionApproval(record.dossierHash, record.dossier, reviews);
    return Object.freeze({ dossierHash: record.dossierHash, dossier: record.dossier, reviews, decision });
  }

  async ingestScenarioObservation(context: WorkspaceAccessContext, observation: ScenarioCalibrationObservation) {
    await this.security.authorize(context, "publication:review");
    return this.repository.putScenarioObservation(context, observation);
  }

  async submitSectorSidecar(context: WorkspaceAccessContext, sidecar: GovernedSectorSidecarApproval) {
    await this.security.authorize(context, "publication:review");
    return this.repository.putSectorSidecar(context, sidecar);
  }

  async listSectorSidecars(context: WorkspaceAccessContext, issuerId?: string) {
    await this.security.authorize(context, "run:read");
    return this.repository.listSectorSidecars(context.scope, issuerId);
  }

  async listPromotionDossiers(context: WorkspaceAccessContext, modelId: string) {
    await this.security.authorize(context, "workspace:administer");
    return this.repository.listPromotionDossiers(context.scope, modelId);
  }

  async calibrate(context: WorkspaceAccessContext, policy: ScenarioCalibrationPolicy) {
    await this.security.authorize(context, "publication:review");
    const observations = await this.repository.queryScenarioObservations(context.scope, { family: policy.family, regime: policy.regime, horizonYears: policy.horizonYears, knownAt: policy.calibrationAsOf });
    const report = calibrateScenarioProbabilities({ observations, policy });
    const reportHash = await this.repository.putCalibrationReport(context, report, new Date().toISOString());
    return Object.freeze({ report, reportHash });
  }

  async scenarioInput(context: WorkspaceAccessContext, policy: ScenarioCalibrationPolicy) {
    await this.security.authorize(context, "run:read");
    const observations = await this.repository.queryScenarioObservations(context.scope, { family: policy.family, regime: policy.regime, horizonYears: policy.horizonYears, knownAt: policy.calibrationAsOf });
    return Object.freeze({ observations, policy });
  }

  async onboardingManifest(context: WorkspaceAccessContext, companies: readonly SectorOnboardingCompany[], evaluationAt: string) {
    await this.security.authorize(context, "run:read");
    const approvals = await this.repository.listSectorSidecars(context.scope);
    return buildSectorOnboardingManifest(companies, approvals, evaluationAt);
  }

  async submitPromotion(context: WorkspaceAccessContext, dossier: ModelPromotionDossier, submittedAt: string) {
    await this.security.authorize(context, "workspace:administer");
    const canonicalDossier = { ...dossier, reviewerPrincipalIds: [] };
    const definition = CURRENT_MODEL_REGISTRY.require(canonicalDossier.modelId);
    const decision = evaluateModelPromotion(definition, canonicalDossier);
    const dossierHash = await this.repository.putPromotionDossier(context, canonicalDossier, submittedAt);
    return Object.freeze({ dossierHash, decision });
  }

  async reviewPromotion(context: WorkspaceAccessContext, review: PromotionReview) {
    await this.security.authorize(context, "publication:review");
    return this.repository.putPromotionReview(context, review);
  }

  async evaluateLatestPromotion(context: WorkspaceAccessContext, modelId: string) {
    await this.security.authorize(context, "workspace:administer");
    return this.evaluatePromotionRecord(context.scope, modelId);
  }

  async submitComposition(context: WorkspaceAccessContext, dossier: RealOptionsCompositionDossier, submittedAt: string) {
    await this.security.authorize(context, "workspace:administer");
    const dossierHash = await this.repository.putCompositionDossier(context, dossier, submittedAt);
    const decision = evaluateRealOptionsCompositionApproval(dossierHash, dossier, []);
    return Object.freeze({ dossierHash, decision });
  }

  async listCompositionDossiers(context: WorkspaceAccessContext, issuerId: string, sidecarId?: string) {
    await this.security.authorize(context, "workspace:administer");
    return this.repository.listCompositionDossiers(context.scope, issuerId, sidecarId);
  }

  async reviewComposition(context: WorkspaceAccessContext, review: CompositionReview) {
    await this.security.authorize(context, "publication:review");
    return this.repository.putCompositionReview(context, review);
  }

  async evaluateLatestComposition(context: WorkspaceAccessContext, issuerId: string, sidecarId?: string) {
    await this.security.authorize(context, "workspace:administer");
    return this.evaluateCompositionRecord(context.scope, issuerId, sidecarId);
  }

  async resolveAdvancedModels(context: WorkspaceAccessContext, requests: readonly GovernedAdvancedModelInput[]): Promise<readonly ResolvedAdvancedModelAttestation[]> {
    await this.security.authorize(context, "run:create");
    if (!Array.isArray(requests as unknown) || requests.length > 10) throw new GovernanceEvidenceServiceError("ADVANCED_MODEL_REQUEST_INVALID", "Advanced-model resolution accepts at most ten requests.");
    const identities = requests.map((request) => `${request.modelId}:${request.issuerId}:${request.sidecarId}`);
    if (new Set(identities).size !== identities.length) throw new GovernanceEvidenceServiceError("ADVANCED_MODEL_REQUEST_DUPLICATE", "Advanced-model requests must have unique model/issuer/sidecar identities.");
    const resolved: ResolvedAdvancedModelAttestation[] = [];
    for (const request of requests) {
      const promotion = await this.evaluatePromotionRecord(context.scope, request.modelId);
      if (promotion.decision.status !== "eligible") throw new GovernanceEvidenceServiceError("ADVANCED_MODEL_PROMOTION_BLOCKED", `Promotion for '${request.modelId}' is blocked: ${promotion.decision.blockerCodes.join(", ")}.`, promotion.decision.blockerCodes);
      let compositionPolicy: ApprovedRealOptionsCompositionPolicy | null = null;
      if (request.modelId === "advanced.real-options-rd-pipeline") {
        const composition = await this.evaluateCompositionRecord(context.scope, request.issuerId, request.sidecarId);
        if (composition.decision.status !== "approved") throw new GovernanceEvidenceServiceError("REAL_OPTIONS_COMPOSITION_BLOCKED", `Composition for '${request.issuerId}/${request.sidecarId}' is blocked: ${composition.decision.blockerCodes.join(", ")}.`, composition.decision.blockerCodes);
        compositionPolicy = composition.decision.policy;
        const dossier = compositionPolicy.dossier;
        const advancedInputHash = `sha256:${await reproducibilityHash(request as unknown as Record<string, unknown>)}`;
        const requestedProjects = [...new Set(request.input.projects.map((project) => project.id))].sort();
        const excludedProjects = [...dossier.excludedProjectIds].sort();
        if (
          request.sidecarStatus !== "approved"
          || dossier.issuerId !== request.issuerId
          || dossier.sidecarId !== request.sidecarId
          || dossier.effectiveAsOf > request.asOf
          || dossier.advancedInputHash !== advancedInputHash
          || requestedProjects.length !== excludedProjects.length
          || requestedProjects.some((project, index) => project !== excludedProjects[index])
        ) throw new GovernanceEvidenceServiceError("REAL_OPTIONS_REQUEST_BINDING_MISMATCH", "The requested sidecar does not match the approved issuer, date, exact input hash, or project-exclusion set.");
      }
      resolved.push(Object.freeze({
        request,
        dossierHash: promotion.dossierHash,
        dossier: promotion.dossier,
        promotionDecision: promotion.decision,
        compositionPolicy,
      }));
    }
    return Object.freeze(resolved);
  }
}

export interface ResolvedAdvancedModelAttestation {
  readonly request: GovernedAdvancedModelInput;
  readonly dossierHash: string;
  readonly dossier: ModelPromotionDossier;
  readonly promotionDecision: ModelPromotionDecision;
  readonly compositionPolicy: ApprovedRealOptionsCompositionPolicy | null;
}

export class GovernanceEvidenceServiceError extends Error {
  readonly status = 409;
  constructor(readonly code: string, message: string, readonly blockerCodes: readonly string[] = []) {
    super(message);
    this.name = "GovernanceEvidenceServiceError";
  }
}
