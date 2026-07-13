import type { ModelPromotionDossier, RealOptionsCompositionDossier } from "../../engine/advancedModelGovernance";
import type { ScenarioCalibrationObservation, ScenarioCalibrationReport } from "../../engine/scenarioCalibration";
import type { GovernedSectorSidecarApproval } from "../../engine/sectorCases";
import { reproducibilityHash } from "../../lib/evidenceLocking";
import type { TransactionalSqlDriver } from "../durablePersistence";
import { parsePlatformIdentifier, parseWorkspaceAccessContext, parseWorkspaceScope, type WorkspaceAccessContext, type WorkspaceScope } from "../workspaceScope";
import type { CompositionReview, GovernanceEvidenceRepository, PromotionReview, StoredCompositionDossier, StoredCompositionReview, StoredPromotionDossier, StoredPromotionReview } from "./contracts";

interface JsonRow extends Record<string, unknown> { readonly payload: unknown; }
function instant(value: string, field: string): string { if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO instant.`); return value; }
function finiteJson(value: unknown): void {
  const seen = new WeakSet<object>();
  const visit = (item: unknown): void => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("Governance evidence numbers must be finite.");
    if (!item || typeof item !== "object") return;
    if (seen.has(item)) throw new Error("Governance evidence cannot be cyclic.");
    seen.add(item);
    if (Array.isArray(item)) item.forEach(visit); else Object.values(item).forEach(visit);
    seen.delete(item);
  };
  visit(value);
  const encoded = JSON.stringify(value);
  if (!encoded || encoded.length > 2_000_000) throw new Error("Governance evidence must be finite JSON below 2MB.");
}
function parseJson<T>(value: unknown): T { return structuredClone(typeof value === "string" ? JSON.parse(value) : value) as T; }
async function hash(value: unknown): Promise<string> { return `sha256:${await reproducibilityHash(value as Record<string, unknown>)}`; }

function validateObservation(value: ScenarioCalibrationObservation): ScenarioCalibrationObservation {
  finiteJson(value); parsePlatformIdentifier(value.observationId, "observationId"); parsePlatformIdentifier(value.issuerId, "issuerId");
  if (!value.family.trim() || !value.regime.trim() || !Number.isInteger(value.horizonYears) || value.horizonYears < 1) throw new Error("Scenario observation dimensions are invalid.");
  [value.forecastAsOf, value.realizedAt, value.availableAt].forEach((date, index) => { if (!Number.isFinite(Date.parse(date))) throw new Error(`Scenario observation date ${index} is invalid.`); });
  if (!value.sourceRefs.length || value.sourceRefs.some((ref) => !ref.trim())) throw new Error("Scenario observation sourceRefs are required.");
  return structuredClone(value);
}

/** Durable workspace governance-evidence repository. Evidence IDs are immutable. */
export class SqlGovernanceEvidenceRepository implements GovernanceEvidenceRepository {
  constructor(private readonly driver: TransactionalSqlDriver) {}

  async putScenarioObservation(contextValue: WorkspaceAccessContext, observationValue: ScenarioCalibrationObservation): Promise<"created" | "exists"> {
    const context = parseWorkspaceAccessContext(contextValue); const observation = validateObservation(observationValue); const fingerprint = await hash(observation);
    return this.driver.transaction(async (tx) => {
      const existing = await tx.query<{ payload: unknown; payload_hash: string } & Record<string, unknown>>(
        "select payload, payload_hash from platform_vintage_observations where organization_id = $1 and workspace_id = $2 and observation_id = $3 for update",
        [context.scope.organizationId, context.scope.workspaceId, observation.observationId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].payload_hash !== fingerprint) throw new Error("Scenario observation IDs are immutable and cannot be overwritten.");
        return "exists" as const;
      }
      await tx.query(
        `insert into platform_vintage_observations
          (organization_id, workspace_id, observation_id, issuer_id, family, regime, horizon_years, forecast_as_of, available_at, realized_at, scenario_key, payload, payload_hash, source_refs)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb)`,
        [context.scope.organizationId, context.scope.workspaceId, observation.observationId, observation.issuerId, observation.family, observation.regime, observation.horizonYears, observation.forecastAsOf, observation.availableAt, observation.realizedAt, observation.realizedScenario, JSON.stringify(observation), fingerprint, JSON.stringify(observation.sourceRefs)],
      );
      return "created" as const;
    });
  }

  async queryScenarioObservations(scopeValue: WorkspaceScope, query: { readonly family: string; readonly regime: string; readonly horizonYears: number; readonly knownAt: string }): Promise<readonly ScenarioCalibrationObservation[]> {
    const scope = parseWorkspaceScope(scopeValue); const knownAt = instant(query.knownAt, "knownAt");
    const result = await this.driver.query<JsonRow>(
      `select payload from platform_vintage_observations where organization_id = $1 and workspace_id = $2 and family = $3 and regime = $4
       and horizon_years = $5 and available_at <= $6 order by forecast_as_of asc, observation_id asc`,
      [scope.organizationId, scope.workspaceId, query.family, query.regime, query.horizonYears, knownAt],
    );
    return Object.freeze(result.rows.map((row) => parseJson<ScenarioCalibrationObservation>(row.payload)));
  }

  async putCalibrationReport(contextValue: WorkspaceAccessContext, report: ScenarioCalibrationReport, createdAtValue: string): Promise<string> {
    const context = parseWorkspaceAccessContext(contextValue); const createdAt = instant(createdAtValue, "createdAt"); finiteJson(report); const reportHash = await hash(report);
    await this.driver.query(
      `insert into platform_calibration_reports (organization_id, workspace_id, report_hash, family, regime, horizon_years, calibration_as_of, status, report_json, created_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) on conflict do nothing`,
      [context.scope.organizationId, context.scope.workspaceId, reportHash, report.family, report.regime, report.horizonYears, report.calibrationAsOf, report.status, JSON.stringify(report), createdAt, context.principal.principalId],
    );
    return reportHash;
  }

  async putSectorSidecar(contextValue: WorkspaceAccessContext, sidecarValue: GovernedSectorSidecarApproval): Promise<"created" | "exists"> {
    const context = parseWorkspaceAccessContext(contextValue); const sidecar = structuredClone(sidecarValue); finiteJson(sidecar);
    parsePlatformIdentifier(sidecar.sidecarId, "sidecarId"); parsePlatformIdentifier(sidecar.issuerId, "issuerId"); instant(sidecar.reviewedAt, "reviewedAt");
    if (sidecar.reviewerPrincipalId !== context.principal.principalId) throw new Error("Sidecar reviewer must match the authenticated principal.");
    const payloadHash = await hash(sidecar);
    return this.driver.transaction(async (tx) => {
      const existing = await tx.query<{ payload_hash: string } & Record<string, unknown>>("select payload_hash from platform_sector_sidecars where organization_id = $1 and workspace_id = $2 and sidecar_id = $3 for update", [context.scope.organizationId, context.scope.workspaceId, sidecar.sidecarId]);
      if (existing.rows[0]) { if (existing.rows[0].payload_hash !== payloadHash) throw new Error("Sector sidecar IDs are immutable."); return "exists" as const; }
      await tx.query(
        `insert into platform_sector_sidecars (organization_id, workspace_id, sidecar_id, issuer_id, case_type, reviewed_at, reviewer_principal_id, status, payload_hash, sidecar_json)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [context.scope.organizationId, context.scope.workspaceId, sidecar.sidecarId, sidecar.issuerId, sidecar.caseType, sidecar.reviewedAt, sidecar.reviewerPrincipalId, sidecar.status, payloadHash, JSON.stringify(sidecar)],
      );
      return "created" as const;
    });
  }

  async listSectorSidecars(scopeValue: WorkspaceScope, issuerId?: string): Promise<readonly GovernedSectorSidecarApproval[]> {
    const scope = parseWorkspaceScope(scopeValue); const parameters: unknown[] = [scope.organizationId, scope.workspaceId];
    const filter = issuerId ? (parameters.push(parsePlatformIdentifier(issuerId, "issuerId")), " and issuer_id = $3") : "";
    const result = await this.driver.query<{ sidecar_json: unknown } & Record<string, unknown>>(`select sidecar_json from platform_sector_sidecars where organization_id = $1 and workspace_id = $2${filter} order by reviewed_at desc, sidecar_id desc`, parameters);
    return Object.freeze(result.rows.map((row) => parseJson<GovernedSectorSidecarApproval>(row.sidecar_json)));
  }

  async putPromotionDossier(contextValue: WorkspaceAccessContext, dossier: ModelPromotionDossier, submittedAtValue: string): Promise<string> {
    const context = parseWorkspaceAccessContext(contextValue); const submittedAt = instant(submittedAtValue, "submittedAt"); finiteJson(dossier); parsePlatformIdentifier(dossier.modelId, "modelId"); const dossierHash = await hash(dossier);
    await this.driver.query(
      `insert into platform_model_promotion_dossiers (organization_id, workspace_id, dossier_hash, model_id, dossier_json, submitted_at, submitted_by)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7) on conflict do nothing`,
      [context.scope.organizationId, context.scope.workspaceId, dossierHash, dossier.modelId, JSON.stringify(dossier), submittedAt, context.principal.principalId],
    );
    return dossierHash;
  }

  async listPromotionDossiers(scopeValue: WorkspaceScope, modelIdValue: string): Promise<readonly StoredPromotionDossier[]> {
    const scope = parseWorkspaceScope(scopeValue); const modelId = parsePlatformIdentifier(modelIdValue, "modelId");
    const result = await this.driver.query<{ dossier_hash: string; dossier_json: unknown; submitted_at: string | Date; submitted_by: string } & Record<string, unknown>>("select dossier_hash, dossier_json, submitted_at, submitted_by from platform_model_promotion_dossiers where organization_id = $1 and workspace_id = $2 and model_id = $3 order by submitted_at desc, dossier_hash desc", [scope.organizationId, scope.workspaceId, modelId]);
    return Object.freeze(result.rows.map((row) => ({ dossierHash: row.dossier_hash, dossier: parseJson<ModelPromotionDossier>(row.dossier_json), submittedAt: typeof row.submitted_at === "string" ? new Date(row.submitted_at).toISOString() : row.submitted_at.toISOString(), submittedBy: row.submitted_by })));
  }

  async putPromotionReview(contextValue: WorkspaceAccessContext, reviewValue: PromotionReview): Promise<"created" | "exists"> {
    const context = parseWorkspaceAccessContext(contextValue); const review = structuredClone(reviewValue); instant(review.reviewedAt, "reviewedAt");
    if (!/^sha256:[0-9a-f]{64}$/.test(review.dossierHash) || !review.evidenceRef.trim() || !["approved", "rejected"].includes(review.decision)) throw new Error("Promotion review is invalid.");
    return this.driver.transaction(async (tx) => {
      const existing = await tx.query<{ decision: string; evidence_ref: string; reviewed_at: string | Date } & Record<string, unknown>>(
        "select decision, evidence_ref, reviewed_at from platform_model_promotion_reviews where organization_id = $1 and workspace_id = $2 and dossier_hash = $3 and reviewer_principal_id = $4 for update",
        [context.scope.organizationId, context.scope.workspaceId, review.dossierHash, context.principal.principalId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0]; const reviewedAt = typeof row.reviewed_at === "string" ? new Date(row.reviewed_at).toISOString() : row.reviewed_at.toISOString();
        if (row.decision !== review.decision || row.evidence_ref !== review.evidenceRef || reviewedAt !== new Date(review.reviewedAt).toISOString()) throw new Error("Promotion reviews are immutable.");
        return "exists" as const;
      }
      await tx.query(
        `insert into platform_model_promotion_reviews (organization_id, workspace_id, dossier_hash, reviewer_principal_id, decision, evidence_ref, reviewed_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [context.scope.organizationId, context.scope.workspaceId, review.dossierHash, context.principal.principalId, review.decision, review.evidenceRef, review.reviewedAt],
      );
      return "created" as const;
    });
  }

  async listPromotionReviews(scopeValue: WorkspaceScope, dossierHash: string): Promise<readonly StoredPromotionReview[]> {
    const scope = parseWorkspaceScope(scopeValue); if (!/^sha256:[0-9a-f]{64}$/.test(dossierHash)) throw new Error("dossierHash is invalid.");
    const result = await this.driver.query<{ reviewer_principal_id: string; decision: "approved" | "rejected"; evidence_ref: string; reviewed_at: string | Date } & Record<string, unknown>>(
      "select reviewer_principal_id, decision, evidence_ref, reviewed_at from platform_model_promotion_reviews where organization_id = $1 and workspace_id = $2 and dossier_hash = $3 order by reviewed_at asc, reviewer_principal_id asc",
      [scope.organizationId, scope.workspaceId, dossierHash],
    );
    return Object.freeze(result.rows.map((row) => ({ dossierHash, reviewerPrincipalId: row.reviewer_principal_id, decision: row.decision, evidenceRef: row.evidence_ref, reviewedAt: typeof row.reviewed_at === "string" ? new Date(row.reviewed_at).toISOString() : row.reviewed_at.toISOString() })));
  }

  async putCompositionDossier(contextValue: WorkspaceAccessContext, dossierValue: RealOptionsCompositionDossier, submittedAtValue: string): Promise<string> {
    const context = parseWorkspaceAccessContext(contextValue); const dossier = structuredClone(dossierValue); const submittedAt = instant(submittedAtValue, "submittedAt"); finiteJson(dossier);
    parsePlatformIdentifier(dossier.issuerId, "issuerId"); parsePlatformIdentifier(dossier.sidecarId, "sidecarId"); parsePlatformIdentifier(dossier.baseModelId, "baseModelId");
    if (dossier.modelId !== "advanced.real-options-rd-pipeline" || !/^\d{4}-\d{2}-\d{2}$/.test(dossier.effectiveAsOf)) throw new Error("Real-options composition dossier binding is invalid.");
    const dossierHash = await hash(dossier);
    await this.driver.query(
      `insert into platform_model_composition_dossiers
        (organization_id, workspace_id, dossier_hash, model_id, issuer_id, sidecar_id, effective_as_of, base_model_id, dossier_json, submitted_at, submitted_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) on conflict do nothing`,
      [context.scope.organizationId, context.scope.workspaceId, dossierHash, dossier.modelId, dossier.issuerId, dossier.sidecarId, dossier.effectiveAsOf, dossier.baseModelId, JSON.stringify(dossier), submittedAt, context.principal.principalId],
    );
    return dossierHash;
  }

  async listCompositionDossiers(scopeValue: WorkspaceScope, issuerIdValue: string, sidecarIdValue?: string): Promise<readonly StoredCompositionDossier[]> {
    const scope = parseWorkspaceScope(scopeValue); const issuerId = parsePlatformIdentifier(issuerIdValue, "issuerId"); const parameters: unknown[] = [scope.organizationId, scope.workspaceId, issuerId];
    const sidecarFilter = sidecarIdValue ? (parameters.push(parsePlatformIdentifier(sidecarIdValue, "sidecarId")), " and sidecar_id = $4") : "";
    const result = await this.driver.query<{ dossier_hash: string; dossier_json: unknown; submitted_at: string | Date; submitted_by: string } & Record<string, unknown>>(
      `select dossier_hash, dossier_json, submitted_at, submitted_by from platform_model_composition_dossiers
       where organization_id = $1 and workspace_id = $2 and issuer_id = $3${sidecarFilter} order by submitted_at desc, dossier_hash desc`, parameters,
    );
    return Object.freeze(result.rows.map((row) => ({ dossierHash: row.dossier_hash, dossier: parseJson<RealOptionsCompositionDossier>(row.dossier_json), submittedAt: typeof row.submitted_at === "string" ? new Date(row.submitted_at).toISOString() : row.submitted_at.toISOString(), submittedBy: row.submitted_by })));
  }

  async putCompositionReview(contextValue: WorkspaceAccessContext, reviewValue: CompositionReview): Promise<"created" | "exists"> {
    const context = parseWorkspaceAccessContext(contextValue); const review = structuredClone(reviewValue); instant(review.reviewedAt, "reviewedAt");
    if (!/^sha256:[0-9a-f]{64}$/.test(review.dossierHash) || !review.evidenceRef.trim() || !["approved", "rejected"].includes(review.decision)) throw new Error("Composition review is invalid.");
    return this.driver.transaction(async (tx) => {
      const existing = await tx.query<{ decision: string; evidence_ref: string; reviewed_at: string | Date } & Record<string, unknown>>(
        "select decision, evidence_ref, reviewed_at from platform_model_composition_reviews where organization_id = $1 and workspace_id = $2 and dossier_hash = $3 and reviewer_principal_id = $4 for update",
        [context.scope.organizationId, context.scope.workspaceId, review.dossierHash, context.principal.principalId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0]; const reviewedAt = typeof row.reviewed_at === "string" ? new Date(row.reviewed_at).toISOString() : row.reviewed_at.toISOString();
        if (row.decision !== review.decision || row.evidence_ref !== review.evidenceRef || reviewedAt !== new Date(review.reviewedAt).toISOString()) throw new Error("Composition reviews are immutable.");
        return "exists" as const;
      }
      await tx.query(
        `insert into platform_model_composition_reviews (organization_id, workspace_id, dossier_hash, reviewer_principal_id, decision, evidence_ref, reviewed_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [context.scope.organizationId, context.scope.workspaceId, review.dossierHash, context.principal.principalId, review.decision, review.evidenceRef, review.reviewedAt],
      );
      return "created" as const;
    });
  }

  async listCompositionReviews(scopeValue: WorkspaceScope, dossierHash: string): Promise<readonly StoredCompositionReview[]> {
    const scope = parseWorkspaceScope(scopeValue); if (!/^sha256:[0-9a-f]{64}$/.test(dossierHash)) throw new Error("dossierHash is invalid.");
    const result = await this.driver.query<{ reviewer_principal_id: string; decision: "approved" | "rejected"; evidence_ref: string; reviewed_at: string | Date } & Record<string, unknown>>(
      "select reviewer_principal_id, decision, evidence_ref, reviewed_at from platform_model_composition_reviews where organization_id = $1 and workspace_id = $2 and dossier_hash = $3 order by reviewed_at asc, reviewer_principal_id asc",
      [scope.organizationId, scope.workspaceId, dossierHash],
    );
    return Object.freeze(result.rows.map((row) => ({ dossierHash, reviewerPrincipalId: row.reviewer_principal_id, decision: row.decision, evidenceRef: row.evidence_ref, reviewedAt: typeof row.reviewed_at === "string" ? new Date(row.reviewed_at).toISOString() : row.reviewed_at.toISOString() })));
  }
}
