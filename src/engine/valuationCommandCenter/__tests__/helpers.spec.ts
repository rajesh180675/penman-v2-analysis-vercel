import { describe, expect, it } from "vitest";
import type { ValuationResult } from "../../types";
import { primaryValuationPerShare } from "../helpers";

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
