import { describe, expect, it } from "vitest";
import type { RawPeriodData } from "../types";
import { MIN_ADVANCED_VALUATION_PERIODS, selectPrimaryValuationData } from "../valuationDataPolicy";

function periods(count: number, label: string): RawPeriodData[] {
  return Array.from({ length: count }, (_, i) => ({
    company_id: label,
    period_end: `${2020 + i}-03-31`,
    statement: {},
  })) as unknown as RawPeriodData[];
}

describe("selectPrimaryValuationData", () => {
  it("uses standalone as explicit fallback when consolidated has too few periods", () => {
    const consolidated = periods(2, "CONS");
    const standalone = periods(14, "STAN");

    const result = selectPrimaryValuationData(consolidated, standalone);

    expect(result?.primaryScope).toBe("standalone");
    expect(result?.primaryData).toBe(standalone);
    expect(result?.usedStandaloneFallback).toBe(true);
    expect(result?.consolidatedPeriodCount).toBe(2);
    expect(result?.standalonePeriodCount).toBe(14);
    expect(result?.minRequiredPeriods).toBe(MIN_ADVANCED_VALUATION_PERIODS);
    expect(result?.reason).toContain("Consolidated history has only 2 periods");
  });

  it("keeps consolidated primary when consolidated has enough periods", () => {
    const consolidated = periods(4, "CONS");
    const standalone = periods(14, "STAN");

    const result = selectPrimaryValuationData(consolidated, standalone);

    expect(result?.primaryScope).toBe("consolidated");
    expect(result?.primaryData).toBe(consolidated);
    expect(result?.usedStandaloneFallback).toBe(false);
    expect(result?.reason).toBeNull();
  });

  it("does not fallback when standalone is also insufficient", () => {
    const consolidated = periods(2, "CONS");
    const standalone = periods(2, "STAN");

    const result = selectPrimaryValuationData(consolidated, standalone);

    expect(result?.primaryScope).toBe("consolidated");
    expect(result?.primaryData).toBe(consolidated);
    expect(result?.usedStandaloneFallback).toBe(false);
  });

  it("returns null when no consolidated data is loaded", () => {
    expect(selectPrimaryValuationData(null, periods(14, "STAN"))).toBeNull();
    expect(selectPrimaryValuationData([], periods(14, "STAN"))).toBeNull();
  });
});
