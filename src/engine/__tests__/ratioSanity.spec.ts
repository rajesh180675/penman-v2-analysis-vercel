/**
 * Phase 9 — Anchor ratio bands (economic sanity gates) tests.
 */
import { describe, it, expect } from "vitest";
import { evaluateRatioSanity } from "../ratioSanity";

describe("ratio sanity bands", () => {
  describe("bank", () => {
    it("clean bank produces ok status", () => {
      const result = evaluateRatioSanity({
        companyType: "bank",
        bank: { nim: 0.035, roa: 0.012, roe: 0.16, costToIncome: 0.42, creditCost: 0.008 },
      });
      expect(result.status).toBe("ok");
      expect(result.failCount).toBe(0);
      expect(result.checks.length).toBeGreaterThan(3);
    });

    it("flags 60% NIM as economically impossible", () => {
      const result = evaluateRatioSanity({
        companyType: "bank",
        bank: { nim: 0.60, roa: 0.012, roe: 0.16 },
      });
      expect(result.status).toBe("fail");
      expect(result.failCount).toBeGreaterThan(0);
      const nimCheck = result.checks.find((c) => c.key === "bank.nim");
      expect(nimCheck?.status).toBe("fail");
      expect(nimCheck?.detail).toMatch(/implausible/);
    });

    it("warns on 5.5% NIM (high but plausible)", () => {
      const result = evaluateRatioSanity({
        companyType: "bank",
        bank: { nim: 0.055, roa: 0.012, roe: 0.16 },
      });
      expect(result.status).toBe("warning");
      const nimCheck = result.checks.find((c) => c.key === "bank.nim");
      expect(nimCheck?.status).toBe("warning");
    });
  });

  describe("nbfc", () => {
    it("Bajaj Finance-style NBFC produces ok status", () => {
      // Real Bajaj Finance numbers from earlier: leverage 3.7x, spread 9.2%, NIM 9.9%
      const result = evaluateRatioSanity({
        companyType: "nbfc",
        bank: {
          nim: 0.099,
          roa: 0.04,
          roe: 0.19,
          leverage: 3.71,
          spread: 0.092,
          yieldOnAdvances: 0.167,
          costOfBorrowings: 0.074,
        },
      });
      expect(result.status).toBe("ok");
      expect(result.failCount).toBe(0);
    });

    it("flags 15x leverage as fail", () => {
      const result = evaluateRatioSanity({
        companyType: "nbfc",
        bank: { nim: 0.08, roa: 0.02, roe: 0.15, leverage: 15.0 },
      });
      expect(result.status).toBe("fail");
      const lev = result.checks.find((c) => c.key === "nbfc.leverage");
      expect(lev?.status).toBe("fail");
    });
  });

  describe("it-services", () => {
    it("TCS-like profile produces ok", () => {
      const result = evaluateRatioSanity({
        companyType: "it-services",
        industrial: { ROCE: 0.45, RNOA: 1.20, PM: 0.22 },
      });
      expect(result.status).toBe("ok");
    });

    it("flags 5% PM as impossible for IT-services", () => {
      const result = evaluateRatioSanity({
        companyType: "it-services",
        industrial: { ROCE: 0.45, RNOA: 1.20, PM: 0.05 },
      });
      // 5% is below warning band of 8% — should fail
      const pm = result.checks.find((c) => c.key === "it.pm");
      expect(pm?.status).toBe("fail");
    });
  });

  describe("industrial", () => {
    it("ITC-like profile produces ok", () => {
      const result = evaluateRatioSanity({
        companyType: "industrial",
        industrial: { ROCE: 0.25, RNOA: 0.30, PM: 0.18, FLEV: 0.1 },
      });
      expect(result.status).toBe("ok");
    });

    it("flags 250% ROCE as impossible", () => {
      const result = evaluateRatioSanity({
        companyType: "industrial",
        industrial: { ROCE: 2.5, RNOA: 0.30, PM: 0.18 },
      });
      expect(result.status).toBe("fail");
    });
  });

  describe("utility", () => {
    it("Power Grid-style narrow band passes", () => {
      const result = evaluateRatioSanity({
        companyType: "utility",
        industrial: { ROCE: 0.12, RNOA: 0.10, PM: 0.18 },
      });
      expect(result.status).toBe("ok");
    });

    it("flags 35% ROCE as too high for utility", () => {
      const result = evaluateRatioSanity({
        companyType: "utility",
        industrial: { ROCE: 0.35, RNOA: 0.10, PM: 0.18 },
      });
      // 35% > warning ceiling 25%
      const roce = result.checks.find((c) => c.key === "utility.roce");
      expect(roce?.status).toBe("fail");
    });
  });

  describe("telecom", () => {
    it("Vodafone Idea negative margins still classified as plausible", () => {
      // Loss-making telecom is normal (Vi posts -20% to -40% PM)
      const result = evaluateRatioSanity({
        companyType: "telecom",
        industrial: { ROCE: -0.15, RNOA: -0.20, PM: -0.25 },
      });
      // -25% PM is in warning band [-0.40, -0.10], not fail
      expect(result.failCount).toBe(0);
    });
  });

  describe("cyclical", () => {
    it("Tata Steel peak-cycle high RNOA passes", () => {
      const result = evaluateRatioSanity({
        companyType: "cyclical",
        industrial: { ROCE: 0.25, RNOA: 0.35, PM: 0.20 },
      });
      expect(result.status).toBe("ok");
    });

    it("Tata Steel trough-cycle losses pass (cyclical normalcy)", () => {
      const result = evaluateRatioSanity({
        companyType: "cyclical",
        industrial: { ROCE: -0.05, RNOA: -0.10, PM: -0.05 },
      });
      // -5% PM and -10% RNOA are in warning band, not fail
      expect(result.failCount).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("returns n/a for insurance (no bands defined)", () => {
      const result = evaluateRatioSanity({
        companyType: "insurance",
        industrial: { ROCE: 0.10 },
      });
      expect(result.status).toBe("n/a");
      expect(result.checks.length).toBe(0);
    });

    it("handles null values gracefully", () => {
      const result = evaluateRatioSanity({
        companyType: "bank",
        bank: { nim: null, roa: null, roe: null },
      });
      expect(result.checks.every((c) => c.status === "n/a")).toBe(true);
    });

    it("returns n/a when no metrics provided", () => {
      const result = evaluateRatioSanity({ companyType: "bank" });
      expect(result.status).toBe("n/a");
    });

    // F3: ratio sanity must still fire when company_type="auto" is resolved
    // to a detected type. The D2 bug (sanity never fires for auto-detected
    // companies) is caught by pipeline.ts resolving the effective type before
    // calling evaluateRatioSanity. This test verifies the evaluateRatioSanity
    // function itself handles "auto" gracefully (falls back to broad industrial bands).
    it("F3: auto company_type falls back to broad industrial bands (not n/a)", () => {
      // An ITC-like industrial company with company_type="auto" should still
      // get sanity checks using the broad industrial bands.
      const result = evaluateRatioSanity({
        companyType: "auto",
        industrial: { ROCE: 0.25, RNOA: 0.30, PM: 0.18, FLEV: 0.1 },
      });
      // Should produce checks (not n/a) — broad industrial bands apply
      expect(result.status).not.toBe("n/a");
      expect(result.checks.length).toBeGreaterThan(0);
    });

    it("F3: auto company_type with impossible ROCE still flags as fail", () => {
      // Even with auto detection, a 250% ROCE should be caught.
      const result = evaluateRatioSanity({
        companyType: "auto",
        industrial: { ROCE: 2.5, RNOA: 0.30, PM: 0.18 },
      });
      expect(result.status).toBe("fail");
    });
  });
});
