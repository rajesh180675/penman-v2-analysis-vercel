export {
  CURRENT_MODEL_CATALOG_VERSION,
  CURRENT_MODEL_DEFINITIONS,
  CURRENT_MODEL_REGISTRY,
} from "./definitions";

export {
  generateModelCatalog,
  generateModelCatalogMarkdown,
} from "./generation";

export {
  countFiniteComputedModels,
  countIndependentModelEvidenceGroups,
  groupIndependentModelEvidence,
  independenceGroupsForModelIds,
  selectFiniteComputedModelResults,
} from "./evidence";

export { adaptLegacyCommandCenterModelResults } from "./legacyAdapters";

export type {
  FiniteComputedModelSelection,
  ModelCountOptions,
} from "./evidence";

export {
  evaluateModelApplicability,
  ModelCatalogValidationError,
  validateModelCatalog,
  ValuationModelRegistry,
} from "./registry";

export {
  MODEL_CATALOG_SCHEMA_VERSION,
  MODEL_CATEGORIES,
  MODEL_FAMILIES,
  MODEL_INTEGRATION_STATES,
  MODEL_LIFECYCLES,
} from "./types";

export type {
  GeneratedModelCatalog,
  GeneratedModelCatalogEntry,
  IndependentModelEvidenceGroup,
  ModelApplicabilityContext,
  ModelApplicabilityResult,
  ModelCatalogValidationIssue,
  ModelDataRequirement,
  ModelGuardDefinition,
  ModelGuardResult,
  ModelGuardStatus,
  ModelImplementationReference,
  ModelIntegrationState,
  ModelRequirementEvidence,
  ModelRequirementEvidenceStatus,
  ModelRequirementKind,
  ModelRequirementPurpose,
  ValuationModelCategory,
  ValuationModelDefinition,
  ValuationModelFamily,
  ValuationModelLifecycle,
  ValuationModelResult,
  ValuationValueUnit,
} from "./types";
