import type { ValuationModelDefinition } from "../modelCatalog";

export const MODEL_PROMOTION_SCHEMA_VERSION = "2026-07-model-promotion-v1" as const;

export interface ModelPromotionDossier {
  readonly modelId: string;
  readonly implementationIntegration: "wired" | "partially-wired" | "not-wired";
  readonly realIssuerGoldenCount: number;
  readonly factCoverageRatio: number;
  readonly guardCoverageRatio: number;
  readonly lineageCoverageRatio: number;
  readonly calibration: {
    readonly status: "passed" | "failed" | "not-required" | "unavailable";
    readonly asOf: string | null;
    readonly sampleSize: number;
    readonly metric: number | null;
  };
  readonly reviewerPrincipalIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface ModelPromotionDecision {
  readonly schemaVersion: typeof MODEL_PROMOTION_SCHEMA_VERSION;
  readonly modelId: string;
  readonly fromLifecycle: string;
  readonly eligibleLifecycle: "production" | null;
  readonly status: "eligible" | "blocked" | "not-applicable";
  readonly checkResults: readonly { readonly checkId: string; readonly passed: boolean; readonly summary: string }[];
  readonly blockerCodes: readonly string[];
}

export function evaluateModelPromotion(
  definition: ValuationModelDefinition,
  dossier: ModelPromotionDossier | null,
): ModelPromotionDecision {
  if (definition.lifecycle === "production") return Object.freeze({
    schemaVersion: MODEL_PROMOTION_SCHEMA_VERSION, modelId: definition.modelId, fromLifecycle: definition.lifecycle,
    eligibleLifecycle: null, status: "not-applicable", checkResults: [], blockerCodes: [],
  });
  if (definition.lifecycle === "deprecated") return Object.freeze({
    schemaVersion: MODEL_PROMOTION_SCHEMA_VERSION, modelId: definition.modelId, fromLifecycle: definition.lifecycle,
    eligibleLifecycle: null, status: "not-applicable", checkResults: Object.freeze([{
      checkId: "MODEL_NOT_DEPRECATED", passed: false, summary: "Deprecated models cannot be promoted; use the catalog replacement model.",
    }]), blockerCodes: Object.freeze(["MODEL_DEPRECATED"]),
  });
  const dossierMatchesModel = dossier?.modelId === definition.modelId;
  const checks = [
    { checkId: "DOSSIER_MODEL_MATCH", passed: dossierMatchesModel, summary: "Promotion evidence must name the catalog model being evaluated." },
    { checkId: "IMPLEMENTATION_WIRED", passed: dossierMatchesModel && definition.implementation.integration === "wired" && dossier?.implementationIntegration === "wired", summary: "Both the catalog and promotion evidence must confirm that a production call site consumes the model result." },
    { checkId: "REAL_ISSUER_GOLDEN", passed: (dossier?.realIssuerGoldenCount ?? 0) >= 1, summary: "At least one reviewed real-issuer golden case is required." },
    { checkId: "FACT_COVERAGE", passed: (dossier?.factCoverageRatio ?? 0) >= 0.8, summary: "Required fact coverage must be at least 80%." },
    { checkId: "GUARD_COVERAGE", passed: dossier?.guardCoverageRatio === 1, summary: "Every blocking guard must have execution coverage." },
    { checkId: "LINEAGE_COVERAGE", passed: dossier?.lineageCoverageRatio === 1, summary: "Every material result must carry evidence and transformation lineage." },
    { checkId: "CALIBRATION", passed: dossier?.calibration.status === "not-required" || (dossier?.calibration.status === "passed" && dossier.calibration.asOf != null && Number.isFinite(Date.parse(dossier.calibration.asOf)) && Number.isInteger(dossier.calibration.sampleSize) && dossier.calibration.sampleSize > 0 && dossier.calibration.metric != null && Number.isFinite(dossier.calibration.metric)), summary: "Calibration must pass with dated, finite, non-empty evidence or be explicitly not required." },
    { checkId: "DUAL_REVIEW", passed: new Set((dossier?.reviewerPrincipalIds ?? []).map((id) => id.trim()).filter(Boolean)).size >= 2, summary: "Two distinct, identified reviewers must approve promotion." },
    { checkId: "PROMOTION_EVIDENCE", passed: (dossier?.evidenceRefs ?? []).some((ref) => ref.trim().length > 0), summary: "Promotion evidence must be content-addressed." },
  ];
  const blockerCodes = checks.filter((check) => !check.passed).map((check) => check.checkId);
  return Object.freeze({
    schemaVersion: MODEL_PROMOTION_SCHEMA_VERSION,
    modelId: definition.modelId,
    fromLifecycle: definition.lifecycle,
    eligibleLifecycle: blockerCodes.length ? null : "production",
    status: blockerCodes.length ? "blocked" : "eligible",
    checkResults: Object.freeze(checks),
    blockerCodes: Object.freeze(blockerCodes),
  });
}
