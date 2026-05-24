import { describe, it, expect } from "vitest";
import { computePenmanExpectedReturn } from "../penmanExpectedReturn";
import type { RecastPeriod } from "../types";

function buildRecastForPER(rnoa: number, noaSeries: number[], cse: number, nfo: number): RecastPeriod[] {
  return noaSeries.map((noa, i) => ({
    period_end: `${2020 + i}0331`,
    ratios: { RNOA: rnoa, PM: null, ATO: null, ROCE: null, NBC: null, SPREAD: null, FLEV: null, ROE: null, accrual_ratio_bs: null, accrual_ratio_cf: null },
    bs: { NOA: noa, NFO: nfo, CSE: cse, OA_Cash: 0, OA_Receivables: 0, OA_Inventory: 0, OA_OtherCurrentAssets: 0, OA_PPE: 0, OA_Intangibles: 0, OA_OtherNonCurrentAssets: 0, OL_Payables: 0, OL_OtherCurrentLiabilities: 0, OL_OtherNonCurrentLiabilities: 0, DTL: 0, PensionObl: 0, OL_ex_DTL: 0, FA_Cash: 0, FA_ShortTermInvestments: 0, FA_LongTermInvestments: 0, FL_ShortTermDebt: 0, FL_LongTermDebt: 0, FL_OtherFinancialLiabilities: 0, MinorityInterest: 0 },
    ri: { ReOI: 0, ReOI_growth: null, ReOI_margin: null, capitalCharge: 0 },
  } as unknown as RecastPeriod));
}

describe("penmanExpectedReturn", () => {
  it("computes expected return for a high-RNOA stock at low P/B", () => {
    // RNOA=25%, NOA growing ~10%, CSE=50000cr, shares=100cr → BV/share=500
    // Market price=400 → P/B=0.8 → should be attractive
    const data = buildRecastForPER(0.25, [8000, 8800, 9700, 10670, 11700], 50000, 5000);
    const result = computePenmanExpectedReturn(data, 0.13, 0.65, 400, 100);

    expect(result).not.toBeNull();
    expect(result!.expectedReturn).toBeGreaterThan(0.15); // above hurdle
    expect(result!.verdict).toBe("attractive");
    expect(result!.pricePaid).toBeCloseTo(0.8, 1);
  });

  it("flags expensive when price far exceeds intrinsic", () => {
    // RNOA=12% (below cost of capital 13%), P/B=3.0 → clearly expensive
    const data = buildRecastForPER(0.12, [10000, 10500, 11000, 11500, 12000], 20000, 2000);
    const result = computePenmanExpectedReturn(data, 0.13, 0.50, 3000, 20);

    expect(result).not.toBeNull();
    expect(result!.expectedReturn).toBeLessThan(0.12);
    expect(result!.verdict).toBe("expensive");
  });

  it("computes valuation layers (EPV and growth premium)", () => {
    const data = buildRecastForPER(0.20, [10000, 11000, 12100, 13300, 14600], 40000, 3000);
    const result = computePenmanExpectedReturn(data, 0.13, 0.60, 600, 80);

    expect(result).not.toBeNull();
    expect(result!.valuationLayers.epvPerShare).toBeGreaterThan(0);
    // Growth premium = market price - EPV
    expect(result!.valuationLayers.growthPremium).toBeCloseTo(
      result!.pricePerShare - result!.valuationLayers.epvPerShare, 0
    );
  });

  it("provides required-for-hurdle guidance", () => {
    const data = buildRecastForPER(0.22, [10000, 11000, 12100, 13300, 14600], 40000, 3000);
    const result = computePenmanExpectedReturn(data, 0.13, 0.60, 600, 80);

    expect(result).not.toBeNull();
    // maxPB tells you: at current RNOA/ω/g, max P/B for 15% return
    expect(result!.requiredForHurdle.maxPB).toBeGreaterThan(0);
    // minRNOA tells you: at current P/B, min RNOA for 15% return
    expect(result!.requiredForHurdle.minRNOA).toBeGreaterThan(0);
  });

  it("generates a narrative", () => {
    const data = buildRecastForPER(0.20, [10000, 11000, 12100, 13300, 14600], 40000, 3000);
    const result = computePenmanExpectedReturn(data, 0.13, 0.60, 600, 80);

    expect(result).not.toBeNull();
    expect(result!.narrative.length).toBeGreaterThan(50);
    expect(result!.narrative).toContain("RNOA");
  });

  it("returns null for insufficient data", () => {
    const data = buildRecastForPER(0.20, [10000, 11000], 40000, 3000);
    const result = computePenmanExpectedReturn(data, 0.13, 0.60, 600, 80);
    // Only 2 periods — less than minimum 3
    expect(result).toBeNull();
  });

  it("handles zero market price gracefully", () => {
    const data = buildRecastForPER(0.20, [10000, 11000, 12000, 13000], 40000, 3000);
    expect(computePenmanExpectedReturn(data, 0.13, 0.60, 0, 80)).toBeNull();
  });

  it("returns null when latest period RNOA is NaN (under-specified config cascade)", () => {
    // Reproduces the audit finding: under-specified EngineConfig cascades NaN
    // from OI/NFE through RNOA. Engine must fail closed, not return NaN values.
    const data = buildRecastForPER(NaN, [10000, 11000, 12000, 13000], 40000, 3000);
    expect(computePenmanExpectedReturn(data, 0.13, 0.60, 600, 80)).toBeNull();
  });

  it("returns null when CSE is NaN", () => {
    const data = buildRecastForPER(0.20, [10000, 11000, 12000, 13000], NaN, 3000);
    expect(computePenmanExpectedReturn(data, 0.13, 0.60, 600, 80)).toBeNull();
  });

  it("returns null when costOfCapital or omega is non-finite", () => {
    const data = buildRecastForPER(0.20, [10000, 11000, 12000, 13000], 40000, 3000);
    expect(computePenmanExpectedReturn(data, NaN, 0.60, 600, 80)).toBeNull();
    expect(computePenmanExpectedReturn(data, 0.13, NaN, 600, 80)).toBeNull();
    expect(computePenmanExpectedReturn(data, Infinity, 0.60, 600, 80)).toBeNull();
  });
});
