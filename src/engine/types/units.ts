/* ================================================================
   Branded primitives for unit-semantic-aware numbers.
   Plan 1 PR-1.4 (Schema v12 → v13).

   The `__brand` field is a phantom — it never exists at runtime, but
   TypeScript treats `INRCrore` and `INRAbsolute` as incompatible types
   even though both are `number` underneath. This catches the unit
   contract bugs the parser and valuation modules have repeatedly hit.

   Convention:
     - All Capitaline / Indian-context monetary values are INRCrore.
     - All shares_outstanding values from the registry are CroreShares.
     - All ratios in [0, 1] are PercentFraction (NOT 0–100).
     - All BPS spreads are BasisPoints (1 bps = 0.0001 = 0.01% fraction).

   Constructors validate; accessors are zero-cost.

   Cascade plan: this PR ships the module + tests + schema bump.
   Refactoring 200+ callsites to consume branded types is deferred
   to follow-up PRs (one per pipeline stage) so each refactor is
   independently reviewable and reverts cleanly if a unit assumption
   was wrong.
================================================================ */

declare const INR_CRORE_BRAND: unique symbol;
declare const INR_ABSOLUTE_BRAND: unique symbol;
declare const CRORE_SHARES_BRAND: unique symbol;
declare const ABSOLUTE_SHARES_BRAND: unique symbol;
declare const PERCENT_FRACTION_BRAND: unique symbol;
declare const BASIS_POINTS_BRAND: unique symbol;

export type INRCrore        = number & { readonly [INR_CRORE_BRAND]: never };
export type INRAbsolute     = number & { readonly [INR_ABSOLUTE_BRAND]: never };
export type CroreShares     = number & { readonly [CRORE_SHARES_BRAND]: never };
export type AbsoluteShares  = number & { readonly [ABSOLUTE_SHARES_BRAND]: never };
export type PercentFraction = number & { readonly [PERCENT_FRACTION_BRAND]: never };
export type BasisPoints     = number & { readonly [BASIS_POINTS_BRAND]: never };

/** Construct an INRCrore. Rejects NaN/Infinity. Negative allowed (losses). */
export const INRCrore = (n: number): INRCrore => {
  if (!Number.isFinite(n)) throw new TypeError(`INRCrore: ${n} is not finite`);
  return n as INRCrore;
};

/** Construct an INRAbsolute. Rejects NaN/Infinity. Negative allowed. */
export const INRAbsolute = (n: number): INRAbsolute => {
  if (!Number.isFinite(n)) throw new TypeError(`INRAbsolute: ${n} is not finite`);
  return n as INRAbsolute;
};

/** Construct a CroreShares. Must be non-negative + finite. */
export const CroreShares = (n: number): CroreShares => {
  if (n < 0 || !Number.isFinite(n)) throw new TypeError(`CroreShares: ${n} invalid`);
  return n as CroreShares;
};

/** Construct an AbsoluteShares. Must be a non-negative integer. */
export const AbsoluteShares = (n: number): AbsoluteShares => {
  if (n < 0 || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new TypeError(`AbsoluteShares: ${n} must be a non-negative integer`);
  }
  return n as AbsoluteShares;
};

/**
 * Construct a PercentFraction. Plausible range [-2, 5] —
 *   -2 = -200% (e.g. extreme negative growth)
 *   +5 = +500% (e.g. one-time burst growth)
 * Throws on values outside [-2, 5] to catch percent-vs-fraction mixups
 * (a value of 13 was almost certainly meant as 0.13).
 */
export const PercentFraction = (n: number): PercentFraction => {
  if (!Number.isFinite(n)) throw new TypeError(`PercentFraction: ${n} not finite`);
  if (n < -2 || n > 5) throw new RangeError(`PercentFraction: ${n} out of plausible range [-2, 5]`);
  return n as PercentFraction;
};

/** Construct BasisPoints. 1 bps = 0.0001. */
export const BasisPoints = (n: number): BasisPoints => {
  if (!Number.isFinite(n)) throw new TypeError(`BasisPoints: ${n} not finite`);
  return n as BasisPoints;
};

/* ── Conversions — explicit, never automatic ───────────────────── */

export const croreToAbsolute = (c: INRCrore): INRAbsolute => INRAbsolute(c * 1e7);
export const absoluteToCrore = (a: INRAbsolute): INRCrore => INRCrore(a / 1e7);
export const croreSharesToAbsolute = (c: CroreShares): AbsoluteShares =>
  AbsoluteShares(Math.round(c * 1e7));
export const absoluteSharesToCrore = (a: AbsoluteShares): CroreShares => CroreShares(a / 1e7);
export const fractionToBps = (f: PercentFraction): BasisPoints => BasisPoints(f * 10000);
export const bpsToFraction = (b: BasisPoints): PercentFraction => PercentFraction(b / 10000);

/**
 * Market capitalisation in INR crore.
 *
 * A rupee-per-share price multiplied by shares expressed in crores is
 * already numerically INR crore. Converting the share count to absolute
 * shares and dividing by 1e7 again would apply the crore conversion twice.
 */
export const marketCapCroreFromPrice = (
  pricePerShare: INRAbsolute,
  shares: CroreShares,
): INRCrore => INRCrore(pricePerShare * shares);

/* ── Arithmetic helpers — preserve brand ───────────────────────── */

export const addCrore = (a: INRCrore, b: INRCrore): INRCrore => INRCrore(a + b);
export const subCrore = (a: INRCrore, b: INRCrore): INRCrore => INRCrore(a - b);
export const mulCroreScalar = (a: INRCrore, s: number): INRCrore => INRCrore(a * s);
/** Ratio of two INRCrore values is a PercentFraction. */
export const divCrore = (a: INRCrore, b: INRCrore): PercentFraction => PercentFraction(a / b);
