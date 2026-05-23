/**
 * Merton Credit & Regime-Conditional Valuation Engine
 *
 * Two models:
 *   1. Merton (1974): Equity as call option on firm assets
 *      - Distance-to-Default, Probability of Default
 *      - Useful for leveraged companies (Vodafone, Tata Steel)
 *
 *   2. Regime-Conditional Valuation:
 *      - Probability-weighted valuation across macro regimes
 *      - India: expansion (75%) vs recession (25%)
 *      - Stress-tests the valuation under different scenarios
 *
 * Academic basis:
 *   - Merton (1974): On the pricing of corporate debt
 *   - Black & Scholes (1973): Option pricing framework
 *   - Hamilton (1989): Regime-switching models
 */

import type { RecastPeriod } from "./types";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface MertonCreditResult {
  // Core metrics
  distanceToDefault: number;       // DD (higher = safer)
  probabilityOfDefault: number;    // PD (annual, 0-1)
  creditRating: string;            // implied rating (AAA to D)

  // Option model inputs
  assetValue: number;              // implied firm asset value
  assetVolatility: number;         // σ_A (implied)
  debtFaceValue: number;           // strike price
  timeToMaturity: number;          // years (weighted average debt maturity)
  riskFreeRate: number;

  // Equity interpretation
  equityAsCallOption: number;      // Black-Scholes call value
  debtValue: number;               // risk-free debt - put value
  creditSpread: number;            // implied spread over risk-free (bps)

  // Risk classification
  riskTier: "investment_grade" | "speculative" | "distressed" | "default_zone";
  narrative: string;
}

export interface RegimeConditionalResult {
  // Probability-weighted base case
  baseCase: number;                // weighted valuation per share

  // Per-regime
  expansion: {
    probability: number;
    value: number;
    rnoa: number;
    growth: number;
    costOfCapital: number;
  };
  recession: {
    probability: number;
    value: number;
    rnoa: number;
    growth: number;
    costOfCapital: number;
  };

  // Risk metrics
  drawdownRisk: number;            // % decline from expansion to recession
  valuationRange: { low: number; high: number };
  currentRegime: "expansion" | "late_cycle" | "recession" | "recovery";

  // Narrative
  narrative: string;
}

// ─── Merton Credit Model ───────────────────────────────────────────────────

/**
 * Compute Merton credit metrics from financial data.
 * Uses iterative solver to back out asset value and volatility.
 */
export function computeMertonCredit(
  data: RecastPeriod[],
  equityVolatility: number = 0.35, // default 35% annual equity vol
  riskFreeRate: number = 0.07,     // India 10Y gsec
  debtMaturity: number = 3,        // weighted avg maturity in years
): MertonCreditResult | null {
  if (data.length < 2) return null;

  const latest = data[data.length - 1];
  const noa = latest.bs?.NOA;
  const nfo = latest.bs?.NFO ?? 0;
  const cse = latest.bs?.CSE;

  if (noa == null || cse == null || cse <= 0) return null;

  // Debt face value (total financial liabilities)
  const totalDebt = Math.max(0, nfo); // NFO = financial liabilities - financial assets
  if (totalDebt <= 0) {
    // No net debt → essentially no default risk
    return {
      distanceToDefault: 10,
      probabilityOfDefault: 0,
      creditRating: "AAA",
      assetValue: noa,
      assetVolatility: equityVolatility * 0.5,
      debtFaceValue: 0,
      timeToMaturity: debtMaturity,
      riskFreeRate,
      equityAsCallOption: cse,
      debtValue: 0,
      creditSpread: 0,
      riskTier: "investment_grade",
      narrative: "Net cash position — no credit risk.",
    };
  }

  // Asset value approximation: V_A = equity + debt
  const assetValue = cse + totalDebt;

  // Asset volatility from equity volatility (Merton relationship):
  // σ_A ≈ σ_E × (E / V_A) × (1 / N(d1))
  // Simplified: σ_A ≈ σ_E × leverage_ratio
  const leverageRatio = cse / assetValue;
  const assetVolatility = equityVolatility * leverageRatio;

  // Distance to Default: DD = [ln(V_A/D) + (r - 0.5×σ²)×T] / (σ×√T)
  const T = debtMaturity;
  const d1 = (Math.log(assetValue / totalDebt) + (riskFreeRate - 0.5 * assetVolatility ** 2) * T) / (assetVolatility * Math.sqrt(T));
  const d2 = d1 - assetVolatility * Math.sqrt(T);
  const dd = d2; // Distance to Default

  // Probability of Default: PD = N(-d2)
  const pd = normalCDF(-d2);

  // Equity as call option (Black-Scholes)
  const callValue = assetValue * normalCDF(d1) - totalDebt * Math.exp(-riskFreeRate * T) * normalCDF(d2);

  // Debt value and credit spread
  const riskFreeDebtValue = totalDebt * Math.exp(-riskFreeRate * T);
  const riskyDebtValue = Math.max(riskFreeDebtValue * (1 - pd * 0.6), 0); // 60% LGD assumption
  const impliedSpread = Math.max(0, (pd * 0.6 / T) * 10000); // simplified spread in bps

  // Credit rating mapping
  const rating = mapDDToRating(dd);
  const riskTier = classifyRiskTier(dd);

  // Narrative
  const narrative = buildMertonNarrative(dd, pd, rating, riskTier, totalDebt, cse, assetVolatility);

  return {
    distanceToDefault: dd,
    probabilityOfDefault: pd,
    creditRating: rating,
    assetValue,
    assetVolatility,
    debtFaceValue: totalDebt,
    timeToMaturity: T,
    riskFreeRate,
    equityAsCallOption: callValue,
    debtValue: riskyDebtValue,
    creditSpread: impliedSpread,
    riskTier,
    narrative,
  };
}

// ─── Regime-Conditional Valuation ──────────────────────────────────────────

/**
 * Probability-weighted valuation across macro regimes.
 */
export function computeRegimeConditionalValuation(
  data: RecastPeriod[],
  baseCostOfCapital: number,
  omega: number,
  sharesOutstanding: number,
  companyBeta: number = 1.0, // earnings beta (cyclicality)
): RegimeConditionalResult | null {
  if (data.length < 3 || sharesOutstanding <= 0) return null;

  const latest = data[data.length - 1];
  const rnoa = latest.ratios?.RNOA;
  const noa = latest.bs?.NOA;
  const cse = latest.bs?.CSE;

  if (rnoa == null || noa == null || cse == null || noa <= 0) return null;

  // Compute historical growth
  const growthRates: number[] = [];
  for (let i = Math.max(1, data.length - 5); i < data.length; i++) {
    const cur = data[i].bs?.NOA ?? 0;
    const prev = data[i - 1].bs?.NOA ?? 0;
    if (prev > 0) growthRates.push((cur - prev) / prev);
  }
  const medianGrowth = growthRates.length > 0
    ? growthRates.sort((a, b) => a - b)[Math.floor(growthRates.length / 2)]
    : 0.10;

  // India regime parameters
  const expansion = {
    probability: 0.75,
    rnoaAdj: 1.0,               // RNOA unchanged
    growthAdj: 1.0,             // growth unchanged
    cocAdj: 0,                  // no cost of capital adjustment
  };

  const recession = {
    probability: 0.25,
    rnoaAdj: 1 - 0.20 * companyBeta,  // OPM compressed by 20% × beta
    growthAdj: 0.3,                     // growth drops to 30% of normal
    cocAdj: 0.02,                       // +200bps stress premium
  };

  // Expansion valuation
  const expRNOA = rnoa * expansion.rnoaAdj;
  const expGrowth = Math.max(0, medianGrowth * expansion.growthAdj);
  const expCoC = baseCostOfCapital + expansion.cocAdj;
  const expReOI = (expRNOA - expCoC) * noa;
  const expDenom = (1 + expCoC) - omega * (1 + expGrowth);
  const expEquity = expDenom > 0.01
    ? cse + expReOI * (1 + expGrowth) / expDenom
    : cse + expReOI * 30;
  const expPerShare = expEquity / sharesOutstanding;

  // Recession valuation
  const recRNOA = rnoa * recession.rnoaAdj;
  const recGrowth = Math.max(-0.05, medianGrowth * recession.growthAdj);
  const recCoC = baseCostOfCapital + recession.cocAdj;
  const recReOI = (recRNOA - recCoC) * noa;
  const recDenom = (1 + recCoC) - omega * (1 + recGrowth);
  const recEquity = recDenom > 0.01
    ? cse + recReOI * (1 + recGrowth) / recDenom
    : cse + recReOI * 15;
  const recPerShare = Math.max(0, recEquity / sharesOutstanding);

  // Probability-weighted base case
  const baseCase = expansion.probability * expPerShare + recession.probability * recPerShare;

  // Drawdown risk
  const drawdownRisk = expPerShare > 0 ? (expPerShare - recPerShare) / expPerShare : 0;

  // Current regime detection (simple heuristic from recent growth trajectory)
  const recentGrowth = growthRates.length > 0 ? growthRates[growthRates.length - 1] : 0;
  let currentRegime: RegimeConditionalResult["currentRegime"];
  if (recentGrowth > 0.15) currentRegime = "expansion";
  else if (recentGrowth > 0.05) currentRegime = "late_cycle";
  else if (recentGrowth > -0.05) currentRegime = "recovery";
  else currentRegime = "recession";

  const narrative = buildRegimeNarrative(baseCase, expPerShare, recPerShare, drawdownRisk, currentRegime, companyBeta);

  return {
    baseCase,
    expansion: {
      probability: expansion.probability,
      value: expPerShare,
      rnoa: expRNOA,
      growth: expGrowth,
      costOfCapital: expCoC,
    },
    recession: {
      probability: recession.probability,
      value: recPerShare,
      rnoa: recRNOA,
      growth: recGrowth,
      costOfCapital: recCoC,
    },
    drawdownRisk,
    valuationRange: { low: recPerShare, high: expPerShare },
    currentRegime,
    narrative,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Standard normal CDF approximation (Abramowitz & Stegun) */
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

function mapDDToRating(dd: number): string {
  if (dd > 4.0) return "AAA";
  if (dd > 3.5) return "AA+";
  if (dd > 3.0) return "AA";
  if (dd > 2.5) return "A+";
  if (dd > 2.0) return "A";
  if (dd > 1.5) return "BBB";
  if (dd > 1.0) return "BB";
  if (dd > 0.5) return "B";
  if (dd > 0.0) return "CCC";
  return "D";
}

function classifyRiskTier(dd: number): MertonCreditResult["riskTier"] {
  if (dd > 2.0) return "investment_grade";
  if (dd > 1.0) return "speculative";
  if (dd > 0.0) return "distressed";
  return "default_zone";
}

function buildMertonNarrative(
  dd: number, pd: number, rating: string, tier: string,
  debt: number, equity: number, vol: number,
): string {
  const leverage = debt / (debt + equity);
  const lines: string[] = [];

  lines.push(`Distance-to-Default: ${dd.toFixed(2)} → implied rating ${rating} (${tier.replace("_", " ")}).`);
  lines.push(`Annual default probability: ${(pd * 100).toFixed(2)}%. Leverage: ${(leverage * 100).toFixed(0)}%. Asset volatility: ${(vol * 100).toFixed(0)}%.`);

  if (tier === "investment_grade") {
    lines.push("Debt is well-covered by asset value — minimal credit concern for equity valuation.");
  } else if (tier === "speculative") {
    lines.push("Moderate credit risk — factor in refinancing risk and covenant headroom.");
  } else if (tier === "distressed") {
    lines.push("Significant default risk — equity value is option-like. Standard DCF understates risk.");
  } else {
    lines.push("Near or in default zone — equity is a deep out-of-money call option on recovery.");
  }

  return lines.join(" ");
}

function buildRegimeNarrative(
  base: number, expansion: number, recession: number,
  drawdown: number, regime: string, beta: number,
): string {
  const lines: string[] = [];

  lines.push(`Probability-weighted value: ₹${base.toFixed(0)}/share (75% expansion @ ₹${expansion.toFixed(0)}, 25% recession @ ₹${recession.toFixed(0)}).`);
  lines.push(`Drawdown risk: ${(drawdown * 100).toFixed(0)}% decline in recession scenario.`);

  if (beta > 1.2) {
    lines.push(`High cyclicality (β=${beta.toFixed(1)}) — recession impact amplified.`);
  } else if (beta < 0.8) {
    lines.push(`Defensive profile (β=${beta.toFixed(1)}) — relatively insulated from macro stress.`);
  }

  lines.push(`Current regime: ${regime.replace("_", " ")}.`);

  return lines.join(" ");
}
