/**
 * Per-number lineage types — Gap 4 / PR-D.
 *
 * For each of the 8 instrumented numbers (NOA, NFO, CSE, CoreOI, RNOA,
 * IntrinsicValuePerShare, FreeCashFlow, PAT) we record where the number
 * came from: which raw source keys / statements contributed, what
 * transformations the pipeline applied, and which policy decisions
 * touched it.
 *
 * Lineage lives in the audit snapshot (sidecar), NOT the envelope. The
 * envelope only carries a `lineageRef` summary (checksum + concept
 * count) so envelope JSON serialization stays bounded. See ADR-004.
 */

/** The 8 numbers we instrument. Stable string IDs (kebab-case) so they
 *  travel safely through JSON without depending on Concept Identity
 *  registry changes. */
export type LineageConceptId =
  | "noa"
  | "nfo"
  | "cse"
  | "core-oi"
  | "rnoa"
  | "intrinsic-value-per-share"
  | "free-cash-flow"
  | "pat"
  // Phase 1 — financial-institution instrumented concepts
  | "total-assets"
  | "total-equity"
  | "net-interest-income"
  | "operating-profit"
  | "advances"
  | "deposits"
  | "credit-cost";

/** All instrumented concepts in display order. */
export const LINEAGE_CONCEPT_IDS: readonly LineageConceptId[] = [
  "noa",
  "nfo",
  "cse",
  "core-oi",
  "rnoa",
  "free-cash-flow",
  "pat",
  "intrinsic-value-per-share",
  // Financial-institution concepts
  "total-assets",
  "total-equity",
  "net-interest-income",
  "operating-profit",
  "advances",
  "deposits",
  "credit-cost",
] as const;

/** Concepts that are derived or specific to financial institutions and
 *  should not be expected to have a recast value on industrial rows. */
export const FINANCIAL_LINEAGE_CONCEPT_IDS: readonly LineageConceptId[] = [
  "total-assets",
  "total-equity",
  "net-interest-income",
  "operating-profit",
  "advances",
  "deposits",
  "credit-cost",
];

/** Caps applied when building lineage. Plan v4 N-3 budgets:
 *  ≤50 sourceMetricKeys, ≤20 transformationSteps, ≤10 policyDecisionsApplied
 *  per (concept, period) entry. */
export const LINEAGE_SOURCE_KEYS_CAP = 50;
export const LINEAGE_TRANSFORMATION_STEPS_CAP = 20;
export const LINEAGE_POLICY_DECISIONS_CAP = 10;

export interface NumberLineage {
  conceptId: LineageConceptId;
  period: string;
  finalValue: number | null;
  sourceMetricKeys: string[];
  sourceStatements: ("BS" | "IS" | "CF" | "SD")[];
  transformationSteps: string[];
  policyDecisionsApplied: string[];
  confidence: "high" | "medium" | "low" | "estimated";
  warnings: string[];
}

export interface LineageMap {
  /** Keyed by `${conceptId}|${period}` so a single map can carry
   *  every (concept, period) pair without nested structure. */
  entries: Record<string, NumberLineage>;
  /** Total bytes (approximate, JSON-stringified length). */
  sizeBytes: number;
  /** Whether any per-entry cap fired during construction. */
  truncated: boolean;
}

/** Lightweight ref carried in the envelope. Does NOT contain the lineage
 *  data itself — that lives in the audit snapshot. */
export interface LineageRef {
  hasLineage: boolean;
  conceptCount: number;
  periodCount: number;
  /** SHA-256-like checksum (hex) of the serialized lineage map.
   *  Used to detect drift between envelope and snapshot. */
  checksum: string;
}
