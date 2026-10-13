import { describe, expect, it } from "vitest";
import type { ValuationResult } from "../../types";
import type { ValuationScenarioCard } from "../types";
import { annualizedReturn, expectedReturnToValue, primaryValuationPerShare, scenarioOrderingPenalty } from "../helpers";

function valuationWithAccrualValues(re: number | null, reoi: number | null): ValuationResult {
  return {
    perShare: {
      intrinsic_re_per_share: re,
      intrinsic_reoi_per_share: reoi,
    },
  } as ValuationResult;
}

/**
 * The scenario headline (the "industrial.scenario-headline" catalog model) is
 * the RE/ReOI median. The owner-earnings and cash-flow DCFs are cross-checks
 * reported beside it, not blended in (AFES round-one, eec49c26) — so the
 * function takes no owner-earnings argument at all.
 */
describe("primaryValuationPerShare", () => {
  it("is the median of the RE and ReOI per-share values", () => {
    expect(primaryValuationPerShare(valuationWithAccrualValues(80, 120))).toBe(100);
  });

  it("uses the one available accrual value", () => {
    expect(primaryValuationPerShare(valuationWithAccrualValues(90, null))).toBe(90);
    expect(primaryValuationPerShare(valuationWithAccrualValues(null, 110))).toBe(110);
  });

  it("is null when neither accrual value exists, rather than borrowing another family's", () => {
    expect(primaryValuationPerShare(valuationWithAccrualValues(null, null))).toBeNull();
  });

  it("takes only the valuation — no owner-earnings value can enter the headline", () => {
    expect(primaryValuationPerShare.length).toBe(1);
  });
});

/**
 * "Expected CAGR" was the rerating alone: a stock priced at value read 0%,
 * though the model's own value accrues at ke. The return now counts both.
 */
describe("expectedReturnToValue", () => {
  it("earns the cost of equity at a price equal to value", () => {
    expect(expectedReturnToValue(100, 100, 0.11)).toBeCloseTo(0.11, 12);
  });

  it("adds the rerating to the accrual over the horizon", () => {
    // 0.729 = 0.9³: the rerating is −10% a year, the accrual +10%.
    expect(expectedReturnToValue(1000, 729, 0.1)).toBeCloseTo(1.1 * 0.9 - 1, 12);
    expect(annualizedReturn(1000, 729)).toBeCloseTo(-0.1, 12);
  });

  it("has no return without a positive price and value", () => {
    expect(expectedReturnToValue(null, 100, 0.1)).toBeNull();
    expect(expectedReturnToValue(100, -5, 0.1)).toBeNull();
  });
});

describe("scenarioOrderingPenalty", () => {
  const card = (key: string, intrinsicPerShare: number, ke: number) =>
    ({ key, intrinsicPerShare, expectedCagr: expectedReturnToValue(100, intrinsicPerShare, ke), assumptions: { ke } }) as unknown as ValuationScenarioCard;

  it("does not read a stress case discounted at a higher ke as out of order", () => {
    // Stress sits correctly below base, but its higher ke gives it the higher
    // expected return (1.13 × 0.98^⅓ > 1.11): no ordering fault.
    const stress = card("stress", 98, 0.13);
    const base = card("base", 100, 0.11);
    expect(stress.expectedCagr!).toBeGreaterThan(base.expectedCagr!);
    expect(scenarioOrderingPenalty({ stress, base, panic: card("historical-panic", 90, 0.14), marketPrice: 100 })).toBe(0);
  });

  it("still penalises a stress value above the base value, on both counts", () => {
    expect(scenarioOrderingPenalty({ stress: card("stress", 105, 0.13), base: card("base", 100, 0.11), panic: card("historical-panic", 90, 0.14), marketPrice: 100 })).toBe(15);
  });
});
