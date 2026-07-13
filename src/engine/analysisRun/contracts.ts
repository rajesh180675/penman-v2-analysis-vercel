import type { AnalysisTraceabilityEnvelope } from "../types";

/** Schema for the first content-addressed analysis-run contract. */
export const ANALYSIS_RUN_SCHEMA_VERSION = "2026-07-analysis-run-v1" as const;

/** SHA-256 content identity, including the algorithm prefix. */
export type Sha256ContentId = `sha256:${string}`;

export type AnalysisContentKind =
  | "fact-set"
  | "policy-bundle"
  | "model-catalog"
  | "family-analysis"
  | "analysis-window"
  | "market-snapshot"
  | "assumption-set"
  | "forecast-case"
  | "model-result"
  | "synthesis"
  | "publication"
  | "diagnostic"
  | "evidence";

/**
 * Storage-independent reference to immutable content.
 *
 * Locations and signed URLs deliberately do not belong here: they can change
 * without changing the referenced bytes and therefore are not content
 * identity.
 */
export interface ContentRef<TKind extends AnalysisContentKind = AnalysisContentKind> {
  readonly kind: TKind;
  readonly contentHash: Sha256ContentId;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly schemaVersion: string;
}

export type FactSetRef = ContentRef<"fact-set">;
export type PolicyBundleRef = ContentRef<"policy-bundle">;
export type ModelCatalogRef = ContentRef<"model-catalog">;
export type FamilyAnalysisRef = ContentRef<"family-analysis">;
export type AnalysisWindowRef = ContentRef<"analysis-window">;
export type MarketSnapshotRef = ContentRef<"market-snapshot">;
export type AssumptionSetRef = ContentRef<"assumption-set">;
export type ForecastCaseRef = ContentRef<"forecast-case">;
export type ModelResultRef = ContentRef<"model-result">;
export type SynthesisRef = ContentRef<"synthesis">;
export type PublicationRef = ContentRef<"publication">;

export type AnalysisFamily =
  | "industrial"
  | "bank"
  | "nbfc"
  | "insurance"
  | "telecom"
  | "utility";

export interface AnalysisWindow {
  readonly windowId: string;
  readonly includedPeriods: readonly string[];
  readonly excludedPeriods: readonly {
    readonly period: string;
    readonly reasonCode: string;
    readonly evidenceRefs: readonly ContentRef[];
    readonly policy: "automatic" | "analyst-confirmed";
  }[];
  readonly anchorPeriod: string | null;
  readonly selectionStatus: "confirmed" | "guarded" | "blocked";
  readonly rationale: readonly string[];
}

export interface SourcedAssumption<T> {
  readonly assumptionId: string;
  readonly key: string;
  readonly value: T;
  readonly unit: string;
  readonly mode:
    | "derived"
    | "manual-override"
    | "sector-prior"
    | "management-guidance"
    | "market-implied";
  readonly evidenceRefs: readonly ContentRef[];
  readonly periodWindow: {
    readonly from: string;
    readonly to: string;
    readonly observations: number;
  } | null;
  readonly range: {
    readonly low: T;
    readonly high: T;
    readonly method: string;
  } | null;
  readonly distribution: {
    readonly family: "point" | "normal" | "lognormal" | "triangular" | "empirical";
    readonly parameters: Readonly<Record<string, number>>;
  } | null;
  readonly confidence: "high" | "medium" | "low" | "unavailable";
  readonly reviewerState: "system" | "reviewed" | "overridden" | "locked";
}

export const ANALYSIS_STAGE_ORDER = [
  "request-validation",
  "artifact-ingestion",
  "fact-extraction",
  "concept-normalization",
  "family-classification",
  "recast",
  "structural-reconciliation",
  "economic-validation",
  "window-selection",
  "assumption-resolution",
  "forecast",
  "model-execution",
  "synthesis",
  "release-trust",
] as const;

export type AnalysisStageId = (typeof ANALYSIS_STAGE_ORDER)[number];

interface AnalysisStageResultBase {
  readonly stageId: AnalysisStageId;
  readonly stageVersion: string;
  readonly sequence: number;
  readonly inputRefs: readonly ContentRef[];
  readonly outputRefs: readonly ContentRef[];
  readonly evidenceRefs: readonly ContentRef[];
  readonly diagnosticRefs: readonly ContentRef<"diagnostic">[];
}

/**
 * Stage state is discriminated so blocked/failed work cannot masquerade as a
 * completed, blessed stage. A diagnostic-only result may exist after an
 * upstream blocker, but it continues to block progression.
 */
export type AnalysisStageResult =
  | (AnalysisStageResultBase & {
      readonly status: "not-started" | "running";
      readonly blocksNext: true;
      readonly reasonCode: null;
    })
  | (AnalysisStageResultBase & {
      readonly status: "completed";
      readonly blocksNext: false;
      readonly reasonCode: null;
    })
  | (AnalysisStageResultBase & {
      readonly status: "diagnostic-only" | "blocked";
      readonly blocksNext: true;
      readonly reasonCode: string;
      readonly blockerGateIds: readonly string[];
    })
  | (AnalysisStageResultBase & {
      readonly status: "failed";
      readonly blocksNext: true;
      readonly reasonCode: string;
      readonly errorCode: string;
    });

export type GateStatus =
  | "passed"
  | "warned"
  | "failed"
  | "insufficient-evidence"
  | "not-applicable"
  | "observed-not-enforced";

export interface GateCheck {
  readonly checkId: string;
  readonly label: string;
  readonly status: GateStatus;
  readonly blocksGate: boolean;
  readonly observed: number | string | boolean | null;
  readonly threshold: number | string | null;
  readonly unit: string | null;
  readonly evidenceRefs: readonly ContentRef[];
  readonly summary: string;
}

export interface GateResult {
  readonly gateId: string;
  readonly gateVersion: string;
  readonly stage: AnalysisStageId;
  readonly status: GateStatus;
  readonly blocksNext: boolean;
  readonly evidenceRefs: readonly ContentRef[];
  readonly checks: readonly GateCheck[];
  readonly summary: string;
}

export interface FactRequirement {
  readonly requirementId: string;
  readonly conceptIds: readonly string[];
  readonly minimumObservations: number;
  readonly periodKind: "instant" | "duration" | "either";
  readonly scope: "consolidated" | "standalone" | "segment" | "all";
  readonly reason: string;
}

export interface GuardResult {
  readonly guardId: string;
  readonly guardVersion: string;
  readonly status: "passed" | "warned" | "failed" | "insufficient-evidence";
  readonly blocksResult: boolean;
  readonly observed: number | string | boolean | null;
  readonly threshold: number | string | null;
  readonly evidenceRefs: readonly ContentRef[];
  readonly summary: string;
}

export type ValuationModelCategory = "intrinsic" | "relative" | "market-implied" | "optionality";

interface ValuationModelResultBase {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly category: ValuationModelCategory;
  readonly independenceGroup: string;
  readonly caseId: string | null;
}

export type ValuationModelResult =
  | (ValuationModelResultBase & {
      readonly status: "computed";
      readonly enterpriseValue: number | null;
      readonly equityValue: number | null;
      readonly perShare: number | null;
      readonly unit: "INR_CRORE" | "INR_PER_SHARE";
      readonly evidenceRefs: readonly ContentRef[];
      readonly transformationRefs: readonly string[];
      readonly diagnostics: Readonly<Record<string, number | string | boolean | null>>;
      readonly guardResults: readonly GuardResult[];
    })
  | (ValuationModelResultBase & {
      readonly status: "skipped" | "not-applicable" | "insufficient-evidence";
      readonly reasonCode: string;
      readonly missingRequirements: readonly FactRequirement[];
    })
  | (ValuationModelResultBase & {
      readonly status: "invalid";
      readonly reasonCode: string;
      readonly failedGuards: readonly GuardResult[];
    });

export type AnalysisRunStatus = "running" | "completed" | "blocked" | "failed";

export type AnalysisRunForkReason =
  | "assumption-change"
  | "market-refresh"
  | "policy-upgrade"
  | "model-upgrade"
  | "source-restatement"
  | "manual-rerun";

export type AnalysisRunRelation =
  | {
      readonly kind: "root";
      readonly parentRunId: null;
      readonly parentReproducibilityHash: null;
    }
  | {
      readonly kind: "child";
      readonly parentRunId: string;
      readonly parentReproducibilityHash: Sha256ContentId;
      readonly forkReason: AnalysisRunForkReason;
    };

/** Recursively read-only view used at the immutable run boundary. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

/**
 * Complete analytical payload whose stable projection is content-hashed.
 * Instance identity, lineage relation, and creation time are intentionally
 * defined separately below.
 */
export interface AnalysisRunCoreV1 {
  readonly schemaVersion: typeof ANALYSIS_RUN_SCHEMA_VERSION;
  readonly executorVersion: string;
  readonly derivationMode: "native" | "legacy-derived";
  readonly issuerId: string;
  readonly family: AnalysisFamily | null;
  readonly asOf: string;
  readonly status: AnalysisRunStatus;
  readonly sourceArtifactIds: readonly Sha256ContentId[];
  readonly factSetRef: FactSetRef;
  readonly policyBundleRef: PolicyBundleRef;
  readonly modelCatalogRef: ModelCatalogRef;
  readonly familyAnalysisRef: FamilyAnalysisRef | null;
  readonly analysisWindowRef: AnalysisWindowRef | null;
  readonly marketSnapshotRef: MarketSnapshotRef | null;
  readonly assumptionSetRef: AssumptionSetRef | null;
  readonly forecastCaseRefs: readonly ForecastCaseRef[];
  readonly modelResultRefs: readonly ModelResultRef[];
  readonly synthesisRef: SynthesisRef | null;
  readonly stageResults: readonly AnalysisStageResult[];
  readonly gateResults: readonly GateResult[];
  readonly trustEnvelope: DeepReadonly<AnalysisTraceabilityEnvelope>;
  readonly publicationRef: PublicationRef | null;
}

export interface AnalysisRunInstanceV1 {
  readonly runId: string;
  readonly relation: AnalysisRunRelation;
  readonly createdAt: string;
}

/** Input to identity finalization; it cannot carry its own hash. */
export type AnalysisRunDraftV1 = AnalysisRunCoreV1 & AnalysisRunInstanceV1;

/** Immutable, finalized run. The hash is derived only from the stable core. */
export interface AnalysisRunV1 extends AnalysisRunCoreV1, AnalysisRunInstanceV1 {
  readonly reproducibilityHash: Sha256ContentId;
}

type StableTrustRunContextV1 = Omit<
  DeepReadonly<AnalysisTraceabilityEnvelope["runContext"]>,
  "runId"
>;

export type StableTrustEnvelopeV1 = Omit<
  DeepReadonly<AnalysisTraceabilityEnvelope>,
  "generatedAt" | "runContext"
> & {
  readonly runContext: StableTrustRunContextV1;
};

/** Exact projection serialized for reproducibility identity. */
export type AnalysisRunIdentityCoreV1 = Omit<AnalysisRunCoreV1, "trustEnvelope"> & {
  readonly trustEnvelope: StableTrustEnvelopeV1;
};
