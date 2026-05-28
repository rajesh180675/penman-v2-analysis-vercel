/* ================================================================
   Plan 5b PR-5b.2 — Credit-spread-aware WACC.

   Plain WACC formulae use a single "cost of debt" number — typically
   the company's reported interest expense / total debt. That's
   backwards-looking and ignores credit migration. A defensible kw
   builds bottom-up from:
     1. Sovereign yield at the company's debt-tenor (curve)
     2. Corporate spread for the company's rating bucket
     3. After-tax adjustment

   This module exposes:
     interpolateSovereignYield(years)    bilinear from the curve
     spreadForRating(rating, tenorYears) from the spread matrix
     costOfDebt({rating, tenor, tax})    rf + spread, after-tax
     buildWacc({ke, kd, weightDebt, ...}) standard WACC

   PR-5b.2 ships the lookup + computation. Wiring config.cost_of_debt
   to derive automatically from a credit rating dropdown is a follow-up.
================================================================ */

import creditSpreadsIndia2026 from "./data/credit-spreads/india-2026-01.json";

export interface SovereignCurvePoint {
  tenorYears: number;
  yield: number;
}

export interface CorporateSpreadRow {
  rating: string;
  spread1y: number;
  spread3y: number;
  spread5y: number;
  spread10y: number;
}

export interface CreditSpreadsSnapshot {
  retrievalDate: string;
  source: string;
  geography: string;
  currency: string;
  version: string;
  sovereignCurve: SovereignCurvePoint[];
  corporateSpreadsBps: CorporateSpreadRow[];
}

const DATA: CreditSpreadsSnapshot = creditSpreadsIndia2026 as CreditSpreadsSnapshot;

export function getCreditSpreadsData(): CreditSpreadsSnapshot {
  return DATA;
}

/** Linear interpolation on the sovereign curve. Clamps to endpoints outside [1, 30]. */
export function interpolateSovereignYield(tenorYears: number): number {
  const curve = DATA.sovereignCurve;
  if (tenorYears <= curve[0]!.tenorYears) return curve[0]!.yield;
  if (tenorYears >= curve[curve.length - 1]!.tenorYears) {
    return curve[curve.length - 1]!.yield;
  }
  for (let i = 0; i < curve.length - 1; i++) {
    const lo = curve[i]!;
    const hi = curve[i + 1]!;
    if (tenorYears >= lo.tenorYears && tenorYears <= hi.tenorYears) {
      const frac = (tenorYears - lo.tenorYears) / (hi.tenorYears - lo.tenorYears);
      return lo.yield + frac * (hi.yield - lo.yield);
    }
  }
  return curve[curve.length - 1]!.yield;
}

/**
 * Corporate spread (decimal) for a rating + tenor. Tenor is matched
 * to the nearest of {1, 3, 5, 10}; outside falls back to the closest
 * column. Unknown ratings default to "BBB" (mid-investment-grade).
 */
export function spreadForRating(rating: string, tenorYears: number): number {
  const rows = DATA.corporateSpreadsBps;
  const target = rating.trim().toUpperCase();
  const row = rows.find((r) => r.rating.toUpperCase() === target) ??
    rows.find((r) => r.rating === "BBB")!;
  const cols = [
    { tenor: 1, bps: row.spread1y },
    { tenor: 3, bps: row.spread3y },
    { tenor: 5, bps: row.spread5y },
    { tenor: 10, bps: row.spread10y },
  ];
  let best = cols[0]!;
  let bestDist = Math.abs(tenorYears - best.tenor);
  for (let i = 1; i < cols.length; i++) {
    const dist = Math.abs(tenorYears - cols[i]!.tenor);
    if (dist < bestDist) {
      bestDist = dist;
      best = cols[i]!;
    }
  }
  return best.bps / 10_000;
}

export interface CostOfDebtInputs {
  rating: string;
  tenorYears: number;
  taxRate: number;
}

export interface CostOfDebtResult {
  kdPretax: number;
  kdAfterTax: number;
  citation: {
    sovereignYield: number;
    sovereignTenor: number;
    spreadBps: number;
    rating: string;
    retrievalDate: string;
    source: string;
  };
}

export function costOfDebt(inputs: CostOfDebtInputs): CostOfDebtResult {
  const sovereignYield = interpolateSovereignYield(inputs.tenorYears);
  const spread = spreadForRating(inputs.rating, inputs.tenorYears);
  const kdPretax = sovereignYield + spread;
  return {
    kdPretax,
    kdAfterTax: kdPretax * (1 - inputs.taxRate),
    citation: {
      sovereignYield,
      sovereignTenor: inputs.tenorYears,
      spreadBps: spread * 10_000,
      rating: inputs.rating,
      retrievalDate: DATA.retrievalDate,
      source: DATA.source,
    },
  };
}

export interface WaccInputs {
  ke: number;
  kdAfterTax: number;
  /** Market-value weight on debt. Sum with weightEquity should = 1. */
  weightDebt: number;
  /** Market-value weight on equity. */
  weightEquity: number;
}

export interface WaccResult {
  wacc: number;
  weightDebt: number;
  weightEquity: number;
  ke: number;
  kdAfterTax: number;
  /** Rebalanced weights when the input pair didn't sum to 1.0. */
  weightsRebalanced: boolean;
}

/**
 * Standard WACC: ke * w_e + kd_after_tax * w_d.
 * If the input weights don't sum to 1, normalises them and flags
 * weightsRebalanced=true so the citation can disclose the adjustment.
 */
export function buildWacc(inputs: WaccInputs): WaccResult {
  const total = inputs.weightDebt + inputs.weightEquity;
  const rebalanced = Math.abs(total - 1) > 1e-6;
  const wD = rebalanced ? inputs.weightDebt / total : inputs.weightDebt;
  const wE = rebalanced ? inputs.weightEquity / total : inputs.weightEquity;
  return {
    wacc: inputs.ke * wE + inputs.kdAfterTax * wD,
    weightDebt: wD,
    weightEquity: wE,
    ke: inputs.ke,
    kdAfterTax: inputs.kdAfterTax,
    weightsRebalanced: rebalanced,
  };
}
