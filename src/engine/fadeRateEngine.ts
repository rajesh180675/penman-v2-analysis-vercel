/**
 * Fade Rate Estimation Engine
 *
 * Estimates the persistence parameter ω (omega) of abnormal operating earnings
 * using Bayesian shrinkage toward industry priors, with structural break detection.
 *
 * Academic basis:
 *   - Penman (2013) Ch. 14-15: ReOI_{t+1} = ω × ReOI_t
 *   - Dechow, Hutton & Sloan (1999): empirical ω estimation
 *   - Ohlson (1995): Linear Information Dynamics
 *
 * The fade rate determines terminal value:
 *   CV_T = ReOI_T × ω / (1 + r_F - ω)
 */

import type { RecastPeriod } from "./types";
import type { SegmentData } from "./segmentParser";

// ─── Industry Priors (Indian sectors) ──────────────────────────────────────
// Bayesian shrinkage priors for ω (fade rate persistence).
// Calibrated from: Dechow, P.M., Hutton, A.P. & Sloan, R.G. (1999).
// "An Empirical Assessment of the Residual Income Valuation Model."
// Journal of Accounting & Economics, 26(1-3), 1–34. Table 5 (US medians),
// adjusted for Indian market structure (higher persistence in IT/consumer
// due to brand moats; lower in cyclicals due to commodity exposure).
// See also: Penman, S.H. (2013). Financial Statement Analysis and Security
// Valuation. 5th ed., McGraw-Hill. Ch. 14, Table 14.1.

const INDUSTRY_OMEGA_PRIORS: Record<string, number> = {
  "it-services": 0.72,
  "consumer": 0.70,
  "fmcg": 0.70,
  "pharma": 0.65,
  "bank": 0.62,
  "insurance": 0.68,
  "nbfc": 0.55,
  "telecom": 0.55,
  "infrastructure": 0.48,
  "industrial": 0.52,
  "cyclical": 0.35,
  "metals": 0.35,
  "utility": 0.50,
  "conglomerate": 0.55,
  "real-estate": 0.30,
  "default": 0.55,
};

// ─── Types ─────────────────────────────────────────────────────────────────

export interface FadeRateEstimate {
  // Core estimate
  omega: number;                    // final Bayesian-shrunk ω (0 to 1)
  omegaRaw: number;                 // OLS company-specific ω (before shrinkage)
  omegaIndustryPrior: number;       // sector prior used
  shrinkageWeight: number;          // λ (how much company data vs prior)

  // Statistical quality
  standardError: number;
  rSquared: number;
  nObservations: number;
  confidence: "high" | "medium" | "low";

  // Terminal value implication
  terminalValueMultiplier: number;  // ω / (1 + r_F - ω)
  impliedCompetitiveAdvantage: "none" | "weak" | "moderate" | "strong" | "durable";

  // Decomposition
  omegaMargin: number | null;       // persistence of OPM component
  omegaTurnover: number | null;     // persistence of ATO component

  // Structural break
  structuralBreak: {
    detected: boolean;
    breakYear: string | null;
    preBreakOmega: number | null;
    postBreakOmega: number | null;
    cause: string | null;
  };

  // Diagnostics
  repiSeries: Array<{ year: string; reoi: number }>;
  residuals: number[];
}

export interface SegmentFadeRate {
  segment: string;
  omega: number;
  confidence: "high" | "medium" | "low";
  nObservations: number;
  lifecycle: "startup" | "growth" | "mature" | "decline";
  terminalValueMultiplier: number;
}

export interface FadeRateAnalysis {
  firm: FadeRateEstimate;
  segments: SegmentFadeRate[];
  equilibriumRNOA: number | null;   // industry equilibrium (RNOA doesn't fade to zero)
  adjustedTerminalValue: number | null; // using equilibrium + fade
}

// ─── Core Estimation ───────────────────────────────────────────────────────

/**
 * OLS regression: y = α + ω×x + ε
 * Returns { omega, alpha, se, rSquared, residuals }
 */
function olsAR1(series: number[]): {
  omega: number; alpha: number; se: number; rSquared: number; residuals: number[];
} {
  if (series.length < 4) {
    return { omega: 0.5, alpha: 0, se: 0.5, rSquared: 0, residuals: [] };
  }

  const n = series.length - 1;
  const x = series.slice(0, -1);  // ReOI_{t-1}
  const y = series.slice(1);      // ReOI_t

  // OLS: ω = Σ(xi - x̄)(yi - ȳ) / Σ(xi - x̄)²
  const xMean = x.reduce((s, v) => s + v, 0) / n;
  const yMean = y.reduce((s, v) => s + v, 0) / n;

  let ssXY = 0, ssXX = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (x[i] - xMean) * (y[i] - yMean);
    ssXX += (x[i] - xMean) ** 2;
    ssYY += (y[i] - yMean) ** 2;
  }

  const omega = ssXX > 0 ? ssXY / ssXX : 0;
  const alpha = yMean - omega * xMean;

  // Residuals and R²
  const residuals: number[] = [];
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const resid = y[i] - (alpha + omega * x[i]);
    residuals.push(resid);
    ssRes += resid ** 2;
  }
  const rSquared = ssYY > 0 ? 1 - ssRes / ssYY : 0;

  // Standard error of ω
  const mse = n > 2 ? ssRes / (n - 2) : ssRes;
  const se = ssXX > 0 ? Math.sqrt(mse / ssXX) : 0.5;

  return { omega, alpha, se, rSquared, residuals };
}

/**
 * Chow test for structural break at a given split point.
 * Returns F-statistic.
 */
function chowTestF(series: number[], splitIdx: number): number {
  if (splitIdx < 3 || series.length - splitIdx < 3) return 0;

  const n = series.length - 1;
  const k = 2; // parameters (alpha, omega)

  // Full model SSR
  const full = olsAR1(series);
  const ssrFull = full.residuals.reduce((s, r) => s + r * r, 0);

  // Sub-model 1 (before break)
  const sub1 = olsAR1(series.slice(0, splitIdx + 1));
  const ssr1 = sub1.residuals.reduce((s, r) => s + r * r, 0);

  // Sub-model 2 (after break)
  const sub2 = olsAR1(series.slice(splitIdx));
  const ssr2 = sub2.residuals.reduce((s, r) => s + r * r, 0);

  const numerator = (ssrFull - ssr1 - ssr2) / k;
  const denominator = (ssr1 + ssr2) / (n - 2 * k);

  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Detect structural break in ReOI series.
 * Tests all possible break points, returns the most significant.
 */
function detectStructuralBreak(
  series: number[],
  years: string[]
): { detected: boolean; breakIdx: number | null; breakYear: string | null; fStat: number } {
  if (series.length < 8) {
    return { detected: false, breakIdx: null, breakYear: null, fStat: 0 };
  }

  let maxF = 0;
  let bestIdx: number | null = null;

  // Test each possible break point (need at least 3 obs on each side)
  for (let i = 3; i < series.length - 3; i++) {
    const f = chowTestF(series, i);
    if (f > maxF) {
      maxF = f;
      bestIdx = i;
    }
  }

  // Critical F at 5% for k=2, typical df ≈ 4.0-5.0
  // Approximation of F(2, n-4) at α=0.05 for small samples (n≈8-12).
  // Ref: Chow, G.C. (1960). "Tests of Equality Between Sets of Coefficients
  // in Two Linear Regressions." Econometrica, 28(3), 591–605.
  const critical = 4.5;
  const detected = maxF > critical;

  return {
    detected,
    breakIdx: detected ? bestIdx : null,
    breakYear: detected && bestIdx != null ? years[bestIdx] || null : null,
    fStat: maxF,
  };
}

/**
 * Estimate fade rate for a company from recast data.
 */
export function estimateFadeRate(
  data: RecastPeriod[],
  costOfCapital: number,
  companyType?: string | undefined,
): FadeRateEstimate {
  // Build ReOI series (oldest first for time-series regression)
  const sorted = [...data].sort((a, b) => a.period_end.localeCompare(b.period_end));

  const repiSeries: Array<{ year: string; reoi: number }> = [];
  for (let i = 1; i < sorted.length; i++) {
    const reoi = sorted[i].ri?.ReOI;
    if (reoi != null) {
      const fy = sorted[i].period_end.slice(0, 4);
      repiSeries.push({ year: `FY${fy}`, reoi });
    }
  }

  const reoiValues = repiSeries.map(r => r.reoi);
  const years = repiSeries.map(r => r.year);

  // Structural break detection
  const breakTest = detectStructuralBreak(reoiValues, years);
  let effectiveSeries = reoiValues;

  let preBreakOmega: number | null = null;
  let postBreakOmega: number | null = null;

  if (breakTest.detected && breakTest.breakIdx != null) {
    preBreakOmega = olsAR1(reoiValues.slice(0, breakTest.breakIdx + 1)).omega;
    postBreakOmega = olsAR1(reoiValues.slice(breakTest.breakIdx)).omega;
    // Use post-break data only (more representative of current regime)
    effectiveSeries = reoiValues.slice(breakTest.breakIdx);
  }

  // OLS estimation on effective series
  const ols = olsAR1(effectiveSeries);
  const omegaRaw = Math.max(-0.2, Math.min(1.0, ols.omega)); // clamp to sensible range

  // Bayesian shrinkage toward industry prior
  const sectorKey = companyType?.toLowerCase().replace(/[^a-z-]/g, "") || "default";
  const omegaIndustryPrior = INDUSTRY_OMEGA_PRIORS[sectorKey] ?? INDUSTRY_OMEGA_PRIORS["default"];
  const kappa = 10; // prior strength
  const n = effectiveSeries.length;
  const lambda = n / (n + kappa);

  const omega = Math.max(0, Math.min(0.95, lambda * omegaRaw + (1 - lambda) * omegaIndustryPrior));

  // Confidence assessment
  let confidence: "high" | "medium" | "low";
  if (n >= 10 && ols.rSquared > 0.3 && ols.se < 0.2) confidence = "high";
  else if (n >= 6 && ols.rSquared > 0.1) confidence = "medium";
  else confidence = "low";

  // Terminal value multiplier: ω / (1 + r_F - ω)
  const tvMultiplier = omega / (1 + costOfCapital - omega);

  // Competitive advantage interpretation
  let impliedCA: FadeRateEstimate["impliedCompetitiveAdvantage"];
  if (omega >= 0.75) impliedCA = "durable";
  else if (omega >= 0.65) impliedCA = "strong";
  else if (omega >= 0.50) impliedCA = "moderate";
  else if (omega >= 0.35) impliedCA = "weak";
  else impliedCA = "none";

  // Margin and turnover fade decomposition
  let omegaMargin: number | null = null;
  let omegaTurnover: number | null = null;

  const pmSeries = sorted.map(p => p.ratios?.PM).filter((v): v is number => v != null);
  const atoSeries = sorted.map(p => p.ratios?.ATO).filter((v): v is number => v != null);

  if (pmSeries.length >= 5) omegaMargin = Math.max(0, Math.min(1, olsAR1(pmSeries).omega));
  if (atoSeries.length >= 5) omegaTurnover = Math.max(0, Math.min(1, olsAR1(atoSeries).omega));

  return {
    omega,
    omegaRaw,
    omegaIndustryPrior,
    shrinkageWeight: lambda,
    standardError: ols.se,
    rSquared: ols.rSquared,
    nObservations: n,
    confidence,
    terminalValueMultiplier: tvMultiplier,
    impliedCompetitiveAdvantage: impliedCA,
    omegaMargin,
    omegaTurnover,
    structuralBreak: {
      detected: breakTest.detected,
      breakYear: breakTest.breakYear,
      preBreakOmega,
      postBreakOmega,
      cause: breakTest.detected ? inferBreakCause(breakTest.breakYear) : null,
    },
    repiSeries,
    residuals: ols.residuals,
  };
}

/**
 * Estimate segment-level fade rates from segment data.
 */
export function estimateSegmentFadeRates(
  segmentData: SegmentData,
  costOfCapital: number,
  taxRate: number = 0.25,
): SegmentFadeRate[] {
  const results: SegmentFadeRate[] = [];

  for (const segName of segmentData.segments) {
    const years = segmentData.years; // newest first
    const reversedYears = [...years].reverse(); // oldest first for regression

    // Build segment ReOI series
    const reoiSeries: number[] = [];
    for (let i = 1; i < reversedYears.length; i++) {
      const yr = reversedYears[i];
      const prevYr = reversedYears[i - 1];
      const d = segmentData.data[segName]?.[yr];
      const dPrev = segmentData.data[segName]?.[prevYr];

      if (!d || !dPrev) continue;
      const result = d.result;
      const prevAssets = dPrev.assets;
      const prevLiabilities = dPrev.liabilities;

      if (result == null || prevAssets == null) continue;

      const segNOA = prevAssets - (prevLiabilities ?? 0);
      if (segNOA <= 0) continue;

      const segReOI = result * (1 - taxRate) - costOfCapital * segNOA;
      reoiSeries.push(segReOI);
    }

    // Estimate ω
    const ols = olsAR1(reoiSeries);
    const omega = Math.max(0, Math.min(0.95, ols.omega));
    const n = reoiSeries.length;

    let confidence: "high" | "medium" | "low";
    if (n >= 8 && ols.rSquared > 0.2) confidence = "high";
    else if (n >= 5) confidence = "medium";
    else confidence = "low";

    // Lifecycle classification
    const latestYr = years[0];
    const thirdYr = years[2] || years[years.length - 1];
    const latestRev = segmentData.data[segName]?.[latestYr]?.revenue ?? 0;
    const thirdRev = segmentData.data[segName]?.[thirdYr]?.revenue ?? 0;
    const latestResult = segmentData.data[segName]?.[latestYr]?.result ?? 0;
    const latestCapex = segmentData.data[segName]?.[latestYr]?.capex ?? 0;
    const latestDepr = segmentData.data[segName]?.[latestYr]?.depreciation ?? 1;

    const revCagr3y = thirdRev > 0 ? Math.pow(latestRev / thirdRev, 1 / 3) - 1 : 0;
    const reinvestmentRate = latestDepr > 0 ? latestCapex / latestDepr : 1;
    const reOIPositive = latestResult > 0;

    let lifecycle: SegmentFadeRate["lifecycle"];
    if (!reOIPositive && revCagr3y > 0.20) lifecycle = "startup";
    else if (reOIPositive && revCagr3y > 0.15 && reinvestmentRate > 1.5) lifecycle = "growth";
    else if (revCagr3y < -0.05) lifecycle = "decline";
    else lifecycle = "mature";

    const tvMultiplier = omega / (1 + costOfCapital - omega);

    results.push({
      segment: segName,
      omega,
      confidence,
      nObservations: n,
      lifecycle,
      terminalValueMultiplier: tvMultiplier,
    });
  }

  return results;
}

/**
 * Full fade rate analysis combining firm-level and segment-level.
 */
export function analyzeFadeRate(
  data: RecastPeriod[],
  costOfCapital: number,
  companyType?: string | undefined,
  segmentData?: SegmentData | null | undefined,
  taxRate: number = 0.25,
): FadeRateAnalysis {
  // NaN guards — coerce non-finite inputs to safe defaults so downstream
  // OLS / omega math doesn't propagate NaN. Function signature is non-null
  // so callers always receive a structured result.
  if (!Number.isFinite(costOfCapital)) costOfCapital = 0.13;
  if (!Number.isFinite(taxRate)) taxRate = 0.25;

  const firm = estimateFadeRate(data, costOfCapital, companyType);

  const segments = segmentData
    ? estimateSegmentFadeRates(segmentData, costOfCapital, taxRate)
    : [];

  // Industry equilibrium RNOA
  const sectorKey = companyType?.toLowerCase().replace(/[^a-z-]/g, "") || "default";
  const equilibriumRNOA = getEquilibriumRNOA(sectorKey);

  // Adjusted terminal value using equilibrium
  let adjustedTerminalValue: number | null = null;
  if (data.length > 0 && firm.repiSeries.length > 0) {
    const latestReOI = firm.repiSeries[firm.repiSeries.length - 1]?.reoi ?? 0;
    const latestNOA = data[data.length - 1]?.bs?.NOA;
    if (latestNOA != null && equilibriumRNOA != null) {
      const reOIeq = (equilibriumRNOA - costOfCapital) * latestNOA;
      // CV = (ReOI - ReOI_eq) × ω/(1+r-ω) + ReOI_eq/r
      const excessFade = (latestReOI - reOIeq) * firm.omega / (1 + costOfCapital - firm.omega);
      const eqPerpetual = costOfCapital > 0 ? reOIeq / costOfCapital : 0;
      adjustedTerminalValue = excessFade + eqPerpetual;
    }
  }

  return { firm, segments, equilibriumRNOA, adjustedTerminalValue };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getEquilibriumRNOA(sectorKey: string): number | null {
  const equilibria: Record<string, number> = {
    "it-services": 0.38,
    "consumer": 0.28,
    "fmcg": 0.30,
    "pharma": 0.20,
    "bank": 0.015,
    "insurance": 0.015,
    "nbfc": 0.03,
    "infrastructure": 0.10,
    "industrial": 0.14,
    "cyclical": 0.10,
    "metals": 0.10,
    "telecom": 0.12,
    "utility": 0.09,
    "conglomerate": 0.14,
  };
  return equilibria[sectorKey] ?? null;
}

function inferBreakCause(breakYear: string | null): string | null {
  if (!breakYear) return null;
  const yr = parseInt(breakYear.replace("FY", ""), 10);
  if (yr === 2020 || yr === 2021) return "COVID-19 impact";
  if (yr === 2017 || yr === 2018) return "Ind-AS transition / GST";
  if (yr === 2024) return "Possible demerger/restructuring";
  return "Structural change detected";
}
