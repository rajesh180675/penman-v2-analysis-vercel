/**
 * Runtime-neutral contracts for the valuation-model catalog.
 *
 * This module intentionally does not execute models or depend on the legacy
 * command-center result shapes.  It describes what a model is, what evidence
 * it needs, and the states an eventual AnalysisRun adapter may persist.
 */

export const MODEL_CATALOG_SCHEMA_VERSION = "2026-07-model-catalog-v1" as const;

export const MODEL_CATEGORIES = [
  "intrinsic",
  "relative",
  "market-implied",
  "aggregator",
  "diagnostic",
] as const;

export type ValuationModelCategory = (typeof MODEL_CATEGORIES)[number];

export const MODEL_LIFECYCLES = ["production", "experimental", "deprecated"] as const;

export type ValuationModelLifecycle = (typeof MODEL_LIFECYCLES)[number];

export const MODEL_FAMILIES = [
  "industrial",
  "bank",
  "nbfc",
  "insurance",
  "telecom",
  "utility",
  "cross-family",
] as const;

export type ValuationModelFamily = (typeof MODEL_FAMILIES)[number];

export const MODEL_INTEGRATION_STATES = ["wired", "partially-wired", "not-wired"] as const;

export type ModelIntegrationState = (typeof MODEL_INTEGRATION_STATES)[number];

export type ModelRequirementKind = "fact" | "assumption" | "market" | "segment" | "sidecar";

export type ModelRequirementPurpose = "compute" | "guard" | "enrichment";

/**
 * Declarative evidence requirement. `keys` name canonical concepts or
 * assumption keys; they are not parser-specific source row labels.
 */
export interface ModelDataRequirement {
  readonly requirementId: string;
  readonly kind: ModelRequirementKind;
  readonly keys: readonly string[];
  readonly minimumObservations: number;
  readonly purpose: ModelRequirementPurpose;
  readonly description: string;
}

/** A guard is declared in the catalog even while its legacy implementation
 * still returns null/skip. This makes blocking intent explicit and reviewable.
 */
export interface ModelGuardDefinition {
  readonly guardId: string;
  readonly guardVersion: string;
  readonly blocksResult: boolean;
  readonly description: string;
}

export type ModelGuardStatus = "passed" | "warned" | "failed" | "insufficient-evidence";

export interface ModelGuardResult {
  readonly guardId: string;
  readonly guardVersion: string;
  readonly status: ModelGuardStatus;
  readonly blocksResult: boolean;
  readonly observed: number | string | boolean | null;
  readonly threshold: number | string | null;
  readonly evidenceRefs: readonly string[];
  readonly summary: string;
}

export interface ModelImplementationReference {
  /** Repository-relative module that currently contains the implementation. */
  readonly modulePath: string;
  readonly exportName: string;
  /** Optional field path when one function emits multiple conceptual lenses. */
  readonly outputPath: string | null;
  readonly integration: ModelIntegrationState;
  readonly note: string;
}

/**
 * Catalog definition. `TInputContract` is a stable contract identifier rather
 * than an executable callback: catalog artifacts must remain serializable and
 * must not infer computation from a route or strategy stamp.
 */
export interface ValuationModelDefinition<TInputContract extends string = string> {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly label: string;
  readonly description: string;
  readonly inputContract: TInputContract;
  readonly families: readonly ValuationModelFamily[];
  readonly category: ValuationModelCategory;
  readonly lifecycle: ValuationModelLifecycle;
  readonly independenceGroup: string;
  readonly requirements: readonly ModelDataRequirement[];
  readonly guards: readonly ModelGuardDefinition[];
  readonly implementation: ModelImplementationReference;
  /** Explains why the lifecycle classification is honest today. */
  readonly lifecycleNote: string;
  readonly replacementModelId: string | null;
}

export type ModelRequirementEvidenceStatus = "available" | "unavailable" | "invalid";

export interface ModelRequirementEvidence {
  readonly requirementId: string;
  readonly status: ModelRequirementEvidenceStatus;
  readonly observations: number;
  readonly evidenceRefs: readonly string[];
}

export interface ModelApplicabilityContext {
  readonly family: Exclude<ValuationModelFamily, "cross-family">;
  readonly requirementEvidence: readonly ModelRequirementEvidence[];
}

export type ModelApplicabilityResult =
  | {
      readonly status: "applicable";
      readonly modelId: string;
      readonly satisfiedRequirementIds: readonly string[];
    }
  | {
      readonly status: "not-applicable";
      readonly modelId: string;
      readonly reasonCode: "family-not-applicable" | "deprecated-model";
      readonly summary: string;
    }
  | {
      readonly status: "insufficient-evidence";
      readonly modelId: string;
      readonly reasonCode: "missing-required-evidence" | "invalid-required-evidence";
      readonly missingRequirements: readonly ModelDataRequirement[];
      readonly invalidRequirementIds: readonly string[];
      readonly summary: string;
    };

export type ValuationValueUnit = "INR_CRORE" | "INR_PER_SHARE";

interface ValuationModelResultBase {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly caseId: string | null;
}

/**
 * Canonical result-state union. A result is counted only after consulting its
 * catalog definition; neither this payload nor a strategy label can promote a
 * diagnostic, market-implied output, or aggregator into an intrinsic model.
 */
export type ValuationModelResult =
  | (ValuationModelResultBase & {
      readonly status: "computed";
      readonly enterpriseValue: number | null;
      readonly equityValue: number | null;
      readonly perShare: number | null;
      readonly unit: ValuationValueUnit;
      readonly evidenceRefs: readonly string[];
      readonly transformationRefs: readonly string[];
      readonly diagnostics: Readonly<Record<string, number | string | boolean | null>>;
      readonly guardResults: readonly ModelGuardResult[];
    })
  | (ValuationModelResultBase & {
      readonly status: "skipped" | "not-applicable" | "insufficient-evidence";
      readonly reasonCode: string;
      readonly missingRequirementIds: readonly string[];
    })
  | (ValuationModelResultBase & {
      readonly status: "invalid";
      readonly reasonCode: string;
      readonly failedGuards: readonly ModelGuardResult[];
    });

export interface ModelCatalogValidationIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly modelId: string | null;
  readonly message: string;
}

export interface GeneratedModelCatalogEntry {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly label: string;
  readonly families: readonly ValuationModelFamily[];
  readonly category: ValuationModelCategory;
  readonly lifecycle: ValuationModelLifecycle;
  readonly independenceGroup: string;
  readonly inputContract: string;
  readonly requirementIds: readonly string[];
  readonly guardIds: readonly string[];
  readonly implementation: ModelImplementationReference;
  readonly lifecycleNote: string;
  readonly replacementModelId: string | null;
}

export interface GeneratedModelCatalog {
  readonly schemaVersion: typeof MODEL_CATALOG_SCHEMA_VERSION;
  readonly catalogVersion: string;
  readonly entries: readonly GeneratedModelCatalogEntry[];
  readonly summary: {
    readonly total: number;
    readonly byCategory: Readonly<Record<ValuationModelCategory, number>>;
    readonly byLifecycle: Readonly<Record<ValuationModelLifecycle, number>>;
    readonly productionCountableModels: number;
    readonly independentProductionEvidenceGroups: number;
  };
}

export interface IndependentModelEvidenceGroup {
  readonly independenceGroup: string;
  readonly modelIds: readonly string[];
  readonly categories: readonly ("intrinsic" | "relative")[];
  /** Every finite computed result is retained; one group still counts once. */
  readonly results: readonly Extract<ValuationModelResult, { status: "computed" }>[];
}
