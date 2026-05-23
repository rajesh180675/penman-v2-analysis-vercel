/**
 * Reverse DCF / Implied Expectations Engine
 *
 * Instead of forecasting and computing fair value, this works backwards:
 * Given current market price, what growth/RNOA/fade must the market believe?
 *
 * Three modes:
 *   1. Implied Growth: solve for g given current RNOA and ω
 *   2. Implied RNOA: solve for future RNOA given current growth
 *   3. Implied Fade: solve for ω given current RNOA and growth
 *
 * Multi-horizon decomposition (Leibowitz-Kogelman Franchise Value):
 *   Price = V_no_growth + V_near_term_growth + V_long_term_growth
 *
 * Academic basis:
 *   - Mauboussin (2006): Expectations Investing
 *   - Leibowitz & Kogelman (1990): Franchise Value
 *   - Rappaport (1998): Creating Shareholder Value
 */

import type { RecastPeriod } from "./types";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ReverseDCFResult {
  // Core implied expectations
  impliedGrowth: number;            // NOA growth rate priced in
  impliedRNOA: number;              // steady-state RNOA priced in
  impliedFade: number;              // ω priced in
  impliedCAP: number;               // competitive advantage period (years)

  // Reality check
  historicalGrowth: number;         // actual median NOA growth (last 5Y)
  historicalRNOA: number;           // actual latest RNOA
  sustainableGrowth: number;        // max self-financeable growth

  // Gap analysis
  growthGap: number;                // implied - historical (positive = optimistic)
  rnoaGap: number;                  // implied - historical
  verdict: "priced_for_perfection" | "reasonable" | "priced_for_failure" | "asymmetric_upside";

  // Multi-horizon decomposition
  priceDecomposition: {
    noGrowthValue: number;          // EPV per share
    nearTermGrowth: number;         // value from years 1-5 growth
    longTermGrowth: number;         // residual value beyond year 5
    noGrowthPct: number;            // % of price explained by current earnings
    nearTermPct: number;
    longTermPct: number;
  };

  // Sensitivity
  sensitivity: {
    priceAt10PctGrowth: number;
    priceAt15PctGrowth: number;
    priceAt20PctGrowth: number;
    priceAtHistoricalGrowth: number;
    priceAtZeroGrowth: number;
  };

  // Inputs
  marketPrice: number;
  costOfCapital: number;
  omega: number;

  // Narrative
  narrative: string;
}

// ─── Core Implementation ───────────────────────────────────────────────────

/**
 * Run full reverse DCF analysis.
 */
export function computeReverseDCF(
  data: RecastPeriod[],
  costOfCapital: number,
  omega: number,
  marketPricePerShare: number,
  sharesOutstanding: number,  // in crores
): ReverseDCFResult | null {
  if (data.length < 4 || marketPricePerShare <= 0 || sharesOutstanding <= 0) return null;

  const latest = data[data.length - 1];
  const rnoa = latest.ratios?.RNOA;
  const noa = latest.bs?.NOA;
  const nfo = latest.bs?.NFO ?? 0;
  const cse = latest.bs?.CSE;

  if (rnoa == null || noa == null || noa <= 0 || cse == null || cse <= 0) return null;

  const r = costOfCapital;
  const marketCap = marketPricePerShare * sharesOutstanding;
  const equityValue = marketCap; // what the market says equity is worth

  // ── Historical growth (median of last 5Y NOA growth) ──
  const growthRates: number[] = [];
  for (let i = Math.max(1, data.length - 5); i < data.length; i++) {
    const cur = data[i].bs?.NOA ?? 0;
    const prev = data[i - 1].bs?.NOA ?? 0;
    if (prev > 0 && cur > 0) growthRates.push((cur - prev) / prev);
  }
  growthRates.sort((a, b) => a - b);
  const historicalGrowth = growthRates.length > 0
    ? growthRates[Math.floor(growthRates.length / 2)]
    : 0;

  // ── Sustainable growth (self-financing capacity) ──
  const payout = computePayoutRatio(data);
  const sustainableGrowth = rnoa * (1 - payout);

  // ── No-growth value (EPV) ──
  // V_no_growth = NOA + ReOI/r - NFO (equity value if no growth, no fade)
  const reoi = (rnoa - r) * noa;
  const epvFirm = noa + (reoi > 0 ? reoi / r : reoi / r);
  const epvEquity = epvFirm - nfo;
  const epvPerShare = epvEquity / sharesOutstanding;

  // ── Implied growth rate ──
  // Residual income model: V = B + Σ ReOI_t / (1+r)^t
  // With growth g and fade ω:
  // V = B + ReOI × (1+g) / (1+r - ω×(1+g)) [growing perpetuity with fade]
  // Solve for g given V = market value
  const impliedGrowth = solveForGrowth(equityValue, cse, reoi, r, omega, nfo);

  // ── Implied RNOA ──
  // At historical growth and current ω, what RNOA justifies the price?
  const impliedRNOA = solveForRNOA(equityValue, noa, r, omega, historicalGrowth, nfo, sharesOutstanding);

  // ── Implied fade ──
  // At current RNOA and historical growth, what ω justifies the price?
  const impliedFade = solveForFade(equityValue, cse, reoi, r, historicalGrowth, nfo);

  // ── Implied CAP (competitive advantage period) ──
  // How many years must abnormal returns persist to justify price?
  const impliedCAP = computeImpliedCAP(equityValue, noa, rnoa, r, historicalGrowth, nfo);

  // ── Gap analysis ──
  const growthGap = impliedGrowth - historicalGrowth;
  const rnoaGap = impliedRNOA - rnoa;

  let verdict: ReverseDCFResult["verdict"];
  if (growthGap > 0.08 || rnoaGap > 0.10) {
    verdict = "priced_for_perfection";
  } else if (growthGap < -0.05 || rnoaGap < -0.05) {
    verdict = "priced_for_failure";
  } else if (growthGap < -0.02 && rnoaGap < 0) {
    verdict = "asymmetric_upside";
  } else {
    verdict = "reasonable";
  }

  // ── Multi-horizon decomposition ──
  const nearTermValue = computeNearTermGrowthValue(noa, rnoa, r, historicalGrowth, 5);
  const nearTermPerShare = nearTermValue / sharesOutstanding;
  const longTermPerShare = marketPricePerShare - epvPerShare - nearTermPerShare;

  const priceDecomposition = {
    noGrowthValue: epvPerShare,
    nearTermGrowth: nearTermPerShare,
    longTermGrowth: Math.max(0, longTermPerShare),
    noGrowthPct: epvPerShare / marketPricePerShare,
    nearTermPct: nearTermPerShare / marketPricePerShare,
    longTermPct: Math.max(0, longTermPerShare) / marketPricePerShare,
  };

  // ── Sensitivity table ──
  const sensitivity = {
    priceAt10PctGrowth: computeFairValue(noa, rnoa, r, omega, 0.10, nfo, sharesOutstanding),
    priceAt15PctGrowth: computeFairValue(noa, rnoa, r, omega, 0.15, nfo, sharesOutstanding),
    priceAt20PctGrowth: computeFairValue(noa, rnoa, r, omega, 0.20, nfo, sharesOutstanding),
    priceAtHistoricalGrowth: computeFairValue(noa, rnoa, r, omega, historicalGrowth, nfo, sharesOutstanding),
    priceAtZeroGrowth: computeFairValue(noa, rnoa, r, omega, 0, nfo, sharesOutstanding),
  };

  // ── Narrative ──
  const narrative = buildNarrative(impliedGrowth, historicalGrowth, impliedRNOA, rnoa, impliedCAP, sustainableGrowth, verdict, priceDecomposition);

  return {
    impliedGrowth,
    impliedRNOA,
    impliedFade,
    impliedCAP,
    historicalGrowth,
    historicalRNOA: rnoa,
    sustainableGrowth,
    growthGap,
    rnoaGap,
    verdict,
    priceDecomposition,
    sensitivity,
    marketPrice: marketPricePerShare,
    costOfCapital: r,
    omega,
    narrative,
  };
}

// ─── Solvers ───────────────────────────────────────────────────────────────

/**
 * Solve for implied growth rate using bisection.
 */
function solveForGrowth(
  targetEquity: number, cse: number, reoi: number,
  r: number, omega: number, nfo: number,
): number {
  // V_equity = CSE + ReOI × (1+g) / (1+r - ω×(1+g)) - NFO adjustment...
  // Simplified: iterate to find g where model value = target
  let lo = -0.10, hi = 0.40;

  for (let iter = 0; iter < 50; iter++) {
    const mid = (lo + hi) / 2;
    const modelV = riModelValue(cse, reoi, r, omega, mid, nfo);
    if (modelV < targetEquity) lo = mid;
    else hi = mid;
    if (Math.abs(hi - lo) < 0.0001) break;
  }
  return (lo + hi) / 2;
}

/**
 * Solve for implied RNOA using bisection.
 */
function solveForRNOA(
  targetEquity: number, noa: number, r: number,
  omega: number, g: number, nfo: number, _shares: number,
): number {
  let lo = -0.10, hi = 0.80;

  for (let iter = 0; iter < 50; iter++) {
    const mid = (lo + hi) / 2;
    const reoi = (mid - r) * noa;
    const cse = noa - nfo;
    const modelV = riModelValue(cse, reoi, r, omega, g, nfo);
    if (modelV < targetEquity) lo = mid;
    else hi = mid;
    if (Math.abs(hi - lo) < 0.0001) break;
  }
  return (lo + hi) / 2;
}

/**
 * Solve for implied fade rate using bisection.
 */
function solveForFade(
  targetEquity: number, cse: number, reoi: number,
  r: number, g: number, nfo: number,
): number {
  let lo = 0, hi = 0.95;

  for (let iter = 0; iter < 50; iter++) {
    const mid = (lo + hi) / 2;
    const modelV = riModelValue(cse, reoi, r, mid, g, nfo);
    if (modelV < targetEquity) lo = mid;
    else hi = mid;
    if (Math.abs(hi - lo) < 0.001) break;
  }
  return (lo + hi) / 2;
}

/**
 * Residual income model value (equity).
 * V = CSE + ReOI × (1+g) / (1+r - ω×(1+g))
 * (simplified perpetuity form with growth and fade)
 */
function riModelValue(
  cse: number, reoi: number, r: number, omega: number, g: number, _nfo: number,
): number {
  const denom = (1 + r) - omega * (1 + g);
  if (denom <= 0.01) return cse + reoi * 50; // cap at 50x if denom near zero
  const pvReOI = reoi * (1 + g) / denom;
  return cse + pvReOI;
}

/**
 * Compute fair value per share at given parameters.
 */
function computeFairValue(
  noa: number, rnoa: number, r: number, omega: number,
  g: number, nfo: number, shares: number,
): number {
  const reoi = (rnoa - r) * noa;
  const cse = noa - nfo;
  const equity = riModelValue(cse, reoi, r, omega, g, nfo);
  return shares > 0 ? equity / shares : 0;
}

/**
 * Compute implied competitive advantage period (CAP).
 * How many years of abnormal returns justify the price?
 */
function computeImpliedCAP(
  targetEquity: number, noa: number, rnoa: number,
  r: number, g: number, nfo: number,
): number {
  const reoi = (rnoa - r) * noa;
  if (reoi <= 0) return 0; // no competitive advantage if RNOA < r

  const cse = noa - nfo;
  let cumValue = cse;
  let currentReOI = reoi;

  for (let t = 1; t <= 50; t++) {
    currentReOI *= (1 + g);
    cumValue += currentReOI / Math.pow(1 + r, t);
    if (cumValue >= targetEquity) return t;
  }
  return 50; // >50 years = extreme optimism
}

/**
 * Value from near-term growth (explicit forecast period).
 */
function computeNearTermGrowthValue(
  noa: number, rnoa: number, r: number, g: number, years: number,
): number {
  const reoi = (rnoa - r) * noa;
  let value = 0;
  let currentReOI = reoi;

  for (let t = 1; t <= years; t++) {
    const growthIncrement = currentReOI * g; // incremental ReOI from growth
    currentReOI *= (1 + g);
    value += growthIncrement / Math.pow(1 + r, t);
  }
  return value;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function computePayoutRatio(data: RecastPeriod[]): number {
  // Estimate from last few years of dividends / PAT
  const payouts: number[] = [];
  for (let i = Math.max(0, data.length - 5); i < data.length; i++) {
    const pat = data[i].is?.PAT;
    const div = data[i].cf?.DividendPaid;
    if (pat != null && pat > 0 && div != null) {
      payouts.push(Math.abs(div) / pat);
    }
  }
  if (payouts.length === 0) return 0.30; // default assumption
  payouts.sort((a, b) => a - b);
  return Math.min(1, payouts[Math.floor(payouts.length / 2)]);
}

function buildNarrative(
  impliedG: number, histG: number, impliedRNOA: number, actualRNOA: number,
  cap: number, sustainG: number, verdict: string,
  decomp: ReverseDCFResult["priceDecomposition"],
): string {
  const lines: string[] = [];

  lines.push(`Market implies ${(impliedG * 100).toFixed(1)}% annual growth vs ${(histG * 100).toFixed(1)}% historical — ${impliedG > histG ? "optimistic" : "conservative"} pricing.`);

  if (impliedG > sustainG) {
    lines.push(`Implied growth (${(impliedG * 100).toFixed(1)}%) exceeds self-financeable rate (${(sustainG * 100).toFixed(1)}%) — market expects external capital raises or leverage increase.`);
  }

  lines.push(`Implied RNOA: ${(impliedRNOA * 100).toFixed(1)}% vs actual ${(actualRNOA * 100).toFixed(1)}%. Competitive advantage must persist ~${cap} years to justify current price.`);

  const longPct = (decomp.longTermPct * 100).toFixed(0);
  if (decomp.longTermPct > 0.40) {
    lines.push(`${longPct}% of market price depends on long-term growth beyond 5 years — high uncertainty embedded in price.`);
  } else if (decomp.noGrowthPct > 0.80) {
    lines.push(`${(decomp.noGrowthPct * 100).toFixed(0)}% of price is explained by current earnings alone — minimal growth expectations embedded.`);
  }

  if (verdict === "priced_for_perfection") {
    lines.push("Verdict: Priced for perfection. Multiple things must go right. Asymmetric downside risk.");
  } else if (verdict === "asymmetric_upside") {
    lines.push("Verdict: Market expects deterioration that may not materialize. Asymmetric upside if performance holds.");
  } else if (verdict === "priced_for_failure") {
    lines.push("Verdict: Market prices in significant decline. Contrarian opportunity if fundamentals stabilize.");
  }

  return lines.join(" ");
}
