/**
 * LandingDataSource — envelope describing what was loaded into the app.
 *
 * Replaces the single `rawData: RawPeriodData[]` model with a structure that
 * carries both consolidated and (optionally) standalone datasets, plus the
 * pre-computed scope-aware result when both are present.
 *
 * Why this exists:
 *   - Indian companies file BOTH consolidated (parent + subsidiaries merged)
 *     AND standalone (parent only) statements.
 *   - Most valuation work uses consolidated. But the gap (consolidated −
 *     standalone) reveals subsidiary contribution, which is critical for:
 *       (a) cross-validating SOTP segment definitions
 *       (b) catching inter-company dividend leakage in standalone "Other Income"
 *       (c) detecting structural shifts (parent shrinking vs subsidiaries growing)
 *
 *   The single-rawData model forced users to pick one or the other; this
 *   envelope lets the app load both in tandem and surface the gap analysis.
 */

import type { RawPeriodData } from "./types";
import type { ScopeAwareResult } from "./scopeAwareLoader";

export interface LandingDataSource {
  /** Always present. Drives the main valuation pipeline. */
  consolidated: RawPeriodData[];

  /** Optional. Present when the user loaded a company that has standalone
   *  statements available (registry.hasStandalone === true), or when the
   *  user explicitly added a second standalone ZIP via "Add for cross-check".
   *  null when only consolidated was loaded. */
  standalone: RawPeriodData[] | null;

  /** Pre-computed scope-aware result when standalone is present. Carries
   *  per-period subsidiary contribution (cons − stan) and summary stats.
   *  null when standalone is null. */
  scopeAwareResult: ScopeAwareResult | null;
}

/** Helper: returns the dataset that the main valuation pipeline should use.
 *  Always consolidated when present (it's the academically correct choice). */
export function primaryDataset(source: LandingDataSource): RawPeriodData[] {
  return source.consolidated;
}

/** Helper: true when both scopes are available and the gap analysis is meaningful. */
export function hasDualScope(source: LandingDataSource | null): source is LandingDataSource & {
  standalone: RawPeriodData[];
  scopeAwareResult: ScopeAwareResult;
} {
  return source != null
    && source.standalone != null
    && source.standalone.length > 0
    && source.scopeAwareResult != null;
}
