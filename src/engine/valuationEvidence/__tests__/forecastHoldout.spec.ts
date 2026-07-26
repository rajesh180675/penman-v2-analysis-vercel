import { describe, expect, it } from "vitest";
import { evaluateForecastHoldout } from "../forecastHoldout";
import type { RecastPeriod } from "../../types";

function period(year: number, values: {
  sales: number;
  margin: number;
  rnoa: number;
  cfo: number;
  capex: number;
  fcf: number;
  cse: number;
  noa: number;
}): RecastPeriod {
  return {
    period_end: `${year}-03-31`,
    is: { Sales: values.sales, OI: values.sales * values.margin },
    ratios: { RNOA: values.rnoa, CoreSalesPM: values.margin },
    cf: { CFO: values.cfo, Capex: values.capex, FCF_cash: values.fcf },
    bs: { CSE: values.cse, NOA: values.noa },
  } as unknown as RecastPeriod;
}

describe("evaluateForecastHoldout", () => {
  it("confirms forecast skill for a smooth historical series", () => {
    const periods = [
      period(2019, { sales: 1000, margin: 0.10, rnoa: 0.15, cfo: 120, capex: 50, fcf: 70, cse: 500, noa: 650 }),
      period(2020, { sales: 1100, margin: 0.10, rnoa: 0.15, cfo: 132, capex: 55, fcf: 77, cse: 550, noa: 715 }),
      period(2021, { sales: 1210, margin: 0.10, rnoa: 0.15, cfo: 145.2, capex: 60.5, fcf: 84.7, cse: 605, noa: 786.5 }),
      period(2022, { sales: 1331, margin: 0.10, rnoa: 0.15, cfo: 159.72, capex: 66.55, fcf: 93.17, cse: 665.5, noa: 865.15 }),
      period(2023, { sales: 1464.1, margin: 0.10, rnoa: 0.15, cfo: 175.69, capex: 73.21, fcf: 102.49, cse: 732.05, noa: 951.67 }),
      period(2024, { sales: 1610.51, margin: 0.10, rnoa: 0.15, cfo: 193.26, capex: 80.53, fcf: 112.74, cse: 805.26, noa: 1046.84 }),
    ];

    const result = evaluateForecastHoldout(periods);

    expect(result.available).toBe(true);
    expect(result.aggregate.status).toBe("confirmed");
    expect(result.aggregate.weightedMape).not.toBeNull();
    expect(result.aggregate.weightedMape!).toBeLessThan(0.05);
    expect(result.aggregate.valuationRangeWideningPct).toBeLessThanOrEqual(0.05);
    expect(result.aggregate.sampleSize).toBe(2);
    // Was `confirmed` unconditionally. Ordering discipline is still confirmed by
    // construction, but with no vintage index the *values* are as-restated-today,
    // so the out-of-sample claim is not established.
    expect(result.aggregate.noLookAhead?.status).toBe("unverified");
    expect(result.aggregate.noLookAhead?.orderingDiscipline).toBe("confirmed");
    expect(result.aggregate.noLookAhead?.vintageDiscipline).toBe("unverified");
    expect(result.aggregate.benchmark?.name).toBe("last-observation-carried-forward");
    expect(result.aggregate.benchmark?.skillVsBenchmark).toBeGreaterThan(0);
    expect(result.aggregate.calibrationStatus).toBe("degraded");
  });

  it("fails forecast skill and widens valuation range when known outcomes diverge", () => {
    const periods = [
      period(2018, { sales: 1000, margin: 0.12, rnoa: 0.18, cfo: 140, capex: 45, fcf: 95, cse: 500, noa: 650 }),
      period(2019, { sales: 1100, margin: 0.12, rnoa: 0.18, cfo: 154, capex: 50, fcf: 104, cse: 550, noa: 715 }),
      period(2020, { sales: 1210, margin: 0.12, rnoa: 0.18, cfo: 170, capex: 55, fcf: 115, cse: 605, noa: 786 }),
      period(2021, { sales: 1331, margin: 0.12, rnoa: 0.18, cfo: 187, capex: 61, fcf: 126, cse: 666, noa: 865 }),
      // Known holdout breaks the prior economics.
      period(2022, { sales: 1100, margin: 0.04, rnoa: 0.05, cfo: 60, capex: 240, fcf: -180, cse: 610, noa: 980 }),
      period(2023, { sales: 1025, margin: 0.03, rnoa: 0.04, cfo: 45, capex: 260, fcf: -215, cse: 570, noa: 1040 }),
    ];

    const result = evaluateForecastHoldout(periods);

    expect(result.available).toBe(true);
    expect(result.aggregate.status).toBe("failed");
    expect(result.aggregate.weightedMape).toBeGreaterThan(0.30);
    expect(result.aggregate.valuationRangeWideningPct).toBeGreaterThanOrEqual(0.25);
  });

  describe("no-look-ahead disclosure", () => {
    const SMOOTH = [
      period(2019, { sales: 1000, margin: 0.10, rnoa: 0.15, cfo: 120, capex: 50, fcf: 70, cse: 500, noa: 650 }),
      period(2020, { sales: 1100, margin: 0.10, rnoa: 0.15, cfo: 132, capex: 55, fcf: 77, cse: 550, noa: 715 }),
      period(2021, { sales: 1210, margin: 0.10, rnoa: 0.15, cfo: 145.2, capex: 60.5, fcf: 84.7, cse: 605, noa: 786.5 }),
      period(2022, { sales: 1331, margin: 0.10, rnoa: 0.15, cfo: 159.72, capex: 66.55, fcf: 93.17, cse: 665.5, noa: 865.15 }),
      period(2023, { sales: 1464.1, margin: 0.10, rnoa: 0.15, cfo: 175.69, capex: 73.21, fcf: 102.49, cse: 732.05, noa: 951.67 }),
      period(2024, { sales: 1610.51, margin: 0.10, rnoa: 0.15, cfo: 193.26, capex: 80.53, fcf: 112.74, cse: 805.26, noa: 1046.84 }),
    ];

    /** Filed ~3 months after each March year-end, which is the normal Indian pattern. */
    function perFilingVintage(years: number[]) {
      return {
        kind: "per-filing" as const,
        periods: years.map((year) => ({
          periodEnd: `${year}-03-31`,
          filingAsOf: `${year}-06-30`,
          acquiredAt: `${year}-07-01T00:00:00.000Z`,
        })),
      };
    }

    it("confirms vintage discipline when every period carries its own filing date", () => {
      const result = evaluateForecastHoldout(SMOOTH, perFilingVintage([2019, 2020, 2021, 2022, 2023, 2024]));

      expect(result.aggregate.noLookAhead?.status).toBe("confirmed");
      expect(result.aggregate.noLookAhead?.vintageDiscipline).toBe("confirmed");
      expect(result.aggregate.noLookAhead?.policy).toBe("per-filing-vintage");
      expect(result.aggregate.noLookAhead?.reason).toBeUndefined();
    });

    it("refuses the claim for a single dated export however many periods it carries", () => {
      // The Capitaline case: 6 periods, one observation date. A figure restated
      // in 2024 for FY2019 is indistinguishable from what FY2019 actually filed.
      const result = evaluateForecastHoldout(SMOOTH, {
        kind: "single-export",
        periods: [2019, 2020, 2021, 2022, 2023, 2024].map((year) => ({
          periodEnd: `${year}-03-31`,
          filingAsOf: "2024-07-01",
          acquiredAt: "2024-07-01T00:00:00.000Z",
        })),
      });

      expect(result.aggregate.noLookAhead?.status).toBe("unverified");
      expect(result.aggregate.noLookAhead?.reason).toContain("single-export");
      // The error metrics are still informative — only the claim is withheld.
      expect(result.aggregate.status).toBe("confirmed");
      expect(result.aggregate.weightedMape).not.toBeNull();
    });

    it("refuses the claim when any participating period lacks a filing date", () => {
      const vintage = perFilingVintage([2019, 2020, 2021, 2022, 2023, 2024]);
      const result = evaluateForecastHoldout(SMOOTH, {
        kind: "per-filing",
        // 2019 is a train-only period — it still has to be vintage-stamped.
        periods: vintage.periods.map((entry) => (entry.periodEnd === "2019-03-31" ? { ...entry, filingAsOf: null } : entry)),
      });

      expect(result.aggregate.noLookAhead?.status).toBe("unverified");
      expect(result.aggregate.noLookAhead?.reason).toContain("2019-03-31");
    });

    it("catches collapsed vintages presented as per-filing", () => {
      const vintage = perFilingVintage([2019, 2020, 2021, 2022, 2023, 2024]);
      const result = evaluateForecastHoldout(SMOOTH, {
        kind: "per-filing",
        periods: vintage.periods.map((entry) => ({ ...entry, filingAsOf: "2024-06-30" })),
      });

      expect(result.aggregate.noLookAhead?.status).toBe("unverified");
      expect(result.aggregate.noLookAhead?.reason).toContain("collapsed");
    });

    it("catches a filing date that precedes the period it reports", () => {
      const vintage = perFilingVintage([2019, 2020, 2021, 2022, 2023, 2024]);
      const result = evaluateForecastHoldout(SMOOTH, {
        kind: "per-filing",
        periods: vintage.periods.map((entry) => (entry.periodEnd === "2022-03-31" ? { ...entry, filingAsOf: "2021-06-30" } : entry)),
      });

      expect(result.aggregate.noLookAhead?.status).toBe("unverified");
      expect(result.aggregate.noLookAhead?.reason).toContain("precedes");
    });
  });

  it("returns unavailable instead of fake skill when history is too thin", () => {
    const result = evaluateForecastHoldout([
      period(2022, { sales: 100, margin: 0.1, rnoa: 0.15, cfo: 10, capex: 5, fcf: 5, cse: 50, noa: 80 }),
      period(2023, { sales: 110, margin: 0.1, rnoa: 0.15, cfo: 11, capex: 5, fcf: 6, cse: 55, noa: 88 }),
      period(2024, { sales: 121, margin: 0.1, rnoa: 0.15, cfo: 12, capex: 6, fcf: 6, cse: 60, noa: 95 }),
    ]);

    expect(result.available).toBe(false);
    expect(result.aggregate.status).toBe("unavailable");
    expect(result.aggregate.sampleSize).toBe(0);
    expect(result.aggregate.calibrationStatus).toBe("unavailable");
    expect(result.reason).toContain("at least");
  });
});
