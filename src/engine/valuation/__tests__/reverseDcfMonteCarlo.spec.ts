/* ================================================================
   Plan 5 PR-5.1 — reverseDcfMonteCarlo contract tests.

   Three contracts:
     1. Same runId -> byte-identical results (reproducibility audit).
     2. Different runId -> different results (sanity).
     3. Implied growth at P50 falls between -5% and the WACC mean
        for reasonable inputs.
================================================================ */

import { describe, it, expect } from "vitest";
import { runReverseDcfMonteCarlo, type ReverseDcfMonteCarloInputs } from "../reverseDcfMonteCarlo";

const baseInputs: Omit<ReverseDcfMonteCarloInputs, "runId"> = {
  currentPrice: 100,
  revenuePerShare: 50,
  margin: { mean: 0.15, sigma: 0.02 },
  growth: { mean: 0.08, sigma: 0.02 },
  wacc: { mean: 0.12, sigma: 0.015 },
  horizonYears: 10,
  paths: 2000,
};

describe("reverseDcfMonteCarlo (Plan 5 PR-5.1)", () => {
  it("same runId produces identical results", () => {
    const a = runReverseDcfMonteCarlo({ ...baseInputs, runId: "run-stable-123" });
    const b = runReverseDcfMonteCarlo({ ...baseInputs, runId: "run-stable-123" });
    expect(a.seed).toBe(b.seed);
    expect(a.impliedGrowthP5).toBe(b.impliedGrowthP5);
    expect(a.impliedGrowthP50).toBe(b.impliedGrowthP50);
    expect(a.impliedGrowthP95).toBe(b.impliedGrowthP95);
    expect(a.convergedPaths).toBe(b.convergedPaths);
  });

  it("different runIds produce different seeds and results", () => {
    const a = runReverseDcfMonteCarlo({ ...baseInputs, runId: "run-A" });
    const b = runReverseDcfMonteCarlo({ ...baseInputs, runId: "run-B" });
    expect(a.seed).not.toBe(b.seed);
    expect(a.impliedGrowthP50).not.toBe(b.impliedGrowthP50);
  });

  it("P5 <= P50 <= P95 for converged sample", () => {
    const r = runReverseDcfMonteCarlo({ ...baseInputs, runId: "ordering-test" });
    expect(r.impliedGrowthP5).toBeLessThanOrEqual(r.impliedGrowthP50);
    expect(r.impliedGrowthP50).toBeLessThanOrEqual(r.impliedGrowthP95);
  });

  it("implied growth is bounded by [-5%, WACC mean] when most paths converge", () => {
    const r = runReverseDcfMonteCarlo({ ...baseInputs, runId: "bounds-test" });
    expect(r.convergedPaths).toBeGreaterThan(1000); // majority of 2000
    expect(r.impliedGrowthP50).toBeGreaterThanOrEqual(-0.05);
    expect(r.impliedGrowthP50).toBeLessThan(0.12);
  });

  it("horizon 5 vs horizon 15 with same runId yields different P50", () => {
    const short = runReverseDcfMonteCarlo({ ...baseInputs, horizonYears: 5, runId: "horizon-test" });
    const long = runReverseDcfMonteCarlo({ ...baseInputs, horizonYears: 15, runId: "horizon-test" });
    expect(short.impliedGrowthP50).not.toBe(long.impliedGrowthP50);
  });
});
