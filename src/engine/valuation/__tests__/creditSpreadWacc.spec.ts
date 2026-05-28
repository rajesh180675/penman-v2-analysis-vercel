/* ================================================================
   Plan 5b PR-5b.2 — Credit-spread WACC contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import {
  getCreditSpreadsData,
  interpolateSovereignYield,
  spreadForRating,
  costOfDebt,
  buildWacc,
} from "../creditSpreadWacc";

describe("creditSpreadWacc data (Plan 5b PR-5b.2)", () => {
  it("snapshot ships with sovereign curve, spreads, retrievalDate", () => {
    const d = getCreditSpreadsData();
    expect(d.retrievalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.sovereignCurve.length).toBeGreaterThanOrEqual(5);
    expect(d.corporateSpreadsBps.length).toBeGreaterThanOrEqual(8);
    expect(d.corporateSpreadsBps.find((r) => r.rating === "BBB")).toBeDefined();
    expect(d.corporateSpreadsBps.find((r) => r.rating === "AAA")).toBeDefined();
  });
});

describe("interpolateSovereignYield", () => {
  it("exact tenors match the curve", () => {
    const d = getCreditSpreadsData();
    const ten = d.sovereignCurve.find((p) => p.tenorYears === 10);
    expect(interpolateSovereignYield(10)).toBe(ten?.yield);
  });

  it("interpolates between knots (5y and 10y)", () => {
    const y7 = interpolateSovereignYield(7);
    const d = getCreditSpreadsData();
    const five = d.sovereignCurve.find((p) => p.tenorYears === 5)!.yield;
    const ten = d.sovereignCurve.find((p) => p.tenorYears === 10)!.yield;
    expect(y7).toBeGreaterThanOrEqual(Math.min(five, ten));
    expect(y7).toBeLessThanOrEqual(Math.max(five, ten));
  });

  it("clamps to endpoints outside the curve range", () => {
    const d = getCreditSpreadsData();
    const first = d.sovereignCurve[0]!.yield;
    const last = d.sovereignCurve[d.sovereignCurve.length - 1]!.yield;
    expect(interpolateSovereignYield(0.1)).toBe(first);
    expect(interpolateSovereignYield(100)).toBe(last);
  });
});

describe("spreadForRating", () => {
  it("AAA spread is much smaller than B spread", () => {
    expect(spreadForRating("AAA", 5)).toBeLessThan(spreadForRating("B", 5));
  });

  it("Spread widens with tenor for the same rating", () => {
    expect(spreadForRating("BBB", 1)).toBeLessThan(spreadForRating("BBB", 10));
  });

  it("Unknown rating falls back to BBB", () => {
    expect(spreadForRating("not-a-rating", 5)).toBe(spreadForRating("BBB", 5));
  });

  it("Tenor matched to nearest column", () => {
    // 4y is closer to 3y than 5y in column distance? 4-3=1, 5-4=1 — tie, picks first hit (3y)
    expect(spreadForRating("AAA", 4)).toBe(spreadForRating("AAA", 3));
    // 7y is closer to 5y than 10y (gap 2 vs 3)
    expect(spreadForRating("AAA", 7)).toBe(spreadForRating("AAA", 5));
  });
});

describe("costOfDebt", () => {
  it("kd = rf + spread, with after-tax = kd * (1 - tax)", () => {
    const r = costOfDebt({ rating: "AAA", tenorYears: 10, taxRate: 0.25 });
    const expectedRf = interpolateSovereignYield(10);
    const expectedSpread = spreadForRating("AAA", 10);
    expect(r.kdPretax).toBeCloseTo(expectedRf + expectedSpread, 9);
    expect(r.kdAfterTax).toBeCloseTo(r.kdPretax * 0.75, 9);
  });

  it("citation echoes the tenor, rating, and snapshot date", () => {
    const r = costOfDebt({ rating: "A", tenorYears: 5, taxRate: 0.25 });
    const d = getCreditSpreadsData();
    expect(r.citation.rating).toBe("A");
    expect(r.citation.sovereignTenor).toBe(5);
    expect(r.citation.retrievalDate).toBe(d.retrievalDate);
    expect(r.citation.spreadBps).toBeGreaterThan(0);
  });
});

describe("buildWacc", () => {
  it("WACC is the weighted average of ke and kdAfterTax when weights sum to 1", () => {
    const r = buildWacc({ ke: 0.13, kdAfterTax: 0.06, weightDebt: 0.30, weightEquity: 0.70 });
    expect(r.wacc).toBeCloseTo(0.13 * 0.70 + 0.06 * 0.30, 9);
    expect(r.weightsRebalanced).toBe(false);
  });

  it("Weights that don't sum to 1 are rebalanced and flagged", () => {
    const r = buildWacc({ ke: 0.13, kdAfterTax: 0.06, weightDebt: 30, weightEquity: 70 });
    expect(r.weightsRebalanced).toBe(true);
    expect(r.weightDebt).toBeCloseTo(0.30, 6);
    expect(r.weightEquity).toBeCloseTo(0.70, 6);
    expect(r.wacc).toBeCloseTo(0.13 * 0.70 + 0.06 * 0.30, 6);
  });

  it("All-equity firm: wacc = ke", () => {
    const r = buildWacc({ ke: 0.15, kdAfterTax: 0.05, weightDebt: 0, weightEquity: 1 });
    expect(r.wacc).toBe(0.15);
  });
});
