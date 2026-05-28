/* ================================================================
   Plan 5 PR-5.2 — clean-surplus contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import { checkCleanSurplus } from "../cleanSurplus";

function periods(seq: Array<{ p: string; bv: number; ci: number; div: number; iss: number }>) {
  return seq.map((s) => ({
    periodEnd: s.p,
    commonEquity: s.bv,
    comprehensiveIncome: s.ci,
    dividends: s.div,
    netStockIssuance: s.iss,
  }));
}

describe("checkCleanSurplus (Plan 5 PR-5.2)", () => {
  it("returns 'clean' when ΔBV reconciles to CI - dividends + issuance exactly", () => {
    const result = checkCleanSurplus({
      periods: periods([
        { p: "2023-03-31", bv: 1000, ci: 0, div: 0, iss: 0 },
        { p: "2024-03-31", bv: 1100, ci: 150, div: 50, iss: 0 },
      ]),
    });
    expect(result.overall).toBe("clean");
    expect(result.evaluatedPeriods).toBe(1);
    expect(Math.abs(result.worstResidualRatio)).toBeLessThan(1e-9);
  });

  it("flags 'material-dirty' when a 5% residual leaks past the income statement", () => {
    const result = checkCleanSurplus({
      periods: periods([
        { p: "2023-03-31", bv: 1000, ci: 0, div: 0, iss: 0 },
        // ΔBV = 200, but CI - div + iss = 100 -> 100 dirty surplus, ~10% of avg BV
        { p: "2024-03-31", bv: 1200, ci: 150, div: 50, iss: 0 },
      ]),
    });
    expect(result.overall).toBe("material-dirty");
    expect(result.worstResidualRatio).toBeGreaterThan(0.01);
  });

  it("flags 'minor-dirty' for a 0.5% residual", () => {
    const result = checkCleanSurplus({
      periods: periods([
        { p: "2023-03-31", bv: 1000, ci: 0, div: 0, iss: 0 },
        // ΔBV = 105.5, CI - div + iss = 100 -> 5.5 / 1052.75 ≈ 0.5%
        { p: "2024-03-31", bv: 1105.5, ci: 150, div: 50, iss: 0 },
      ]),
    });
    expect(result.overall).toBe("minor-dirty");
    expect(result.worstResidualRatio).toBeGreaterThan(0.0025);
    expect(result.worstResidualRatio).toBeLessThan(0.01);
  });

  it("escalates overall verdict to the worst per-period status", () => {
    const result = checkCleanSurplus({
      periods: periods([
        { p: "2022-03-31", bv: 1000, ci: 0, div: 0, iss: 0 },
        { p: "2023-03-31", bv: 1100, ci: 150, div: 50, iss: 0 }, // clean
        { p: "2024-03-31", bv: 1300, ci: 150, div: 50, iss: 0 }, // ~9% dirty
      ]),
    });
    expect(result.overall).toBe("material-dirty");
    expect(result.perPeriod[0]?.status).toBe("clean");
    expect(result.perPeriod[1]?.status).toBe("material-dirty");
  });

  it("first period has no prior BV — skipped (evaluatedPeriods = 0)", () => {
    const result = checkCleanSurplus({
      periods: periods([{ p: "2024-03-31", bv: 1000, ci: 100, div: 0, iss: 0 }]),
    });
    expect(result.evaluatedPeriods).toBe(0);
    expect(result.overall).toBe("clean");
  });

  it("net buyback (negative issuance) reconciles correctly", () => {
    const result = checkCleanSurplus({
      periods: periods([
        { p: "2023-03-31", bv: 1000, ci: 0, div: 0, iss: 0 },
        // ΔBV = 60, CI = 150, div = 50, iss = -40 (buyback) -> 150-50-40 = 60. clean.
        { p: "2024-03-31", bv: 1060, ci: 150, div: 50, iss: -40 },
      ]),
    });
    expect(result.overall).toBe("clean");
  });

  it("custom thresholds override defaults", () => {
    // Same data as the minor-dirty case, but tighter material threshold.
    const r1 = checkCleanSurplus({
      periods: periods([
        { p: "2023-03-31", bv: 1000, ci: 0, div: 0, iss: 0 },
        { p: "2024-03-31", bv: 1105.5, ci: 150, div: 50, iss: 0 },
      ]),
      materialThreshold: 0.001, // 0.1%
    });
    expect(r1.overall).toBe("material-dirty");
  });
});
