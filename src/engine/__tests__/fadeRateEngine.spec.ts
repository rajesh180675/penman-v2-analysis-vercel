import { describe, it, expect } from "vitest";
import { estimateFadeRate, analyzeFadeRate } from "../fadeRateEngine";
import type { RecastPeriod } from "../types";

// Helper to build minimal RecastPeriod stubs with ReOI series
function buildRecastStubs(reoiValues: number[], startYear = 2010): RecastPeriod[] {
  return reoiValues.map((reoi, i) => ({
    period_end: `${startYear + i}0331`,
    ri: { ReOI: reoi, ReOI_growth: null, ReOI_margin: null, capitalCharge: 0 },
    ratios: { PM: 0.12 + i * 0.001, ATO: 1.5 - i * 0.01, RNOA: 0.18, ROCE: null, NBC: null, SPREAD: null, FLEV: null, ROE: null, accrual_ratio_bs: null, accrual_ratio_cf: null },
    bs: { NOA: 10000 + i * 500, NFO: 2000, CSE: 8000 + i * 500, OA_Cash: 0, OA_Receivables: 0, OA_Inventory: 0, OA_OtherCurrentAssets: 0, OA_PPE: 0, OA_Intangibles: 0, OA_OtherNonCurrentAssets: 0, OL_Payables: 0, OL_OtherCurrentLiabilities: 0, OL_OtherNonCurrentLiabilities: 0, DTL: 0, PensionObl: 0, OL_ex_DTL: 0, FA_Cash: 0, FA_ShortTermInvestments: 0, FA_LongTermInvestments: 0, FL_ShortTermDebt: 0, FL_LongTermDebt: 0, FL_OtherFinancialLiabilities: 0, MinorityInterest: 0 },
  } as unknown as RecastPeriod));
}

describe("fadeRateEngine", () => {
  describe("estimateFadeRate", () => {
    it("estimates ω for a persistent (high moat) series", () => {
      // Series where ReOI decays slowly: 100, 90, 82, 75, 69, 63, 58, 53, 49, 45
      const reois = [100, 90, 82, 75, 69, 63, 58, 53, 49, 45];
      const data = buildRecastStubs(reois);
      const result = estimateFadeRate(data, 0.13, "fmcg");

      expect(result.omega).toBeGreaterThan(0.5);
      expect(result.omega).toBeLessThan(0.95);
      expect(result.omegaRaw).toBeCloseTo(0.9032, 3); // exact AR(1) coefficient from engine
      expect(result.omega).toBeGreaterThan(0.5); // shrunk omega stays in durable range
      expect(result.nObservations).toBe(9);
      expect(result.impliedCompetitiveAdvantage).toBe("durable");
      expect(result.terminalValueMultiplier).toBeCloseTo(2.386, 2);
    });

    it("estimates low ω for a mean-reverting (cyclical) series", () => {
      // Cyclical series with no persistence
      const reois = [100, -20, 80, -30, 50, -10, 60, -25, 40, 10];
      const data = buildRecastStubs(reois);
      const result = estimateFadeRate(data, 0.13, "metals");

      expect(result.omega).toBeLessThan(0.5);
      expect(result.omegaIndustryPrior).toBe(0.35);
    });

    it("applies Bayesian shrinkage toward industry prior", () => {
      // With few observations, should shrink toward prior
      const shortSeries = [100, 85, 72]; // only 2 AR observations
      const data = buildRecastStubs(shortSeries);
      const result = estimateFadeRate(data, 0.13, "it-services");

      // With n=2, λ = 2/(2+10) = 0.17, heavily weighted toward industry prior of 0.72
      expect(result.shrinkageWeight).toBeCloseTo(0.17, 1);
      expect(result.omega).toBeCloseTo(0.72, 0.15); // near industry prior
    });

    it("detects structural breaks", () => {
      // Clear regime shift: stable then jump
      const reois = [50, 52, 48, 51, 49, 150, 145, 140, 135, 130, 125, 120];
      const data = buildRecastStubs(reois);
      const result = estimateFadeRate(data, 0.13);

      expect(result.structuralBreak.detected).toBe(true);
    });

    it("computes terminal value multiplier correctly", () => {
      const reois = [100, 80, 65, 53, 43, 35, 29, 24, 20, 16];
      const data = buildRecastStubs(reois);
      const result = estimateFadeRate(data, 0.13);

      // TV multiplier = ω / (1 + r - ω)
      const expected = result.omega / (1 + 0.13 - result.omega);
      expect(result.terminalValueMultiplier).toBeCloseTo(expected, 4);
    });

    it("uses default prior when sector unknown", () => {
      const reois = [100, 85, 72, 61, 52, 44, 38, 32, 27, 23];
      const data = buildRecastStubs(reois);
      const result = estimateFadeRate(data, 0.13, "unknown-sector");

      expect(result.omegaIndustryPrior).toBe(0.55); // default
    });
  });

  describe("analyzeFadeRate", () => {
    it("returns equilibrium RNOA for known sectors", () => {
      const reois = [100, 85, 72, 61, 52, 44, 38, 32, 27, 23];
      const data = buildRecastStubs(reois);
      const result = analyzeFadeRate(data, 0.13, "it-services");

      expect(result.equilibriumRNOA).toBe(0.38);
      expect(result.firm.omega).toBeGreaterThan(0);
    });

    it("computes adjusted terminal value with equilibrium", () => {
      const reois = [100, 85, 72, 61, 52, 44, 38, 32, 27, 23];
      const data = buildRecastStubs(reois);
      const result = analyzeFadeRate(data, 0.13, "fmcg");

      expect(result.adjustedTerminalValue).not.toBeNull();
      // Should be higher than just ω-based fade (because equilibrium RNOA > 0)
      expect(result.adjustedTerminalValue!).toBeGreaterThan(0);
    });

    it("coerces NaN costOfCapital to a finite default rather than poisoning omega", () => {
      // Reproduces the under-specified config cascade: NaN inputs must not
      // propagate through OLS / omega / terminal value math.
      const reois = [100, 85, 72, 61, 52, 44, 38, 32, 27, 23];
      const data = buildRecastStubs(reois);
      const result = analyzeFadeRate(data, NaN, "fmcg");

      expect(Number.isFinite(result.firm.omega)).toBe(true);
      expect(Number.isFinite(result.firm.terminalValueMultiplier)).toBe(true);
    });

    it("coerces NaN taxRate to default", () => {
      const reois = [100, 85, 72, 61, 52, 44, 38, 32, 27, 23];
      const data = buildRecastStubs(reois);
      const result = analyzeFadeRate(data, 0.13, "fmcg", null, NaN);

      expect(Number.isFinite(result.firm.omega)).toBe(true);
    });
  });
});
