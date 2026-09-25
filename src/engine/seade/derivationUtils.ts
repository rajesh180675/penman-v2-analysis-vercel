/**
 * SEADE — shared derivation helpers.
 *
 * Small, pure utilities for reading recast periods and building provenance.
 * No I/O, no randomness, no external calls.
 */
import type { RecastPeriod } from "../types";
import type { DerivationProvenance } from "./types";

/** Latest period in the array, or null when empty. */
export function latestPeriod(periods: readonly RecastPeriod[]): RecastPeriod | null {
  return periods.length ? periods[periods.length - 1]! : null;
}

/** Finite number or null. */
export function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Median of a finite numeric array; null when empty. */
export function median(values: readonly number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1]! + xs[mid]!) / 2 : xs[mid]!;
}

/** Build a provenance record. */
export function prov(
  sourceFields: readonly string[],
  formula: string,
  confidence: DerivationProvenance["confidence"],
  priorUsed: string | null = null,
): DerivationProvenance {
  return Object.freeze({ sourceFields: Object.freeze([...sourceFields]), formula, priorUsed, confidence });
}

/** Read a numeric balance-sheet field from the latest period. */
export function bs(
  period: RecastPeriod | null,
  field: keyof RecastPeriod["bs"],
): number | null {
  return finiteOrNull(period?.bs[field] as number | null | undefined);
}

/** Read a numeric income-statement field from the latest period. */
export function is(
  period: RecastPeriod | null,
  field: keyof RecastPeriod["is"],
): number | null {
  return finiteOrNull(period?.is[field] as number | null | undefined);
}

/** Read a numeric cash-flow field from the latest period. */
export function cf(
  period: RecastPeriod | null,
  field: keyof RecastPeriod["cf"],
): number | null {
  return finiteOrNull(period?.cf[field] as number | null | undefined);
}

/** Read a trace-line value from the latest period (raw source read). */
export function traceValue(period: RecastPeriod | null, line: string): number | null {
  const entries = period?.trace?.[line];
  if (!entries?.length) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const value = entries[index]?.value;
    if (Number.isFinite(value)) return value!;
  }
  return null;
}

/** Check whether a trace line has real (non-derived, non-unmatched) evidence. */
export function hasTraceEvidence(period: RecastPeriod | null | undefined, line: string): boolean {
  const entries = period?.trace?.[line];
  if (!entries?.length) return false;
  return entries.some((entry) =>
    entry.statement !== "Derived"
    && entry.note !== "unmatched"
    && !entry.note?.startsWith("duplicate_source_ignored:")
  );
}

/** Clamp a number into [lo, hi]. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}
