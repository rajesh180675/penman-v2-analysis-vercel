/**
 * Pinned macro pack — dated risk-free rate, ERP, and long-run nominal growth.
 *
 * These three numbers set every discount rate and terminal value in the system.
 * Today they are engine constants: `equity_risk_premium: 0.06` with
 * `erpSource: "Engine configuration"`, and terminal growth bounded by
 * `g_terminal_floor: 0.02` / `g_terminal_cap: 0.06`. A DCF resting on an
 * undated 6% ERP is a precise machine wrapped around a guess, and nothing in
 * the rigor ladder currently says so.
 *
 * This pack does not make the numbers true. It makes them *attributable* —
 * dated, sourced, and staleness-checked — which is the precondition for the
 * assumption-provenance gate to demote a run that is guessing.
 */

/**
 * Staleness windows differ because these quantities move at different speeds.
 * A risk-free rate is a traded yield that moves daily. An ERP is an annual
 * estimate. Long-run nominal growth is a structural view that barely moves
 * year to year. One shared window would either reject good ERP data or accept
 * a year-old bond yield.
 */
export const MACRO_STALENESS_DAYS = {
  riskFreeRate: 30,
  equityRiskPremium: 365,
  longRunNominalGrowth: 1095,
} as const;

export type MacroObservationKey = keyof typeof MACRO_STALENESS_DAYS;

export interface MacroObservation {
  /** Decimal fraction, e.g. 0.0685 for 6.85%. Never a percentage. */
  readonly value: number;
  /** Date the value was observed or published (YYYY-MM-DD). */
  readonly asOf: string;
  /** Attributable origin, e.g. "RBI 10Y G-Sec close" — not "Engine configuration". */
  readonly source: string;
}

export interface MacroPack {
  /** Date the pack was assembled (YYYY-MM-DD). */
  readonly asOf: string;
  readonly riskFreeRate: MacroObservation | null;
  readonly equityRiskPremium: MacroObservation | null;
  readonly longRunNominalGrowth: MacroObservation | null;
}

export type MacroObservationStatus =
  | { readonly status: "usable"; readonly key: MacroObservationKey; readonly value: number; readonly asOf: string; readonly source: string }
  | { readonly status: "unusable"; readonly key: MacroObservationKey; readonly reason: string };

/**
 * Plausibility bands. These reject data-entry and unit errors — a 6.85 that
 * should have been 0.0685, a negative ERP — and deliberately do not encode a
 * house view on what the right value is.
 */
const PLAUSIBLE_RANGE: Record<MacroObservationKey, { readonly min: number; readonly max: number }> = {
  riskFreeRate: { min: 0, max: 0.20 },
  equityRiskPremium: { min: 0.01, max: 0.15 },
  longRunNominalGrowth: { min: 0, max: 0.15 },
};

function daysBetween(fromIsoDate: string, toIsoDate: string): number | null {
  const from = Date.parse(fromIsoDate);
  const to = Date.parse(toIsoDate);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Validate one macro observation against its own staleness window.
 *
 * `unusable` carries a reason so the assumption layer can report *why* it fell
 * back to a sector prior, rather than silently substituting one.
 */
export function resolveMacroObservation(
  key: MacroObservationKey,
  observation: MacroObservation | null | undefined,
  analysisAsOf?: string | null,
): MacroObservationStatus {
  if (!observation) {
    return { status: "unusable", key, reason: `No pinned ${key} supplied.` };
  }
  if (!Number.isFinite(observation.value)) {
    return { status: "unusable", key, reason: `${key} is not a finite number.` };
  }

  const range = PLAUSIBLE_RANGE[key];
  if (observation.value < range.min || observation.value > range.max) {
    return {
      status: "unusable",
      key,
      reason: `${key} of ${observation.value} is outside the plausible band ${range.min}–${range.max}; a percentage may have been entered where a fraction was expected.`,
    };
  }
  if (!observation.source.trim()) {
    return { status: "unusable", key, reason: `${key} carries no source; an unattributed value cannot be defended.` };
  }
  if (!Number.isFinite(Date.parse(observation.asOf))) {
    return { status: "unusable", key, reason: `${key} has an invalid as-of date "${observation.asOf}".` };
  }

  if (analysisAsOf) {
    const age = daysBetween(observation.asOf, analysisAsOf);
    if (age == null) {
      return { status: "unusable", key, reason: `Cannot compare ${key} date "${observation.asOf}" with analysis date "${analysisAsOf}".` };
    }
    if (age < 0) {
      return { status: "unusable", key, reason: `${key} is dated ${observation.asOf}, after the analysis date ${analysisAsOf}; that would be look-ahead.` };
    }
    const limit = MACRO_STALENESS_DAYS[key];
    if (age > limit) {
      return { status: "unusable", key, reason: `${key} is ${age} days old (dated ${observation.asOf}); limit is ${limit} days.` };
    }
  }

  return { status: "usable", key, value: observation.value, asOf: observation.asOf, source: observation.source };
}

export interface MacroPackResolution {
  readonly riskFreeRate: MacroObservationStatus;
  readonly equityRiskPremium: MacroObservationStatus;
  readonly longRunNominalGrowth: MacroObservationStatus;
  /** True only when all three are usable — the precondition for a fully sourced capital cost. */
  readonly complete: boolean;
}

export function resolveMacroPack(
  pack: MacroPack | null | undefined,
  analysisAsOf?: string | null,
): MacroPackResolution {
  const riskFreeRate = resolveMacroObservation("riskFreeRate", pack?.riskFreeRate, analysisAsOf);
  const equityRiskPremium = resolveMacroObservation("equityRiskPremium", pack?.equityRiskPremium, analysisAsOf);
  const longRunNominalGrowth = resolveMacroObservation("longRunNominalGrowth", pack?.longRunNominalGrowth, analysisAsOf);
  return {
    riskFreeRate,
    equityRiskPremium,
    longRunNominalGrowth,
    complete: [riskFreeRate, equityRiskPremium, longRunNominalGrowth].every((item) => item.status === "usable"),
  };
}
