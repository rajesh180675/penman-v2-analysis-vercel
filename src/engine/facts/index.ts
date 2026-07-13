export { FACT_SET_SCHEMA_VERSION } from "./contracts";

export type {
  AccountingStandard,
  BooleanFactValue,
  CanonicalFact,
  CanonicalFactIdentity,
  CanonicalFactUnit,
  CanonicalFactValue,
  ContractError,
  ContractErrorCode,
  DateFactValue,
  DerivedCanonicalFact,
  DerivedFactOrigin,
  FactDimensions,
  FactFrequency,
  FactPeriod,
  FactPeriodKind,
  FactScope,
  FactSet,
  FactSetContent,
  FactStatement,
  FailClosedResult,
  ManualCanonicalFact,
  ManualFactOrigin,
  NumericFactUnit,
  NumericFactValue,
  OriginLocator,
  ReportedCanonicalFact,
  ReportedFactOrigin,
  Sha256Id,
  SourceArtifact,
  SourceMode,
  SourceNumericScale,
  TextFactValue,
  ValidatedCanonicalFact,
  ValidatedFactSet,
  ValidatedFactSetContent,
  ValidatedSourceArtifact,
} from "./contracts";

export {
  canonicalFactIdentityKey,
  canonicalizeCanonicalFact,
  canonicalizeCanonicalFactIdentity,
  canonicalizeFactSetContent,
  factSetContentRef,
  hashFactSetContent,
  selectCanonicalFactIdentity,
  selectFactSetIdentityContent,
  sourceArtifactIdsForFact,
  verifyFactSetIdentity,
} from "./identity";

export {
  validateCanonicalFact,
  validateFactSet,
  validateFactSetContent,
  validateSourceArtifact,
} from "./validation";

export { createFactSet, validateAndVerifyFactSet } from "./factory";

export { adaptLegacyRawPeriodsToFactSet } from "./legacyRawAdapter";
export type {
  LegacyConceptMapping,
  LegacyFactAdapterDiagnostic,
  LegacyFactAdapterResult,
  LegacyPeriodSource,
  LegacyMetricOrigin,
  LegacyUnitTrace,
} from "./legacyRawAdapter";

export {
  CANONICAL_SOURCE_ADAPTER_VERSION,
  buildCapitalineCanonicalFactBundle,
  buildOntologyConceptMappings,
  buildTextCanonicalFactBundle,
} from "./sourceAdapters";
export type { CanonicalFactIngestionBundle } from "./sourceAdapters";

export {
  TRANSFORMATION_DAG_SCHEMA_VERSION,
  TransformationRecorder,
  createTransformationDag,
  createTransformationNode,
} from "./transformationDag";
export type {
  TransformationDag,
  TransformationDagError,
  TransformationDagResult,
  TransformationNode,
  TransformationNodeCore,
} from "./transformationDag";
