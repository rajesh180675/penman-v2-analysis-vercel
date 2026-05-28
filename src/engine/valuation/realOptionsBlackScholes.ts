/* ================================================================
   Plan 5b PR-5b.1 — Real-options Black-Scholes valuation.

   For pharma R&D pipelines, exploration assets, and tech moonshots,
   intrinsic-value DCF understates because the firm holds an option
   to abandon, expand, or wait. Black-Scholes prices that option.

   Real-option mapping:
     S = current PV of the underlying project's expected cash flows
     K = strike (the development / expansion cost)
     T = time to the investment decision (years)
     r = risk-free rate (decimal)
     sigma = volatility of project value (decimal)

   Call value (option to invest):
     d1 = (ln(S/K) + (r + sigma^2/2) * T) / (sigma * sqrt(T))
     d2 = d1 - sigma * sqrt(T)
     C  = S * N(d1) - K * e^(-rT) * N(d2)

   This module exposes:
     blackScholesCall, blackScholesPut    standard option pricing
     blackScholesGreeks                   delta/gamma/vega/theta
     valueRDPipeline                      aggregate pipeline option value

   Pure functions. PR-5b.1 ships the math + tests. Wiring into a
   pharma/tech-specific valuation surface is a follow-up (needs
   product-disclosure parsing).
================================================================ */

/**
 * Cumulative standard normal CDF using Abramowitz & Stegun
 * approximation 26.2.17 (max error ~7.5e-8).
 */
export function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * ax);
  const y =
    1.0 -
    (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export interface BlackScholesInputs {
  S: number;
  K: number;
  T: number;
  r: number;
  sigma: number;
}

function d1d2(inputs: BlackScholesInputs): { d1: number; d2: number } {
  const { S, K, T, r, sigma } = inputs;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return { d1, d2 };
}

export function blackScholesCall(inputs: BlackScholesInputs): number {
  const { S, K, T, r, sigma } = inputs;
  if (T <= 0) return Math.max(0, S - K);
  if (sigma <= 0) return Math.max(0, S - K * Math.exp(-r * T));
  const { d1, d2 } = d1d2(inputs);
  return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

export function blackScholesPut(inputs: BlackScholesInputs): number {
  const { S, K, T, r, sigma } = inputs;
  if (T <= 0) return Math.max(0, K - S);
  if (sigma <= 0) return Math.max(0, K * Math.exp(-r * T) - S);
  const { d1, d2 } = d1d2(inputs);
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

export interface BlackScholesGreeks {
  delta: number;
  gamma: number;
  vega: number; // per 1% (i.e. dC/d(sigma) * 0.01)
  theta: number; // per day (annual / 365)
}

/** Greeks for a call. Delta = dC/dS, gamma = d^2C/dS^2,
 *  vega normalised to 1% volatility move, theta per calendar day. */
export function blackScholesGreeks(inputs: BlackScholesInputs): BlackScholesGreeks {
  const { S, K, T, r, sigma } = inputs;
  const { d1, d2 } = d1d2(inputs);
  const sqrtT = Math.sqrt(T);
  const delta = normCdf(d1);
  const gamma = normPdf(d1) / (S * sigma * sqrtT);
  const vegaPerUnit = S * normPdf(d1) * sqrtT;
  const vega = vegaPerUnit / 100; // per 1%
  const thetaAnnual =
    -(S * normPdf(d1) * sigma) / (2 * sqrtT) - r * K * Math.exp(-r * T) * normCdf(d2);
  const theta = thetaAnnual / 365;
  return { delta, gamma, vega, theta };
}

/* ----------------- R&D pipeline aggregation ------------------- */

export interface RDPipelineProject {
  /** Project identifier (e.g. drug code, exploration block). */
  id: string;
  /** Stage description (Phase II, Phase III, NDA, etc.) for citation. */
  stage: string;
  /** PV of expected cash flows on commercialisation (₹). */
  underlyingValue: number;
  /** Cost to bring to commercialisation from current stage (₹). */
  developmentCost: number;
  /** Years to the next decision/launch. */
  timeToDecisionYears: number;
  /** Probability of technical & regulatory success (POS). Decimal. */
  probabilityOfSuccess: number;
  /** Volatility of the underlying value. Pharma typical 0.4-0.7. */
  volatility: number;
}

export interface RDPipelineInputs {
  projects: ReadonlyArray<RDPipelineProject>;
  /** Risk-free rate (decimal). */
  riskFreeRate: number;
}

export interface RDPipelineProjectValue {
  id: string;
  stage: string;
  optionValue: number;
  expectedValue: number;
  intrinsicValue: number;
}

export interface RDPipelineResult {
  perProject: RDPipelineProjectValue[];
  totalOptionValue: number;
  totalExpectedValue: number;
  totalIntrinsicValue: number;
}

/**
 * Aggregate option value across an R&D pipeline.
 *
 * For each project:
 *   - intrinsic    = max(0, underlyingValue - developmentCost) * POS
 *   - optionValue  = blackScholesCall(...) * POS
 *   - expected     = optionValue (POS-weighted; Black-Scholes already
 *                    handles time value, POS scales for tech risk).
 *
 * The POS factor is multiplicative — reviewer can cross-check by
 * setting POS = 1.0 to see the unscaled option value.
 */
export function valueRDPipeline(inputs: RDPipelineInputs): RDPipelineResult {
  const perProject: RDPipelineProjectValue[] = [];
  let totalOpt = 0;
  let totalExp = 0;
  let totalInt = 0;

  for (const proj of inputs.projects) {
    const optionValue = blackScholesCall({
      S: proj.underlyingValue,
      K: proj.developmentCost,
      T: proj.timeToDecisionYears,
      r: inputs.riskFreeRate,
      sigma: proj.volatility,
    });
    const intrinsic = Math.max(0, proj.underlyingValue - proj.developmentCost);
    const posWeighted = optionValue * proj.probabilityOfSuccess;
    const intrinsicWeighted = intrinsic * proj.probabilityOfSuccess;

    perProject.push({
      id: proj.id,
      stage: proj.stage,
      optionValue,
      expectedValue: posWeighted,
      intrinsicValue: intrinsicWeighted,
    });
    totalOpt += optionValue;
    totalExp += posWeighted;
    totalInt += intrinsicWeighted;
  }

  return {
    perProject,
    totalOptionValue: totalOpt,
    totalExpectedValue: totalExp,
    totalIntrinsicValue: totalInt,
  };
}
