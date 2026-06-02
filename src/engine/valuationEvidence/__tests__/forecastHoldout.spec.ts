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

  it("returns unavailable instead of fake skill when history is too thin", () => {
    const result = evaluateForecastHoldout([
      period(2022, { sales: 100, margin: 0.1, rnoa: 0.15, cfo: 10, capex: 5, fcf: 5, cse: 50, noa: 80 }),
      period(2023, { sales: 110, margin: 0.1, rnoa: 0.15, cfo: 11, capex: 5, fcf: 6, cse: 55, noa: 88 }),
      period(2024, { sales: 121, margin: 0.1, rnoa: 0.15, cfo: 12, capex: 6, fcf: 6, cse: 60, noa: 95 }),
    ]);

    expect(result.available).toBe(false);
    expect(result.aggregate.status).toBe("unavailable");
    expect(result.reason).toContain("at least");
  });
});
