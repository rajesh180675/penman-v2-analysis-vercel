/* ================================================================
   Plan 5b PR-5b.4 — ESG-adjusted cost of equity contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import {
  bucketForScore,
  esgAdjustmentBps,
  esgAdjustedKe,
  ESG_BUCKETS,
} from "../esgAdjustedKe";

describe("ESG bucket lookup (Plan 5b PR-5b.4)", () => {
  it("MSCI score 8.5 -> AAA bucket", () => {
    expect(bucketForScore(8.5)).toBe("AAA");
  });

  it("MSCI score 6.0 -> A bucket (>= 5.5 threshold)", () => {
    expect(bucketForScore(6.0)).toBe("A");
  });

  it("MSCI score 5.0 -> BBB bucket (just below A threshold)", () => {
    expect(bucketForScore(5.0)).toBe("BBB");
  });

  it("MSCI score 2.0 -> CCC bucket (just below B threshold of 2.5)", () => {
    expect(bucketForScore(2.0)).toBe("CCC");
  });

  it("Out-of-range scores clamp to AAA / CCC", () => {
    expect(bucketForScore(15)).toBe("AAA");
    expect(bucketForScore(-5)).toBe("CCC");
  });

  it("All seven buckets defined: AAA AA A BBB BB B CCC", () => {
    expect(Object.keys(ESG_BUCKETS).sort()).toEqual(
      ["A", "AA", "AAA", "B", "BB", "BBB", "CCC"].sort(),
    );
  });
});

describe("esgAdjustmentBps", () => {
  it("Best bucket (AAA) is a credit (negative bps) to ke", () => {
    expect(esgAdjustmentBps("AAA")).toBeLessThan(0);
  });

  it("Worst bucket (CCC) is a charge (positive bps) to ke", () => {
    expect(esgAdjustmentBps("CCC")).toBeGreaterThan(0);
  });

  it("Adjustment is monotonic: AAA < AA < ... < CCC", () => {
    const order = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"] as const;
    for (let i = 1; i < order.length; i++) {
      expect(esgAdjustmentBps(order[i])).toBeGreaterThan(esgAdjustmentBps(order[i - 1]));
    }
  });

  it("BBB bucket is roughly neutral (within +/- 25bps)", () => {
    expect(Math.abs(esgAdjustmentBps("BBB"))).toBeLessThanOrEqual(25);
  });
});

describe("esgAdjustedKe", () => {
  it("Adjusted ke = baseKe + adjustment / 10000", () => {
    const r = esgAdjustedKe({ baseKe: 0.13, msciScore: 7.5 });
    const expectedAdj = esgAdjustmentBps("AA") / 10000;
    expect(r.adjustedKe).toBeCloseTo(0.13 + expectedAdj, 6);
  });

  it("Citation echoes bucket, score, bps, baseKe", () => {
    const r = esgAdjustedKe({ baseKe: 0.13, msciScore: 6.0 });
    expect(r.citation.bucket).toBe("A");
    expect(r.citation.msciScore).toBe(6.0);
    expect(r.citation.adjustmentBps).toBe(esgAdjustmentBps("A"));
    expect(r.citation.baseKe).toBe(0.13);
  });

  it("Score for top bucket lowers ke vs baseline", () => {
    const baseline = esgAdjustedKe({ baseKe: 0.13, msciScore: 5.0 });
    const top = esgAdjustedKe({ baseKe: 0.13, msciScore: 9.0 });
    expect(top.adjustedKe).toBeLessThan(baseline.adjustedKe);
  });

  it("Score for bottom bucket raises ke vs baseline", () => {
    const baseline = esgAdjustedKe({ baseKe: 0.13, msciScore: 5.0 });
    const bottom = esgAdjustedKe({ baseKe: 0.13, msciScore: 1.0 });
    expect(bottom.adjustedKe).toBeGreaterThan(baseline.adjustedKe);
  });

  it("User-supplied bucket override wins over score", () => {
    const r = esgAdjustedKe({ baseKe: 0.13, bucket: "CCC", msciScore: 9.0 });
    expect(r.citation.bucket).toBe("CCC");
    expect(r.adjustedKe).toBeGreaterThan(0.13);
  });

  it("Neither bucket nor score given throws", () => {
    expect(() => esgAdjustedKe({ baseKe: 0.13 })).toThrow();
  });
});
