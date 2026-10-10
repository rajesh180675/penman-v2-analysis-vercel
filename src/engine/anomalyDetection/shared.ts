import { SpecFlag, Severity, type EngineConfig, type RecastPeriod } from "../types";

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
 * Core OI is OI less the filed one-off lines, but it carries the year's
 * effective tax. A one-time tax benefit (a deferred-tax asset recognized) is
 * filed in the tax line, not as an exceptional item, so core OI inherits it:
 * Airtel FY25 taxed at 2.4% against 32.5% the year before, and its core OI
 * rose ₹22,616 Cr on ₹23,003 Cr of sales. Core is comparable with its history
 * only when the year's rate is within this many points of the median of the
 * three years before it (a trailing window follows a statutory rate change).
 */
export const CORE_TAX_RATE_BAND = 0.10;
const CORE_TAX_WINDOW = 3;

/** The year's effective tax rate, or null where the recast fell back to the statutory rate. */
function effectiveTaxRate(period: RecastPeriod, cfg: EngineConfig): number | null {
  const rate = period.is?.taxRate;
  if (rate == null || !Number.isFinite(rate)) return null;
  if (cfg.tax_rate_mode === "effective" && rate === cfg.statutory_tax_rate) return null;
  return rate;
}

export function coreTaxComparable(periods: readonly RecastPeriod[], index: number, cfg: EngineConfig): boolean {
  const rate = periods[index] ? effectiveTaxRate(periods[index]!, cfg) : null;
  if (rate == null) return false;
  const prior = periods.slice(Math.max(0, index - CORE_TAX_WINDOW), index)
    .map((p) => effectiveTaxRate(p, cfg))
    .filter((r): r is number => r != null);
  const reference = medianOf(prior);
  return reference != null && Math.abs(rate - reference) <= CORE_TAX_RATE_BAND;
}
