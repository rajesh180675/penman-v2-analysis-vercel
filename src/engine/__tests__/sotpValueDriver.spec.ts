import { describe, expect, it } from "vitest";
import { buildSOTPValuation, SegmentDefinition } from "../sotpValuation";
import { RecastPeriod } from "../types";

/**
 * SOTP value-driver regression.
 *
 * Segment value must follow the McKinsey value-driver Gordon form (consistent
 * with terminalEconomics.ts, reinvestmentRate = g / RONIC):
 *   V = NOPAT0 · (1 − g/RONIC) · (1+g) / (kw − g)
 * The prior `NOPAT0 / (ke − g)` granted growth for free (discounted at ke−g but
 * charged no reinvestment) and capitalised the CURRENT flow rather than next
 * year's. These hand-computed cases pin the corrected math and prove the
 * reinvestment haircut + CF1 numerator are live.
 *
 * NOPAT0 is the segment's share of the recast's OI, which is already after
 * tax. The SOTP used to multiply it by (1 − tax rate) again.
 */

// Minimal period: only the fields buildSOTPValuation reads (is.OI, bs.NOA),
// plus a tax rate it must not apply a second time.
function mkPeriod(oi: number, noa: number, taxRate = 0.25): RecastPeriod {
  return {
    period_end: "2025-03-31",
    is: { OI: oi, taxRate },
    bs: { NOA: noa },
  } as unknown as RecastPeriod;
}

describe("SOTP applies the value-driver reinvestment haircut on next-year flow", () => {
  it("charges reinvestment (1 − g/RONIC) and uses CF1, not free growth on CF0", () => {
    // OI=100 (after tax) = NOPAT0; allocatedNOA=500 → RONIC=100/500=0.20.
    // kw=0.13, g=0.05 → denom=0.08.
    //   distributable (FCF0) = 100·(1 − 0.05/0.20) = 75
    //   V = 75·(1.05)/0.08 = 984.375     (old free-growth form: 100/0.08 = 1,250)
    const period = mkPeriod(100, 500);
    const segs: SegmentDefinition[] = [
      { name: "Solo", operatingProfitShare: 1, sectorTemplate: "consumer-staples", terminalGrowthOverride: 0.05 },
    ];
    const result = buildSOTPValuation(period, segs, 0.13);

    expect(result.segments[0]!.segmentValue).toBeCloseTo(984.375, 6);
    // Guard against the old free-growth form (1,250) silently returning.
    expect(result.segments[0]!.segmentValue).toBeLessThan(1_250 - 1);
    expect(result.segments[0]!.impliedMultiple).toBeCloseTo(9.84375, 6);
  });

  it("taxes the operating income once: the period's tax rate does not enter", () => {
    // Taxed again at 25%, NOPAT0 would be 75 and RONIC 0.15, so
    // FCF0 = 75·(1 − 0.05/0.15) = 50 and V = 50·1.05/0.08 = 656.25: two thirds
    // of the after-tax value.
    const segs: SegmentDefinition[] = [
      { name: "Solo", operatingProfitShare: 1, sectorTemplate: "consumer-staples", terminalGrowthOverride: 0.05 },
    ];
    const taxed = buildSOTPValuation(mkPeriod(100, 500, 0.25), segs, 0.13);
    const untaxed = buildSOTPValuation(mkPeriod(100, 500, 0), segs, 0.13);
    expect(taxed.segments[0]!.segmentValue).toBe(untaxed.segments[0]!.segmentValue);
    expect(taxed.segments[0]!.operatingProfit).toBe(100);
    expect(taxed.segments[0]!.segmentValue).not.toBeCloseTo(656.25, 1);
  });

  it("discounts at the rate it is given, plus the segment's sector adjustment", () => {
    // kw 0.12 with a −0.01 adjustment → 0.11; RONIC 0.20, g 0.05:
    //   V = 75·1.05/(0.11 − 0.05) = 1,312.5
    const segs: SegmentDefinition[] = [
      { name: "Solo", operatingProfitShare: 1, sectorTemplate: "consumer-staples", terminalGrowthOverride: 0.05, keAdjustment: -0.01 },
    ];
    const result = buildSOTPValuation(mkPeriod(100, 500), segs, 0.12);
    expect(result.segments[0]!.segmentKw).toBeCloseTo(0.11, 12);
    expect(result.segments[0]!.segmentValue).toBeCloseTo(1_312.5, 6);
  });

  it("falls back to the no-growth perpetuity when RONIC ≤ g (growth not self-fundable)", () => {
    // OI=30 (after tax) = NOPAT0; allocatedNOA=500 → RONIC=30/500=0.06.
    // g=0.08 > RONIC=0.06, kw=0.13 → denom=0.05 (>0.01, so not the null branch).
    // Growth cannot be self-funded → no-growth perpetuity NOPAT/kw = 30/0.13 = 230.77.
    // (Old free-growth form would have paid 30/0.05 = 600.)
    const period = mkPeriod(30, 500);
    const segs: SegmentDefinition[] = [
      { name: "Solo", operatingProfitShare: 1, sectorTemplate: "consumer-staples", terminalGrowthOverride: 0.08 },
    ];
    const result = buildSOTPValuation(period, segs, 0.13);

    expect(result.segments[0]!.segmentValue).toBeCloseTo(230.77, 1);
    expect(result.segments[0]!.segmentValue).toBeLessThan(600 - 1);
  });

  it("denies the growth credit when kw − g is within a point, rather than valuing the segment at nothing", () => {
    // g override 0.13 with kw 0.13 → denom 0: the rate cannot carry the
    // growth, so the segment takes its no-growth value NOPAT/kw = 100/0.13.
    // It used to be null, which the sum read as ₹0.
    const period = mkPeriod(100, 500);
    const segs: SegmentDefinition[] = [
      { name: "Solo", operatingProfitShare: 1, sectorTemplate: "consumer-staples", terminalGrowthOverride: 0.13 },
    ];
    const result = buildSOTPValuation(period, segs, 0.13);
    expect(result.segments[0]!.segmentValue).toBeCloseTo(100 / 0.13, 9);
    expect(result.operatingSum).toBeCloseTo(100 / 0.13, 9);
    // At 0.125 the spread is half a point: still no growth credit.
    const thin = buildSOTPValuation(period, [{ ...segs[0]!, terminalGrowthOverride: 0.125 }], 0.13);
    expect(thin.segments[0]!.segmentValue).toBeCloseTo(100 / 0.13, 9);
  });
});
