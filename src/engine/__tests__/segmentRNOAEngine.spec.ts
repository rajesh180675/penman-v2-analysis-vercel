import { describe, it, expect } from "vitest";
import { decomposeSegmentRNOA } from "../segmentRNOAEngine";
import type { SegmentData } from "../segmentParser";

function buildSegmentData(segments: string[], yearData: Record<string, Record<string, { revenue: number; result: number; assets: number; liabilities: number; capex: number; depreciation: number }>>): SegmentData {
  // Sort years descending (newest first) — matches Capitaline convention
  const years = Object.keys(yearData).sort((a, b) => b.localeCompare(a));
  const data: SegmentData["data"] = {};
  for (const seg of segments) {
    data[seg] = {};
    for (const yr of years) {
      const d = yearData[yr]?.[seg] || { revenue: 0, result: 0, assets: 0, liabilities: 0, capex: 0, depreciation: 0 };
      data[seg][yr] = { ...d, interSegmentRevenue: null, nonCashExpenditure: null };
    }
  }
  return { segmentationType: "business", segments, years, data, unallocated: {}, totals: {} };
}

describe("segmentRNOAEngine", () => {
  const segments = ["IT SERVICES", "INFRASTRUCTURE", "FINANCIAL SERVICES"];

  const yearData: Record<string, Record<string, { revenue: number; result: number; assets: number; liabilities: number; capex: number; depreciation: number }>> = {
    "202503": {
      "IT SERVICES": { revenue: 48000, result: 9600, assets: 20000, liabilities: 5000, capex: 3000, depreciation: 2000 },
      "INFRASTRUCTURE": { revenue: 130000, result: 13000, assets: 80000, liabilities: 20000, capex: 12000, depreciation: 8000 },
      "FINANCIAL SERVICES": { revenue: 15000, result: 6000, assets: 60000, liabilities: 45000, capex: 500, depreciation: 400 },
    },
    "202403": {
      "IT SERVICES": { revenue: 40000, result: 8000, assets: 17000, liabilities: 4000, capex: 2500, depreciation: 1800 },
      "INFRASTRUCTURE": { revenue: 115000, result: 11500, assets: 72000, liabilities: 18000, capex: 10000, depreciation: 7500 },
      "FINANCIAL SERVICES": { revenue: 12000, result: 4800, assets: 50000, liabilities: 38000, capex: 400, depreciation: 350 },
    },
    "202303": {
      "IT SERVICES": { revenue: 35000, result: 7000, assets: 15000, liabilities: 3500, capex: 2200, depreciation: 1600 },
      "INFRASTRUCTURE": { revenue: 100000, result: 10000, assets: 65000, liabilities: 16000, capex: 9000, depreciation: 7000 },
      "FINANCIAL SERVICES": { revenue: 10000, result: 4000, assets: 42000, liabilities: 32000, capex: 350, depreciation: 300 },
    },
  };

  it("decomposes RNOA into OPM × ATO per segment", () => {
    const sd = buildSegmentData(segments, yearData);
    const result = decomposeSegmentRNOA(sd, 0.13);

    expect(result).not.toBeNull();
    const it_seg = result!.segments.find(s => s.name === "IT SERVICES")!;
    const infra = result!.segments.find(s => s.name === "INFRASTRUCTURE")!;

    expect(it_seg).toBeDefined();
    expect(infra).toBeDefined();

    // IT: netAssets = 20000 - 5000 = 15000
    // OPM = 9600/48000 = 0.20
    // ATO = 48000/15000 = 3.2
    // RNOA = 9600/15000 = 0.64
    expect(it_seg.opm).toBeCloseTo(0.20, 2);
    expect(it_seg.ato).toBeCloseTo(48000 / 15000, 1);
    expect(it_seg.rnoa).toBeCloseTo(9600 / 15000, 2);

    // INFRA: netAssets = 80000 - 20000 = 60000
    // OPM = 13000/130000 = 0.10
    // ATO = 130000/60000 ≈ 2.17
    // RNOA = 13000/60000 ≈ 0.217
    expect(infra.opm).toBeCloseTo(0.10, 2);
    expect(infra.ato).toBeCloseTo(130000 / 60000, 1);
    expect(infra.rnoa).toBeCloseTo(13000 / 60000, 2);
  });

  it("classifies quadrants correctly", () => {
    const sd = buildSegmentData(segments, yearData);
    const result = decomposeSegmentRNOA(sd, 0.13)!;

    const it_seg = result.segments.find(s => s.name === "IT SERVICES")!;
    const infra = result.segments.find(s => s.name === "INFRASTRUCTURE")!;

    // IT: high OPM (0.20 > 0.15), high ATO (3.2 > 1.5) → star
    expect(it_seg.quadrant).toBe("star");
    // INFRA: low OPM (0.10 < 0.15), high ATO (2.17 > 1.5) → volume_play
    expect(infra.quadrant).toBe("volume_play");
  });

  it("computes residual income per segment", () => {
    const sd = buildSegmentData(segments, yearData);
    const result = decomposeSegmentRNOA(sd, 0.13)!;

    const it_seg = result.segments.find(s => s.name === "IT SERVICES")!;
    // ReOI = result × (1-tax) - r × netAssets = 9600 × 0.75 - 0.13 × 15000 = 7200 - 1950 = 5250
    const expectedReoi = 9600 * 0.75 - 0.13 * 15000;
    expect(it_seg.reoi).toBeCloseTo(expectedReoi, 0);
  });

  it("identifies value-creating and value-destroying segments", () => {
    const sd = buildSegmentData(segments, yearData);
    const result = decomposeSegmentRNOA(sd, 0.13)!;

    // All segments should have positive ReOI at 13% cost of capital given these returns
    expect(result.valueCreation.valueCreatingSegments.length).toBeGreaterThan(0);
    expect(result.valueCreation.netEconomicProfit).toBeGreaterThan(0);
  });

  it("computes firm-level aggregates", () => {
    const sd = buildSegmentData(segments, yearData);
    const result = decomposeSegmentRNOA(sd, 0.13)!;

    const totalRev = 48000 + 130000 + 15000;
    const totalRes = 9600 + 13000 + 6000;
    const totalNA = (20000 - 5000) + (80000 - 20000) + (60000 - 45000);

    expect(result.firmLevel.totalRevenue).toBe(totalRev);
    expect(result.firmLevel.totalResult).toBe(totalRes);
    expect(result.firmLevel.totalNetAssets).toBe(totalNA);
    expect(result.firmLevel.rnoa).toBeCloseTo(totalRes / totalNA, 3);
  });

  it("classifies lifecycle stages based on revenue growth and reinvestment", () => {
    const sd = buildSegmentData(segments, yearData);
    const result = decomposeSegmentRNOA(sd, 0.13)!;

    // Each segment's lifecycle depends on 3Y CAGR and reinvestment rate
    // IT: rev CAGR = (48000/35000)^(1/3)-1 ≈ 11.1%, reinvest=3000/2000=1.5
    // 11.1% < 15% threshold → not growth, positive result → mature
    const it_seg = result.segments.find(s => s.name === "IT SERVICES")!;
    expect(["growth", "mature"]).toContain(it_seg.lifecycle);
  });

  it("returns null for empty segment data", () => {
    const sd: SegmentData = { segmentationType: "business", segments: [], years: [], data: {}, unallocated: {}, totals: {} };
    expect(decomposeSegmentRNOA(sd, 0.13)).toBeNull();
  });
});
