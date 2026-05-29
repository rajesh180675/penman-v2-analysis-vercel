/* ================================================================
   v3Analytics decomposition — §9.1 Company-Specific Fade Parameter
   Estimation cluster.

   Lifted verbatim from src/engine/v3Analytics.ts. Depends only on the
   RecastPeriod shape (imported DOWN from ../types/recast), so it forms
   no back-edge to the parent. v3Analytics.ts re-exports the public
   surface, leaving external import paths unchanged.

   Behaviour byte-for-byte identical.
================================================================ */

import type { RecastPeriod } from "../types/recast";

export interface FadeParamEstimate {
  driver: "PM" | "ATO" | "sales_growth";
  phi: number;
  alpha: number;
  r_squared: number;
  source: "COMPANY_SPECIFIC" | "NP_DEFAULT";
  target: number;
  target_source: string;
}

export function estimateFadeParams(
  periods: RecastPeriod[],
  npDefaultPM = 0.87,
  npDefaultATO = 0.95,
  npDefaultSalesGrowth = 0.70,
  targetPM = 0.055,
  targetATO = 1.18,
  targetSalesGrowth = 0.038,
  blendWeight = 0.5
): FadeParamEstimate[] {
  const results: FadeParamEstimate[] = [];
  const pmSeries = periods.map((p) => p.ratios?.PM ?? null);
  const atoSeries = periods.map((p) => p.ratios?.ATO ?? null);
  const salesGrowthSeries = periods.map((p) => p.ratios?.Sales_growth ?? null);
  const estimate = (
    driver: FadeParamEstimate["driver"],
    series: (number | null)[],
    npDefault: number,
    npTarget: number
  ): FadeParamEstimate => {
    const valid = series.filter((v): v is number => v != null && Number.isFinite(v));
    if (valid.length >= 10) {
      // OLS AR(1)
      const X = valid.slice(0, -1);
      const Y = valid.slice(1);
      const n = X.length;
      const meanX = X.reduce((s, v) => s + v, 0) / n;
      const meanY = Y.reduce((s, v) => s + v, 0) / n;
      const cov = X.reduce((s, v, i) => s + (v - meanX) * (Y[i] - meanY), 0) / n;
      const varX = X.reduce((s, v) => s + (v - meanX) ** 2, 0) / n;
      const phi = varX > 0 ? cov / varX : npDefault;
      const alpha = meanY - phi * meanX;
      // R²
      const ss_res = Y.reduce((s, y, i) => s + (y - (alpha + phi * X[i])) ** 2, 0);
      const ss_tot = Y.reduce((s, y) => s + (y - meanY) ** 2, 0);
      const r2 = ss_tot > 0 ? 1 - ss_res / ss_tot : 0;
      if (r2 > 0.30 && phi > 0.50 && phi < 0.98) {
        // Blended target: 50% N&P median + 50% company floor
        const company_floor = Math.min(...valid);
        const blended_target = blendWeight * npTarget + (1 - blendWeight) * company_floor;
        const final_target = Math.max(blended_target, npTarget);
        return {
          driver, phi, alpha, r_squared: r2,
          source: "COMPANY_SPECIFIC",
          target: final_target,
          target_source: `${(blendWeight * 100).toFixed(0)}% N&P (${(npTarget * 100).toFixed(1)}%) + ${((1 - blendWeight) * 100).toFixed(0)}% company floor (${(company_floor * 100).toFixed(1)}%)`,
        };
      }
    }
    return {
      driver, phi: npDefault, alpha: npTarget * (1 - npDefault), r_squared: 0,
      source: "NP_DEFAULT",
      target: npTarget,
      target_source: "N&P (2001) Table 3",
    };
  };
  results.push(estimate("PM", pmSeries, npDefaultPM, targetPM));
  results.push(estimate("ATO", atoSeries, npDefaultATO, targetATO));
  results.push(estimate("sales_growth", salesGrowthSeries, npDefaultSalesGrowth, targetSalesGrowth));
  return results;
}
