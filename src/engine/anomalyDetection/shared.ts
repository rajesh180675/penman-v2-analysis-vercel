import { SpecFlag, Severity, type EngineConfig, type RecastPeriod } from "../types";
import { CORE_TAX_RATE_BAND, filedTaxRate, normalTaxRate } from "../PenmanNissimEngine/unusualTax";

/* ── Helpers ────────────────────────────────────────────────────── */

export function medianOf(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

export function madStddev(vals: number[]): number {
  const med = medianOf(vals);
  if (med == null) return 0.001;
  const mad = medianOf(vals.map(v => Math.abs(v - med))) ?? 0.001;
  return Math.max(mad * 1.4826, 0.001); // MAD × 1.4826 ≈ robust σ
}

export function flag(
  spec_id: string, severity: Severity, label: string,
  message: string, affects_terminal: boolean, period: string
): SpecFlag {
  return { spec_id, severity, label, message, affects_terminal, period };
}

/**
 * Core OI is OI less the unusual items, and it carries the tax the recast
 * applies. It is comparable with its history only when that rate is within
 * CORE_TAX_RATE_BAND of the normal rate (the median filed rate of the three
 * years before): a year filed at an unusual rate is, once the recast has taxed
 * it at the normal rate and moved the rest to UOI. A year with no filed rate
 * (effective mode fell back to statutory) or no history is not.
 */
export function coreTaxComparable(periods: readonly RecastPeriod[], index: number, cfg: EngineConfig): boolean {
  const period = periods[index];
  if (!period || filedTaxRate(period, cfg) == null) return false;
  const reference = normalTaxRate(periods.slice(0, index), cfg);
  return reference != null && Math.abs(period.is.taxRate - reference) <= CORE_TAX_RATE_BAND;
}
