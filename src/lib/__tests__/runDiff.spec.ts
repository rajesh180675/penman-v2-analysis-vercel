/* ================================================================
   Plan 8 PR-8.2 — Run-diff contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import { diffRuns, rankByImpact, topChanges } from "../runDiff";

describe("diffRuns (Plan 8 PR-8.2)", () => {
  it("Empty when snapshots are identical", () => {
    expect(diffRuns({ a: 1, b: 2 }, { a: 1, b: 2 })).toHaveLength(0);
  });

  it("Single numeric change reports delta + relativeDelta", () => {
    const d = diffRuns({ ke: 0.10 }, { ke: 0.13 });
    expect(d).toHaveLength(1);
    expect(d[0]?.key).toBe("ke");
    expect(d[0]?.prior).toBe(0.10);
    expect(d[0]?.current).toBe(0.13);
    expect(d[0]?.delta).toBeCloseTo(0.03, 5);
    expect(d[0]?.relativeDelta).toBeCloseTo(0.30, 5);
  });

  it("Negative delta is negative", () => {
    const d = diffRuns({ ke: 0.13 }, { ke: 0.10 });
    expect(d[0]?.delta).toBeCloseTo(-0.03, 5);
  });

  it("Zero prior produces null relativeDelta but non-null delta", () => {
    const d = diffRuns({ x: 0 }, { x: 5 });
    expect(d[0]?.delta).toBe(5);
    expect(d[0]?.relativeDelta).toBeNull();
  });

  it("Added cell (missing in prior) reports infinite impact", () => {
    const d = diffRuns({}, { ke: 0.13 });
    expect(d).toHaveLength(1);
    expect(d[0]?.impact).toBe(Number.POSITIVE_INFINITY);
    expect(d[0]?.prior).toBeUndefined();
    expect(d[0]?.current).toBe(0.13);
  });

  it("Removed cell (missing in current) reports infinite impact", () => {
    const d = diffRuns({ ke: 0.13 }, {});
    expect(d).toHaveLength(1);
    expect(d[0]?.impact).toBe(Number.POSITIVE_INFINITY);
  });

  it("String change reports infinite impact", () => {
    const d = diffRuns({ status: "draft" }, { status: "final" });
    expect(d).toHaveLength(1);
    expect(d[0]?.impact).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("rankByImpact + topChanges (Plan 8 PR-8.2)", () => {
  it("rankByImpact orders descending by absolute relative delta", () => {
    const d = diffRuns(
      { a: 100, b: 100, c: 100 },
      { a: 110, b: 200, c: 105 },
    );
    const ranked = rankByImpact(d);
    expect(ranked[0]?.key).toBe("b"); // +100% wins
    expect(ranked[1]?.key).toBe("a"); // +10%
    expect(ranked[2]?.key).toBe("c"); // +5%
  });

  it("Added/removed cells (infinite impact) rank above all numeric changes", () => {
    const d = diffRuns({ x: 100 }, { x: 1000, newCell: 5 });
    const ranked = rankByImpact(d);
    expect(ranked[0]?.key).toBe("newCell");
  });

  it("topChanges returns at most N changes", () => {
    const prior = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
    const current = { a: 2, b: 4, c: 6, d: 8, e: 10, f: 12 };
    expect(topChanges(prior, current, 3)).toHaveLength(3);
  });

  it("topChanges defaults to 5", () => {
    const prior = { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 };
    const current = { a: 2, b: 2, c: 2, d: 2, e: 2, f: 2, g: 2 };
    expect(topChanges(prior, current)).toHaveLength(5);
  });

  it("Realistic valuation diff finds the dominant driver", () => {
    const prior = {
      "valuation.ke": 0.10,
      "valuation.kd": 0.06,
      "valuation.terminalGrowth": 0.03,
      "valuation.netIncome": 1000,
      "valuation.intrinsicValue": 8500,
    };
    const current = {
      "valuation.ke": 0.13, // +30%
      "valuation.kd": 0.062, // +3.3%
      "valuation.terminalGrowth": 0.03, // unchanged
      "valuation.netIncome": 1050, // +5%
      "valuation.intrinsicValue": 6800, // -20%
    };
    const ranked = rankByImpact(diffRuns(prior, current));
    expect(ranked[0]?.key).toBe("valuation.ke");
    expect(ranked.find((c) => c.key === "valuation.terminalGrowth")).toBeUndefined();
  });
});
