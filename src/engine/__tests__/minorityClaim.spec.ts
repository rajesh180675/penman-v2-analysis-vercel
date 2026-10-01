import { describe, expect, it } from "vitest";
import { computeValuation } from "../PenmanNissimEngine";
import type { LegacyValuationPeriodInput } from "../forecastState/legacyAdapter";
import { DEFAULT_CONFIG } from "../types";

// Reliance-shaped: a minority of 50 on the books earning 4% a year against a
// 12% cost of equity. Its claim on the forecast is worth far less than book.
const KE = 0.12;
const G = 0.03;

function forecast(minorityIncome: number | null, minorityBook = 50): LegacyValuationPeriodInput[] {
  const periods: LegacyValuationPeriodInput[] = [{
    period_end: "2025-03-31",
    bs: { CSE: 200, NOA: 300, NFO: 50, MI: minorityBook, separationScore: 1 },
    is: { CNI: 30, OI: 36 },
    cf: { DividendPaid: 0, d_t: 0 },
  }];
  for (let t = 1; t <= 5; t += 1) {
    periods.push({
      period_end: `${2025 + t}-03-31`,
      bs: { CSE: 200, NOA: 300, NFO: 50, MI: minorityBook, separationScore: 1 },
      is: { CNI: 30, OI: 36, ...(minorityIncome != null ? { MII: minorityIncome } : {}) },
      cf: { DividendPaid: 30, d_t: 30 },
    });
  }
  return periods;
}

describe("the minority claim in the enterprise→common bridge", () => {
  it("is valued on the minority's residual income, below book when it earns below ke", () => {
    const v = computeValuation(forecast(2), KE, 0.11, G, DEFAULT_CONFIG);
    // 2 − 0.12·50 = −4 a year, forever at 3% growth: worth well under 50.
    expect(v.minorityClaimBasis).toBe("residual-income");
    expect(v.minorityClaim).toBeLessThan(50);
    expect(v.minorityClaim).toBeGreaterThan(0);
    // The bridge subtracts the claim, not the book.
    const atBook = computeValuation(forecast(null), KE, 0.11, G, DEFAULT_CONFIG);
    expect(v.V_ReOI_CV03! - atBook.V_ReOI_CV03!).toBeCloseTo(50 - v.minorityClaim, 9);
  });

  it("stays at book when the forecast carries no minority income", () => {
    const v = computeValuation(forecast(null), KE, 0.11, G, DEFAULT_CONFIG);
    expect(v.minorityClaimBasis).toBe("book");
    expect(v.minorityClaim).toBe(50);
  });

  it("is floored at zero: a limited-liability claim cannot be worth less", () => {
    const v = computeValuation(forecast(-20), KE, 0.11, G, DEFAULT_CONFIG);
    expect(v.minorityClaim).toBe(0);
  });

  it("equals book when the minority earns exactly ke on it", () => {
    const v = computeValuation(forecast(KE * 50), KE, 0.11, G, DEFAULT_CONFIG);
    expect(v.minorityClaim).toBeCloseTo(50, 9);
  });
});
