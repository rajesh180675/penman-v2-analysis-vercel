import { describe, expect, it } from "vitest";
import {
  deriveSegmentUncertainties,
  SegmentUncertainty,
  normalizeMonteCarloRequest,
} from "../monteCarloTypes";
import { SegmentData } from "../segmentParser";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSegmentData(
  segments: string[],
  years: string[],
  ebitMatrix: Record<string, Record<string, number | null>>
): SegmentData {
  const data: SegmentData["data"] = {};
  for (const seg of segments) {
    data[seg] = {};
    for (const yr of years) {
      data[seg][yr] = {
        revenue: null,
        interSegmentRevenue: null,
        result: ebitMatrix[seg]?.[yr] ?? null,
        assets: null,
        liabilities: null,
        capex: null,
        depreciation: null,
        nonCashExpenditure: null,
      };
    }
  }
  return {
    segmentationType: "business",
    segments,
    years,
    data,
    unallocated: {},
    totals: {},
  };
}

// ─── Tests: deriveSegmentUncertainties ────────────────────────────────────────

describe("deriveSegmentUncertainties", () => {
  it("returns empty array for empty segment data", () => {
    const sd = makeSegmentData([], [], {});
    expect(deriveSegmentUncertainties(sd)).toEqual([]);
  });

  it("returns empty array when no years", () => {
    const sd = makeSegmentData(["A", "B"], [], {});
    expect(deriveSegmentUncertainties(sd)).toEqual([]);
  });

  it("returns empty array when only 1 year (need ≥2 observations)", () => {
    const sd = makeSegmentData(["A", "B"], ["FY2024"], {
      A: { FY2024: 100 },
      B: { FY2024: 50 },
    });
    expect(deriveSegmentUncertainties(sd)).toEqual([]);
  });

  it("computes correct mean shares for 2 segments over 3 years", () => {
    // A always 60%, B always 40%
    const sd = makeSegmentData(["A", "B"], ["FY2022", "FY2023", "FY2024"], {
      A: { FY2022: 60, FY2023: 60, FY2024: 60 },
      B: { FY2022: 40, FY2023: 40, FY2024: 40 },
    });
    const result = deriveSegmentUncertainties(sd);
    expect(result).toHaveLength(2);

    const a = result.find(r => r.name === "A")!;
    const b = result.find(r => r.name === "B")!;

    expect(a.meanShare.mean).toBeCloseTo(0.6, 5);
    expect(b.meanShare.mean).toBeCloseTo(0.4, 5);
    // Constant shares → std = 0
    expect(a.meanShare.std).toBeCloseTo(0, 5);
    expect(b.meanShare.std).toBeCloseTo(0, 5);
  });

  it("computes non-zero std when shares vary", () => {
    // A: 70%, 50%, 60% → mean=60%, std>0
    const sd = makeSegmentData(["A", "B"], ["FY2022", "FY2023", "FY2024"], {
      A: { FY2022: 70, FY2023: 50, FY2024: 60 },
      B: { FY2022: 30, FY2023: 50, FY2024: 40 },
    });
    const result = deriveSegmentUncertainties(sd);
    const a = result.find(r => r.name === "A")!;
    expect(a.meanShare.mean).toBeCloseTo(0.6, 5);
    expect(a.meanShare.std).toBeGreaterThan(0);
  });

  it("shares sum to 1 in each year (mean shares sum to ~1)", () => {
    const sd = makeSegmentData(
      ["A", "B", "C"],
      ["FY2021", "FY2022", "FY2023", "FY2024"],
      {
        A: { FY2021: 50, FY2022: 60, FY2023: 55, FY2024: 65 },
        B: { FY2021: 30, FY2022: 25, FY2023: 28, FY2024: 20 },
        C: { FY2021: 20, FY2022: 15, FY2023: 17, FY2024: 15 },
      }
    );
    const result = deriveSegmentUncertainties(sd);
    const totalMean = result.reduce((s, r) => s + r.meanShare.mean, 0);
    expect(totalMean).toBeCloseTo(1.0, 4);
  });

  it("excludes segments with null EBIT from year calculation", () => {
    // B has null in FY2022 — that year B is excluded from share calc
    const sd = makeSegmentData(["A", "B"], ["FY2022", "FY2023", "FY2024"], {
      A: { FY2022: 100, FY2023: 60, FY2024: 60 },
      B: { FY2022: null, FY2023: 40, FY2024: 40 },
    });
    const result = deriveSegmentUncertainties(sd);
    // B only has 2 observations (FY2023, FY2024) — still qualifies
    const b = result.find(r => r.name === "B");
    expect(b).toBeDefined();
    expect(b!.meanShare.mean).toBeCloseTo(0.4, 4);
  });

  it("excludes segments with zero or negative EBIT", () => {
    const sd = makeSegmentData(["A", "B"], ["FY2022", "FY2023", "FY2024"], {
      A: { FY2022: 100, FY2023: 100, FY2024: 100 },
      B: { FY2022: -10, FY2023: 0, FY2024: -5 },
    });
    const result = deriveSegmentUncertainties(sd);
    // B has no positive EBIT → excluded
    expect(result.find(r => r.name === "B")).toBeUndefined();
    // A gets 100% share in all years
    const a = result.find(r => r.name === "A")!;
    expect(a.meanShare.mean).toBeCloseTo(1.0, 5);
  });

  it("returns one entry per qualifying segment", () => {
    const sd = makeSegmentData(
      ["Cigarettes", "FMCG-Others", "Hotels", "Agri", "Paperboards"],
      ["FY2020", "FY2021", "FY2022", "FY2023", "FY2024"],
      {
        Cigarettes:    { FY2020: 1200, FY2021: 1300, FY2022: 1400, FY2023: 1500, FY2024: 1600 },
        "FMCG-Others": { FY2020: 200,  FY2021: 220,  FY2022: 240,  FY2023: 260,  FY2024: 280  },
        Hotels:        { FY2020: 50,   FY2021: 60,   FY2022: 70,   FY2023: 80,   FY2024: 90   },
        Agri:          { FY2020: 150,  FY2021: 160,  FY2022: 170,  FY2023: 180,  FY2024: 190  },
        Paperboards:   { FY2020: 100,  FY2021: 110,  FY2022: 120,  FY2023: 130,  FY2024: 140  },
      }
    );
    const result = deriveSegmentUncertainties(sd);
    expect(result).toHaveLength(5);
    const names = result.map(r => r.name);
    expect(names).toContain("Cigarettes");
    expect(names).toContain("FMCG-Others");
  });

  it("dominant segment has highest mean share", () => {
    const sd = makeSegmentData(
      ["Cigarettes", "FMCG-Others", "Hotels"],
      ["FY2020", "FY2021", "FY2022", "FY2023"],
      {
        Cigarettes:    { FY2020: 1200, FY2021: 1300, FY2022: 1400, FY2023: 1500 },
        "FMCG-Others": { FY2020: 200,  FY2021: 220,  FY2022: 240,  FY2023: 260  },
        Hotels:        { FY2020: 50,   FY2021: 60,   FY2022: 70,   FY2023: 80   },
      }
    );
    const result = deriveSegmentUncertainties(sd);
    const sorted = [...result].sort((a, b) => b.meanShare.mean - a.meanShare.mean);
    expect(sorted[0].name).toBe("Cigarettes");
  });

  it("std is non-negative for all segments", () => {
    const sd = makeSegmentData(
      ["A", "B", "C"],
      ["FY2020", "FY2021", "FY2022", "FY2023", "FY2024"],
      {
        A: { FY2020: 100, FY2021: 120, FY2022: 90, FY2023: 110, FY2024: 130 },
        B: { FY2020: 80,  FY2021: 70,  FY2022: 85, FY2023: 75,  FY2024: 80  },
        C: { FY2020: 20,  FY2021: 30,  FY2022: 25, FY2023: 35,  FY2024: 40  },
      }
    );
    const result = deriveSegmentUncertainties(sd);
    for (const r of result) {
      expect(r.meanShare.std).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── Tests: normalizeMonteCarloRequest with segment fields ────────────────────

describe("normalizeMonteCarloRequest with segment fields", () => {
  const baseReq = {
    basePeriods: [{ period_end: "2024-03-31" } as never],
    config: {} as never,
    paramDistributions: {
      ke: { mean: 0.12, std: 0.01 },
      kw: { mean: 0.10, std: 0.01 },
      g:  { mean: 0.05, std: 0.005 },
    },
  };

  it("passes through segmentDefinitions and segmentUncertainties", () => {
    const segDefs = [{ name: "A", operatingProfitShare: 0.6, sectorTemplate: "consumer-staples" as never }];
    const segUnc: SegmentUncertainty[] = [{ name: "A", meanShare: { mean: 0.6, std: 0.05 } }];
    const result = normalizeMonteCarloRequest({
      ...baseReq,
      segmentDefinitions: segDefs,
      segmentUncertainties: segUnc,
    });
    expect(result.segmentDefinitions).toEqual(segDefs);
    expect(result.segmentUncertainties).toEqual(segUnc);
  });

  it("segment fields are undefined when not provided", () => {
    const result = normalizeMonteCarloRequest(baseReq);
    expect(result.segmentDefinitions).toBeUndefined();
    expect(result.segmentUncertainties).toBeUndefined();
  });

  it("applies default N and horizonT", () => {
    const result = normalizeMonteCarloRequest(baseReq);
    expect(result.N).toBe(10000);
    expect(result.horizonT).toBe(5);
  });
});
