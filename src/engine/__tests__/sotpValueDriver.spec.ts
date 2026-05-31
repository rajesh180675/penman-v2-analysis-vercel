import { describe, expect, it } from "vitest";
import { buildSOTPValuation, SegmentDefinition } from "../sotpValuation";
import { RecastPeriod } from "../types";

/**
 * SOTP value-driver regression.
 *
 * Segment value must follow the McKinsey value-driver Gordon form (consistent
 * with terminalEconomics.ts, reinvestmentRate = g / RONIC):
 *   V = NOPAT0 · (1 − g/RONIC) · (1+g) / (ke − g)
 * The prior `NOPAT0 / (ke − g)` granted growth for free (discounted at ke−g but
 * charged no reinvestment) and capitalised the CURRENT flow rather than next
 * year's. These hand-computed cases pin the corrected math and prove the
 * reinvestment haircut + CF1 numerator are live.
 */

// Minimal period: only the fields buildSOTPValuation reads (is.OI, is.taxRate,
// bs.NOA). Everything else is irrelevant to segment valuation.
function mkPeriod(oi: number, noa: number, taxRate: number): RecastPeriod {
  return {
    period_end: "2025-03-31",
    is: { OI: oi, taxRate },
    bs: { NOA: noa },
  } as unknown as RecastPeriod;
}

describe("SOTP applies the value-driver reinvestment haircut on next-year flow", () => {
  it("charges reinvestment (1 − g/RONIC) and uses CF1, not free growth on CF0", () => {
    // opProfit=100, tax=0.25 → NOPAT0=75; allocatedNOA=500 → RONIC=75/500=0.15.
    // ke=0.13, g=0.05 → denom=0.08.
    //   distributable (FCF0) = 75·(1 − 0.05/0.15) = 75·(2/3) = 50
    //   V = 50·(1.05)/0.08 = 656.25     (old free-growth form: 75/0.08 = 937.5)
    const period = mkPeriod(100, 500, 0.25);
    const segs: SegmentDefinition[] = [
      { name: "Solo", operatingProfitShare: 1, sectorTemplate: "consumer-staples", terminalGrowthOverride: 0.05 },
    ];
    const result = buildSOTPValuation(period, segs, 0.13);

    expect(result.segments[0]!.segmentValue).toBeCloseTo(656.25, 1);
    // Guard against the old free-growth form (937.5) silently returning.
    expect(result.segments[0]!.segmentValue).toBeLessThan(937.5 - 1);
    expect(result.segments[0]!.impliedMultiple).toBeCloseTo(6.5625, 2);
  });

  it("falls back to the no-growth perpetuity when RONIC ≤ g (growth not self-fundable)", () => {
    // opProfit=40, tax=0.25 → NOPAT0=30; allocatedNOA=500 → RONIC=30/500=0.06.
    // g=0.08 > RONIC=0.06, ke=0.13 → denom=0.05 (>0.01, so not the null branch).
    // Growth cannot be self-funded → no-growth perpetuity NOPAT/ke = 30/0.13 = 230.77.
    // (Old free-growth form would have paid 30/0.05 = 600.)
    const period = mkPeriod(40, 500, 0.25);
    const segs: SegmentDefinition[] = [
      { name: "Solo", operatingProfitShare: 1, sectorTemplate: "consumer-staples", terminalGrowthOverride: 0.08 },
    ];
    const result = buildSOTPValuation(period, segs, 0.13);

    expect(result.segments[0]!.segmentValue).toBeCloseTo(230.77, 1);
    expect(result.segments[0]!.segmentValue).toBeLessThan(600 - 1);
  });

  it("returns null segmentValue/impliedMultiple when ke − g ≤ guardrail", () => {
    // g override 0.13 with ke 0.13 → denom 0 → null (unchanged behaviour).
    const period = mkPeriod(100, 500, 0.25);
    const segs: SegmentDefinition[] = [
      { name: "Solo", operatingProfitShare: 1, sectorTemplate: "consumer-staples", terminalGrowthOverride: 0.13 },
    ];
    const result = buildSOTPValuation(period, segs, 0.13);
    expect(result.segments[0]!.impliedMultiple).toBeNull();
  });
});
