/* ================================================================
   Plan 5 PR-5.5 — Lease adjustment contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import { capitalizeOperatingLeases, validateLeaseSelfConsistency } from "../leaseAdjustments";

describe("capitalizeOperatingLeases (Plan 5 PR-5.5)", () => {
  it("default 8x multiple capitalises ₹100cr rent to ₹800cr debt", () => {
    const r = capitalizeOperatingLeases({ annualRent: 100 });
    expect(r.capitalizedDebt).toBe(800);
  });

  it("custom multiple respected", () => {
    const r = capitalizeOperatingLeases({ annualRent: 100, multiple: 6 });
    expect(r.capitalizedDebt).toBe(600);
  });

  it("imputedInterest is half of rent (S&P methodology)", () => {
    const r = capitalizeOperatingLeases({ annualRent: 100 });
    expect(r.imputedInterest).toBe(50);
    expect(r.imputedDepreciation).toBe(50);
  });

  it("tax shield = imputedInterest * taxRate", () => {
    const r = capitalizeOperatingLeases({ annualRent: 100, taxRate: 0.30 });
    expect(r.taxShield).toBe(15); // 50 * 0.30
  });

  it("restatedEbitda = reportedEbitda + annualRent (rent was opex, becomes dep+int)", () => {
    const r = capitalizeOperatingLeases({ annualRent: 100, reportedEbitda: 500 });
    expect(r.restatedEbitda).toBe(600);
  });

  it("restatedEbit = reportedEbit + interest portion only (depreciation replaces rent in opex)", () => {
    const r = capitalizeOperatingLeases({ annualRent: 100, reportedEbit: 400 });
    // gain = rent (100) - depreciation (50) = 50
    expect(r.restatedEbit).toBe(450);
  });

  it("when reported metrics absent, restated values are null", () => {
    const r = capitalizeOperatingLeases({ annualRent: 100 });
    expect(r.restatedEbitda).toBeNull();
    expect(r.restatedEbit).toBeNull();
  });
});

describe("validateLeaseSelfConsistency (Plan 5 PR-5.5)", () => {
  it("steady-state Ind-AS 116 disclosure -> 'consistent' or 'minor-mismatch' (no critical flags)", () => {
    // 5y lease, 7% interest. Liability ≈ 410 at 100/yr rent.
    // Year 1: depreciation = 82, interest = 29, total = 111 vs cash 100 = 11% gap.
    const r = validateLeaseSelfConsistency({
      rouAsset: 410,
      leaseLiability: 410,
      depreciationOnRou: 82,
      leaseInterest: 29,
      totalRentPayments: 100,
    });
    expect(r.verdict).not.toBe("material-mismatch");
    expect(r.impliedLeaseTermYears).toBeCloseTo(4.1, 1);
    expect(r.impliedInterestRate).toBeCloseTo(0.071, 2);
    expect(r.rouToLiabilityRatio).toBe(1.0);
  });

  it("flags 'material-mismatch' on suspiciously short implied term", () => {
    const r = validateLeaseSelfConsistency({
      rouAsset: 100,
      leaseLiability: 50, // implies ~0.5y term at 100/yr rent — too short
      depreciationOnRou: 25,
      leaseInterest: 5,
      totalRentPayments: 100,
    });
    expect(r.verdict).toBe("material-mismatch");
    expect(r.diagnostics.some((d) => d.includes("suspiciously short"))).toBe(true);
  });

  it("flags 'minor-mismatch' on out-of-band interest rate", () => {
    const r = validateLeaseSelfConsistency({
      rouAsset: 410,
      leaseLiability: 410,
      depreciationOnRou: 82,
      leaseInterest: 4, // < 1% — implausible
      totalRentPayments: 86,
    });
    expect(r.verdict).toBe("minor-mismatch");
    expect(r.diagnostics.some((d) => d.includes("interest rate"))).toBe(true);
  });

  it("flags ROU/liability ratio drift outside 0.7-1.4", () => {
    const r = validateLeaseSelfConsistency({
      rouAsset: 200, // half the liability — drift
      leaseLiability: 400,
      depreciationOnRou: 80,
      leaseInterest: 28,
      totalRentPayments: 108,
    });
    expect(r.verdict).toBe("minor-mismatch");
    expect(r.diagnostics.some((d) => d.includes("ROU/liability"))).toBe(true);
  });

  it("zero rent payments yields impliedTerm = Infinity, no false flag", () => {
    const r = validateLeaseSelfConsistency({
      rouAsset: 0,
      leaseLiability: 0,
      depreciationOnRou: 0,
      leaseInterest: 0,
      totalRentPayments: 0,
    });
    expect(Number.isFinite(r.impliedLeaseTermYears)).toBe(false);
    expect(r.verdict).toBe("minor-mismatch"); // zero ratio drift
  });
});
