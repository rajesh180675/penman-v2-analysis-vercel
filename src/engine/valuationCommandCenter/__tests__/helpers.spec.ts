import { describe, expect, it } from "vitest";
import type { ValuationResult } from "../../types";
import { computeScenarioIntrinsicPerShare } from "../helpers";

function valuationWithAccrualValues(re: number | null, reoi: number | null): ValuationResult {
  return {
    perShare: {
      intrinsic_re_per_share: re,
      intrinsic_reoi_per_share: reoi,
    },
  } as ValuationResult;
}

describe("computeScenarioIntrinsicPerShare", () => {
  it("collapses correlated RE/ReOI values before combining independent evidence", () => {
    const value = computeScenarioIntrinsicPerShare(
      valuationWithAccrualValues(80, 120),
      300,
    );

    // Accrual family center = 100; equal family vote with owner DCF = 200.
    // A flat median of [80, 120, 300] would incorrectly return 120.
    expect(value).toBe(200);
  });

  it("does not change the accrual family's vote when RE/ReOI disperse symmetrically", () => {
    const agreed = computeScenarioIntrinsicPerShare(
      valuationWithAccrualValues(100, 100),
      300,
    );
    const dispersed = computeScenarioIntrinsicPerShare(
      valuationWithAccrualValues(60, 140),
      300,
    );

    expect(agreed).toBe(200);
    expect(dispersed).toBe(agreed);
  });

  it("uses the available family without manufacturing a second vote", () => {
    expect(computeScenarioIntrinsicPerShare(valuationWithAccrualValues(90, 110), null)).toBe(100);
    expect(computeScenarioIntrinsicPerShare(valuationWithAccrualValues(null, null), 250)).toBe(250);
  });
});
