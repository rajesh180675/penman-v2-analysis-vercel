import { describe, expect, it } from "vitest";
import type { ValuationResult } from "../../types";
import type { ValuationScenarioCard } from "../types";
import { annualizedReturn, carryValueToPriceDate, expectedReturnToValue, forecastDividendsPerShare, primaryValuationPerShare, resolveShareCountChange, scenarioOrderingPenalty, valueOnPriceBasis, yearsBetween } from "../helpers";
import type { ForecastPeriod } from "../../types";

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

describe("carrying a value to the price's date", () => {
  it("accrues at ke within a year, and pays each year's distributions at its end", () => {
    expect(carryValueToPriceDate(100, 0.1, 0.5, [8])).toBeCloseTo(100 * Math.sqrt(1.1), 12);
    // 1.5 years: a year's accrual less its distribution, then half a year more.
    expect(carryValueToPriceDate(100, 0.1, 1.5, [8, 9])).toBeCloseTo((110 - 8) * Math.sqrt(1.1), 12);
    expect(carryValueToPriceDate(100, 0.1, 0, [8])).toBe(100);
    expect(carryValueToPriceDate(null, 0.1, 1, [8])).toBeNull();
  });

  it("takes off only what is paid out, and never goes below zero", () => {
    // A year that raises equity (a negative distribution) is shares issued: at a
    // fair price no gain to a share already held, so nothing is added back.
    expect(carryValueToPriceDate(100, 0.1, 1, [-30])).toBeCloseTo(110, 12);
    // NTPC's stress case, −₹1.95 a share, raising ₹18.63 a share: still worth nothing.
    expect(carryValueToPriceDate(-1.95, 0.1344, 1.54, [-18.63, 4.69])).toBe(0);
    expect(carryValueToPriceDate(-5, 0.1, 0, [])).toBe(0);
  });

  it("reads distributions by clean surplus, per share", () => {
    const year = (CNI_f: number, CSE_f: number) => ({ CNI_f, CSE_f }) as unknown as ForecastPeriod;
    // 1,000 opening equity; earns 150 and closes at 1,100: 50 paid out, then 60.
    expect(forecastDividendsPerShare([year(150, 1100), year(160, 1200)], 1000, 10)).toEqual([5, 6]);
    expect(forecastDividendsPerShare([year(150, 1100)], 1000, null)).toEqual([]);
  });

  it("counts years from the anchor to the price's date, never back", () => {
    expect(yearsBetween("2025-03-31", "2026-10-13")).toBeCloseTo(561 / 365.25, 12);
    expect(yearsBetween("2026-03-31", "2025-03-31")).toBe(0);
  });
});

describe("setting a value on the price's basis", () => {
  it("reads the change in share count from the quote's absolute count against the anchor's crore", () => {
    // Nestlé's 1:1 bonus of 2025: 96.42 crore at the anchor, 192.83 filed since.
    expect(resolveShareCountChange(192.83 * 1e7, 96.42)).toBeCloseTo(192.83 / 96.42, 12);
    // Kotak's ×5 and the bounds: a count outside 0.05–50× is not one of the same shares.
    expect(resolveShareCountChange(994.65 * 1e7, 198.82)).toBeCloseTo(5.0028, 4);
    expect(resolveShareCountChange(51 * 1e7, 1)).toBeNull();
    expect(resolveShareCountChange(0.04 * 1e7, 1)).toBeNull();
    expect(resolveShareCountChange(null, 96.42)).toBeNull();
    expect(resolveShareCountChange(192.83 * 1e7, null)).toBeNull();
  });

  const cc = (marketPrice: number | null, yearsToPriceDate: number, shareCountChange: number | null) => ({
    marketPrice,
    marketContext: { yearsToPriceDate, shareCountChange },
    scenarios: [{ key: "base", assumptions: { ke: 0.1 }, dividendsPerShare: [8, 9] }],
  });

  it("carries a value on the base case's ke and payouts, and spreads it over today's count", () => {
    expect(valueOnPriceBasis(cc(500, 1.5, 2), 100)).toBeCloseTo(((110 - 8) * Math.sqrt(1.1)) / 2, 12);
    expect(valueOnPriceBasis(cc(500, 0, 2), 100)).toBe(50);
    expect(valueOnPriceBasis(cc(500, 1.5, null), 100)).toBeCloseTo((110 - 8) * Math.sqrt(1.1), 12);
  });

  it("leaves a value unpriced as it is, and a missing value missing", () => {
    expect(valueOnPriceBasis(cc(null, 1.5, 2), 100)).toBe(100);
    expect(valueOnPriceBasis(cc(500, 1.5, 2), null)).toBeNull();
  });
});
