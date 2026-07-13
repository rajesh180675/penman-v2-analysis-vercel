import {
  CURRENT_MODEL_REGISTRY,
  type ValuationModelRegistry,
  type ValuationModelResult,
} from "../modelCatalog";
import type {
  SectorCaseResult,
  SectorNativeCreditDecision,
  SectorNativeCreditResult,
} from "./contracts";
import {
  CURRENT_SECTOR_CASE_REGISTRY,
  type SectorCaseRegistry,
} from "./registry";

function modelVersion(modelId: string, registry: ValuationModelRegistry): string {
  return registry.get(modelId)?.modelVersion ?? "unregistered";
}

/** Preserve explicit state when crossing into the generic model catalog. */
export function adaptSectorCaseToCatalogResult(
  result: SectorCaseResult,
  registry: ValuationModelRegistry = CURRENT_MODEL_REGISTRY,
): ValuationModelResult {
  if (result.status === "blocked") {
    return {
      status: result.eligibility.status === "not-applicable" ? "not-applicable" : "insufficient-evidence",
      modelId: result.modelId,
      modelVersion: modelVersion(result.modelId, registry),
      caseId: result.caseType,
      reasonCode: result.reasonCodes.join("|") || "SECTOR_CASE_BLOCKED",
      missingRequirementIds: result.eligibility.missingEvidenceIds,
    };
  }
  return {
    status: "computed",
    modelId: result.modelId,
    modelVersion: modelVersion(result.modelId, registry),
    caseId: result.caseType,
    enterpriseValue: result.enterpriseValueCr,
    equityValue: result.equityValueCr,
    perShare: result.perShareInr,
    unit: "INR_PER_SHARE",
    evidenceRefs: result.evidenceRefs,
    transformationRefs: result.transformationRefs,
    diagnostics: result.diagnostics,
    guardResults: result.guardResults,
  };
}

export function toSectorNativeCreditResult(result: SectorCaseResult): SectorNativeCreditResult {
  if (result.status === "blocked") {
    return {
      caseType: result.caseType,
      modelId: result.modelId,
      status: "blocked",
      eligibilityStatus: result.eligibility.status,
      enterpriseValueCr: null,
      equityValueCr: null,
      perShareInr: null,
      satisfiedEvidenceIds: [],
      evidenceRefs: [],
      blockingGuardCount: result.reasonCodes.filter((code) => code.startsWith("guard-failed:")).length,
    };
  }
  return {
    caseType: result.caseType,
    modelId: result.modelId,
    status: "computed",
    eligibilityStatus: result.eligibility.status,
    enterpriseValueCr: result.enterpriseValueCr,
    equityValueCr: result.equityValueCr,
    perShareInr: result.perShareInr,
    satisfiedEvidenceIds: result.eligibility.satisfiedEvidenceIds,
    evidenceRefs: result.evidenceRefs,
    blockingGuardCount: result.guardResults.filter((guard) => guard.blocksResult && guard.status === "failed").length,
  };
}

/**
 * Maturity credit is a derived decision. A route/model label cannot pass it:
 * the case/model mapping, production lifecycle, eligibility evidence, guards,
 * and finite values must all agree.
 */
export function evaluateSectorNativeCredit(
  result: SectorNativeCreditResult,
  sectorRegistry: SectorCaseRegistry = CURRENT_SECTOR_CASE_REGISTRY,
  modelRegistry: ValuationModelRegistry = CURRENT_MODEL_REGISTRY,
): SectorNativeCreditDecision {
  const caseDefinition = sectorRegistry.get(result.caseType);
  if (!caseDefinition || caseDefinition.modelId !== result.modelId) {
    return { credited: false, modelId: result.modelId, lifecycle: "unregistered", reasonCode: "case-model-mismatch" };
  }
  const modelDefinition = modelRegistry.get(result.modelId);
  if (!modelDefinition) {
    return { credited: false, modelId: result.modelId, lifecycle: "unregistered", reasonCode: "model-unregistered" };
  }
  if (modelDefinition.lifecycle !== "production") {
    return { credited: false, modelId: result.modelId, lifecycle: modelDefinition.lifecycle, reasonCode: "model-not-production" };
  }
  if (result.status !== "computed") {
    return { credited: false, modelId: result.modelId, lifecycle: modelDefinition.lifecycle, reasonCode: "result-not-computed" };
  }
  const evidenceComplete = caseDefinition.requiredEvidenceIds.every((id) => result.satisfiedEvidenceIds.includes(id))
    && result.evidenceRefs.length > 0
    && result.blockingGuardCount === 0;
  if (result.eligibilityStatus !== "eligible" || !evidenceComplete) {
    return { credited: false, modelId: result.modelId, lifecycle: modelDefinition.lifecycle, reasonCode: "case-not-eligible" };
  }
  const finite = typeof result.equityValueCr === "number"
    && Number.isFinite(result.equityValueCr)
    && result.equityValueCr > 0
    && typeof result.perShareInr === "number"
    && Number.isFinite(result.perShareInr)
    && result.perShareInr > 0
    && (result.enterpriseValueCr == null || Number.isFinite(result.enterpriseValueCr));
  if (!finite) {
    return { credited: false, modelId: result.modelId, lifecycle: modelDefinition.lifecycle, reasonCode: "non-finite-output" };
  }
  return { credited: true, modelId: result.modelId, lifecycle: modelDefinition.lifecycle, reasonCode: "credited" };
}
