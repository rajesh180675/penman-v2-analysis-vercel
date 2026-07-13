/**
 * Canonical fact contracts â€” Wave 2 / PR 2.1.
 *
 * These are persistence-boundary types. Numeric source values remain decimal
 * strings here; conversion into bounded branded numbers belongs at the
 * computation boundary. Every field is readonly so downstream stages build a
 * new fact or fact set rather than mutating filing history in place.
 */

import type { Sha256ContentId } from "../analysisRun";

export const FACT_SET_SCHEMA_VERSION = "canonical-fact-set-v1" as const;

/** Reuse the AnalysisRun content-addressing contract instead of defining a competing hash shape. */
export type Sha256Id = Sha256ContentId;
export type SourceMode = "capitaline" | "screener" | "xbrl" | "json" | "manual" | "sidecar";
export type FactScope = "consolidated" | "standalone" | "segment" | "unknown";
export type FactStatement = "BS" | "IS" | "CF" | "OCI" | "EQUITY" | "SEGMENT" | "MARKET";
export type AccountingStandard = "ind-as" | "ifrs" | "revised-sch-vi" | "standard" | "unknown";

export interface SourceArtifact {
  readonly artifactId: Sha256Id;
  readonly fileName: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sourceMode: SourceMode;
  /** Canonical UTC timestamp, or null when the acquisition time was not recorded. */
  readonly acquiredAt: string | null;
  /** Filing date represented as YYYY-MM-DD, or null when unavailable. */
  readonly filingAsOf: string | null;
  readonly issuerId: string;
  readonly scope: FactScope;
  readonly parserVersion: string;
  readonly contentClass: string;
}

export type FactPeriodKind = "instant" | "duration";
export type FactFrequency = "annual" | "quarterly" | "ttm" | "unknown";

export interface FactPeriod {
  /** Null for instant facts; required for duration facts. */
  readonly start: string | null;
  readonly end: string;
  readonly kind: FactPeriodKind;
  readonly frequency: FactFrequency;
}

export type SourceNumericScale =
  | "absolute"
  | "thousand"
  | "lakh"
  | "million"
  | "crore"
  | "ratio"
  | "count";

/**
 * Explicit persisted units. Similar-looking values such as INR crore and
 * crore shares are intentionally different strings and cannot be inferred
 * from source scale alone.
 */
export type NumericFactUnit =
  | "INR_ABSOLUTE"
  | "INR_CRORE"
  | "INR_PER_SHARE"
  | "ABSOLUTE_SHARES"
  | "CRORE_SHARES"
  | "FRACTION"
  | "RATIO"
  | "COUNT";

export type CanonicalFactUnit = NumericFactUnit | "BOOLEAN" | "DATE" | "TEXT";

export interface NumericFactValue {
  readonly kind: "numeric";
  /** Exact canonical decimal syntax; never a JavaScript number. */
  readonly decimal: string;
  readonly currency: string | null;
  readonly sourceScale: SourceNumericScale;
  readonly normalizedUnit: NumericFactUnit;
}

export interface DateFactValue {
  readonly kind: "date";
  readonly date: string;
  /** Original label/value when it differs from the normalized ISO date. */
  readonly sourceText: string | null;
  readonly normalizedUnit: "DATE";
}

export interface TextFactValue {
  readonly kind: "text";
  readonly text: string;
  readonly normalizedUnit: "TEXT";
}

export interface BooleanFactValue {
  readonly kind: "boolean";
  readonly boolean: boolean;
  readonly sourceText: string | null;
  readonly normalizedUnit: "BOOLEAN";
}

export type CanonicalFactValue =
  | NumericFactValue
  | DateFactValue
  | TextFactValue
  | BooleanFactValue;
export type FactDimensions = Readonly<Record<string, string>>;

/**
 * Source coordinates are nullable, never populated with 0, -1, "unknown", or
 * other invented sentinels. Rows and columns are one-based when known.
 */
export interface OriginLocator {
  readonly sheet: string | null;
  readonly row: number | null;
  readonly column: number | null;
  readonly cellRange: string | null;
  readonly xbrlContextId: string | null;
}

export interface ReportedFactOrigin extends OriginLocator {
  readonly kind: "reported";
  readonly artifactId: Sha256Id;
  readonly parserMethod: string;
}

export interface ManualFactOrigin extends OriginLocator {
  readonly kind: "manual";
  readonly artifactId: Sha256Id;
  readonly parserMethod: "manual";
  readonly entryRef: string | null;
  readonly enteredBy: string | null;
}

export interface DerivedFactOrigin extends OriginLocator {
  readonly kind: "derived";
  /** All source artifacts reachable from the input facts. */
  readonly sourceArtifactIds: readonly Sha256Id[];
  readonly parserMethod: "derived";
  readonly transformationId: string;
  readonly formulaVersion: string;
  readonly inputFactIds: readonly string[];
}

interface CanonicalFactBase {
  readonly factId: string;
  readonly issuerId: string;
  readonly conceptId: string;
  readonly rawLabel: string;
  readonly statement: FactStatement;
  readonly period: FactPeriod;
  readonly value: CanonicalFactValue;
  readonly scope: FactScope;
  readonly dimensions: FactDimensions;
  readonly accountingStandard: AccountingStandard;
  /** Changes for an amended/restated filing; restatements are never overwrites. */
  readonly filingVersion: string;
}

export interface ReportedCanonicalFact extends CanonicalFactBase {
  readonly factKind: "reported";
  readonly confidence: "exact" | "mapped" | "inferred";
  readonly origin: ReportedFactOrigin;
}

export interface ManualCanonicalFact extends CanonicalFactBase {
  readonly factKind: "manual";
  readonly confidence: "manual";
  readonly origin: ManualFactOrigin;
}

export interface DerivedCanonicalFact extends CanonicalFactBase {
  readonly factKind: "derived";
  readonly confidence: "derived";
  readonly origin: DerivedFactOrigin;
}

export type CanonicalFact = ReportedCanonicalFact | ManualCanonicalFact | DerivedCanonicalFact;

/**
 * Self-contained canonical fact payload. Artifact bytes remain in object
 * storage; this set carries only immutable artifact metadata and facts.
 */
export interface FactSetContent {
  readonly schemaVersion: typeof FACT_SET_SCHEMA_VERSION;
  readonly issuerId: string;
  readonly sourceArtifacts: readonly SourceArtifact[];
  readonly facts: readonly CanonicalFact[];
}

/** The id is a SHA-256 of the canonical FactSetContent projection, never of itself. */
export interface FactSet extends FactSetContent {
  readonly factSetId: Sha256Id;
}

/** Identity fields that prevent restatements or differently scoped facts from overwriting one another. */
export interface CanonicalFactIdentity {
  readonly issuerId: string;
  readonly conceptId: string;
  readonly statement: FactStatement;
  readonly factKind: CanonicalFact["factKind"];
  readonly period: FactPeriod;
  readonly unit: CanonicalFactUnit;
  readonly currency: string | null;
  readonly scope: FactScope;
  readonly dimensions: FactDimensions;
  readonly accountingStandard: AccountingStandard;
  readonly filingVersion: string;
  readonly sourceArtifactIds: readonly Sha256Id[];
}

export type ContractErrorCode =
  | "invalid-type"
  | "missing-field"
  | "unexpected-field"
  | "invalid-enum"
  | "invalid-identifier"
  | "invalid-hash"
  | "invalid-date"
  | "invalid-timestamp"
  | "invalid-decimal"
  | "invalid-unit"
  | "invalid-currency"
  | "invalid-period"
  | "invalid-dimension"
  | "invalid-locator"
  | "invalid-origin"
  | "issuer-mismatch"
  | "missing-artifact"
  | "duplicate-artifact"
  | "duplicate-fact-id"
  | "duplicate-fact-identity"
  | "conflicting-fact-identity"
  | "missing-input-fact"
  | "cyclic-derivation"
  | "empty-fact-set"
  | "unsupported-value"
  | "non-finite-number"
  | "cyclic-value";

export interface ContractError {
  readonly code: ContractErrorCode;
  /** JSONPath-like location rooted at `$`. */
  readonly path: string;
  readonly message: string;
}

export type FailClosedResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly [ContractError, ...ContractError[]] };

declare const VALIDATED_ARTIFACT: unique symbol;
declare const VALIDATED_FACT: unique symbol;
declare const VALIDATED_FACT_SET_CONTENT: unique symbol;
declare const VALIDATED_FACT_SET: unique symbol;

export type ValidatedSourceArtifact = SourceArtifact & { readonly [VALIDATED_ARTIFACT]: true };
export type ValidatedCanonicalFact = CanonicalFact & { readonly [VALIDATED_FACT]: true };
export type ValidatedFactSetContent = FactSetContent & {
  readonly [VALIDATED_FACT_SET_CONTENT]: true;
};
export type ValidatedFactSet = FactSet & { readonly [VALIDATED_FACT_SET]: true };
