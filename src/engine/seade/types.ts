/**
 * SEADE — Sector Evidence Auto-Derivation Engine (types)
 *
 * Converts parsed financial evidence (balance sheet, P&L, cash flow) into the
 * typed operational inputs the existing sector-native case calculators need.
 *
 * Design rules:
 * - Pure functions, deterministic, no I/O.
 * - Fail-closed: insufficient evidence returns derivationStatus "insufficient-evidence"
 *   with an explicit missing-fields list; never fabricate inputs.
 * - Provenance is mandatory: every derived input records which source fields
 *   were read, which formula was applied, and which prior (if any) was used.
 * - Additive: consumes existing RecastPeriod[] and EngineConfig; never mutates
 *   the pipeline or the valuation engine.
 */
import type { CompanyType } from "../types";
import type { SectorCaseInput, SectorCaseType } from "../sectorCases/contracts";
import type { SectorOnboardingRow } from "../sectorCases/onboarding";

export const SEADE_SCHEMA_VERSION = "2026-08-seade-v1" as const;

/** How a single derived input was produced. */
export interface DerivationProvenance {
  /** Canonical trace lines / recast fields read, e.g. ["bs.OA_PPE","is.Sales"]. */
  readonly sourceFields: readonly string[];
  /** Human-readable derivation rule, e.g. "PPE + CWIP × eligibility + regulatory deferrals". */
  readonly formula: string;
  /** Sector-template prior key when no direct observation was available, else null. */
  readonly priorUsed: string | null;
  /** "high" = direct observation; "medium" = derived from observed fields; "low" = prior-only. */
  readonly confidence: "high" | "medium" | "low";
}

/** A typed sector case input plus the provenance that produced it. */
export interface DerivedSectorCaseInput<T extends SectorCaseType = SectorCaseType> {
  readonly caseType: T;
  readonly issuerId: string;
  readonly asOf: string;
  readonly inputs: Extract<SectorCaseInput, { caseType: T }>;
  readonly provenance: Readonly<Record<string, DerivationProvenance>>;
  /** Evidence requirement IDs (from the case registry) that could NOT be satisfied. */
  readonly missingEvidence: readonly string[];
  readonly derivationStatus: "ready" | "insufficient-evidence" | "not-applicable";
  /** Why not-applicable or insufficient; empty when ready. */
  readonly reason: string;
}

/** SEADE top-level result. */
export interface SeadeResult {
  readonly schemaVersion: typeof SEADE_SCHEMA_VERSION;
  readonly derived: DerivedSectorCaseInput | null;
  /** Onboarding row compatible with the existing governed-sidecar manifest. */
  readonly onboardingRow: SectorOnboardingRow;
}

/** Input bundle the derivation engine consumes. */
export interface SeadeInput {
  readonly issuerId: string;
  readonly companyType: Exclude<CompanyType, "auto">;
  readonly periods: readonly import("../types").RecastPeriod[];
  readonly config: import("../types").EngineConfig;
  /** Resolved diluted shares in crores (from resolveShareBasis). */
  readonly sharesOutstandingCr: number | null;
  /** Analysis as-of date (YYYY-MM-DD); defaults to latest period_end. */
  readonly asOf?: string | undefined;
}
