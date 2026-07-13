import type { CompositionPolicyReviewEvidence, ModelPromotionDossier, RealOptionsCompositionDossier } from "../../engine/advancedModelGovernance";
import type { ScenarioCalibrationObservation, ScenarioCalibrationReport } from "../../engine/scenarioCalibration";
import type { GovernedSectorSidecarApproval } from "../../engine/sectorCases";
import type { WorkspaceAccessContext, WorkspaceScope } from "../workspaceScope";

export interface GovernanceEvidenceRepository {
  putScenarioObservation(context: WorkspaceAccessContext, observation: ScenarioCalibrationObservation): Promise<"created" | "exists">;
  queryScenarioObservations(scope: WorkspaceScope, query: { readonly family: string; readonly regime: string; readonly horizonYears: number; readonly knownAt: string }): Promise<readonly ScenarioCalibrationObservation[]>;
  putCalibrationReport(context: WorkspaceAccessContext, report: ScenarioCalibrationReport, createdAt: string): Promise<string>;
  putSectorSidecar(context: WorkspaceAccessContext, sidecar: GovernedSectorSidecarApproval): Promise<"created" | "exists">;
  listSectorSidecars(scope: WorkspaceScope, issuerId?: string): Promise<readonly GovernedSectorSidecarApproval[]>;
  putPromotionDossier(context: WorkspaceAccessContext, dossier: ModelPromotionDossier, submittedAt: string): Promise<string>;
  listPromotionDossiers(scope: WorkspaceScope, modelId: string): Promise<readonly StoredPromotionDossier[]>;
  putPromotionReview(context: WorkspaceAccessContext, review: PromotionReview): Promise<"created" | "exists">;
  listPromotionReviews(scope: WorkspaceScope, dossierHash: string): Promise<readonly StoredPromotionReview[]>;
  putCompositionDossier(context: WorkspaceAccessContext, dossier: RealOptionsCompositionDossier, submittedAt: string): Promise<string>;
  listCompositionDossiers(scope: WorkspaceScope, issuerId: string, sidecarId?: string): Promise<readonly StoredCompositionDossier[]>;
  putCompositionReview(context: WorkspaceAccessContext, review: CompositionReview): Promise<"created" | "exists">;
  listCompositionReviews(scope: WorkspaceScope, dossierHash: string): Promise<readonly StoredCompositionReview[]>;
}

export interface StoredPromotionDossier { readonly dossierHash: string; readonly dossier: ModelPromotionDossier; readonly submittedAt: string; readonly submittedBy: string; }
export interface PromotionReview { readonly dossierHash: string; readonly decision: "approved" | "rejected"; readonly evidenceRef: string; readonly reviewedAt: string; }
export interface StoredPromotionReview extends PromotionReview { readonly reviewerPrincipalId: string; }
export interface StoredCompositionDossier { readonly dossierHash: string; readonly dossier: RealOptionsCompositionDossier; readonly submittedAt: string; readonly submittedBy: string; }
export interface CompositionReview { readonly dossierHash: string; readonly decision: "approved" | "rejected"; readonly evidenceRef: string; readonly reviewedAt: string; }
export interface StoredCompositionReview extends CompositionReview, CompositionPolicyReviewEvidence {}
