/* Pure type leaf — assumptionProvenance envelope block (schema v21).

   The structural blocks (parserFidelity, reconciliation, …) say whether the DATA
   can be trusted. analyticalDepth says how much analysis RAN. This block says
   how much of the capital cost was actually OBSERVED rather than assumed.

   It exists because the cost-of-capital resolver used to source its two most
   sensitive inputs from constants — a sector beta table and a config
   `equity_risk_premium`, stamped `erpSource: "Engine configuration"` — and
   nothing in the rigor ladder flagged it, because the value resolved without
   error. A precise machine wrapped around a guess reads exactly like a precise
   machine wrapped around evidence.

   Mirrors the shape of the other blocks (status enum + summary + counts +
   checks[]) so the trust panel reads it uniformly. Contains ONLY types and
   imports nothing, keeping it a pure leaf. */

/**
 * Provenance strength of one assumption.
 *
 * Mirrors `AssumptionTier` in `engine/assumptions/capitalCostAssumptions`. It is
 * restated here rather than imported so this file stays a pure leaf; the builder
 * asserts the two stay assignable, so drift is a compile error rather than a
 * silent mismatch.
 */
export type AssumptionProvenanceTier = "estimated" | "sourced" | "prior";

export type AssumptionProvenanceStatus =
  /** Every input is computed from data we hold or attributable to a dated source. */
  | "defensible"
  /** Some inputs are defensible, at least one rests on an undated prior. */
  | "mixed"
  /** Every input rests on a prior. */
  | "prior-dependent"
  /** No tiered inputs were reported — e.g. a manual ke, or valuation did not run. */
  | "absent";

export interface AssumptionProvenanceCheck {
  /** Stable key, e.g. "beta" — matches the cost evidence component. */
  key: string;
  label: string;
  tier: AssumptionProvenanceTier;
  value: number | null;
  /** Attributable origin. For a prior, names the default that was applied. */
  source: string;
  /** Observation date. Null for a prior, which is dateless by nature. */
  asOf: string | null;
  detail: string;
}

export interface AssumptionProvenanceSummary {
  status: AssumptionProvenanceStatus;
  summary: string;
  /** Inputs computed from held data or attributable to a dated source. */
  defensibleCount: number;
  /** Inputs resting on an undated prior. */
  priorCount: number;
  /** Keys of the prior-tier inputs, so a reviewer sees which number is a guess. */
  priorTierKeys: string[];
  checks: AssumptionProvenanceCheck[];
}
