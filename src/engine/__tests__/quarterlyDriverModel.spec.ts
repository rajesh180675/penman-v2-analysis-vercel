/* ================================================================
   quarterlyDriverModel — cadence detection and TTM correctness.

   These tests pin the contract that the "Quarterly And TTM Driver View"
   panel (src/components/forecast/DriverGrid.tsx) renders. Three defects
   motivated them:

   1. TTM ignored cadence. `ttmRevenueProxy` summed the last four
      *periods* unconditionally. Every company in this repo files
      annually (all 128 `period_end` values under
      public/data/companies are `03-31`), so the panel showed roughly
      4x the true trailing-twelve-month revenue under a "TTM" label.
      For an annual filer the trailing twelve months IS the fiscal
      year, so the correct proxy is the latest annual figure.

   2. Cadence was detected from month-day patterns, and `-12-31`
      counted as a quarter end. A December-fiscal-year filer with four
      annual periods therefore reported `quarterly-ready`. Latent on
      current data, live for any Dec-FY issuer. Cadence now comes from
      date gaps, reusing the thresholds the pipeline's own frequency
      detector already uses (src/engine/pipeline.ts detectFrequencyWarning:
      quarterly 60-120 days, annual 330-400).

   3. `drivers.revenueRunRate` was `ttm / 4`, i.e. the mean of the last
      four annual periods rather than a run rate. It is now the
      annualised figure.

   Consequence worth stating: `marginRunRate` is a ratio of the two TTM
   proxies, so the old 4x errors cancelled and it silently reported a
   four-year blended margin. It is now the latest annual margin. The
   tests below use non-proportional PAT so blended and latest differ,
   which is what makes that distinction observable.
================================================================ */

import { describe, expect, it } from "vitest";
import { buildQuarterlyDriverSummary } from "../quarterlyDriverModel";
import type { RawPeriodData } from "../types";

function raw(period_end: string, revenue: number | null, pat: number | null): RawPeriodData {
  const values: Record<string, number | null> = {};
  if (revenue != null) values["Revenue From Operations__ProfitLoss"] = revenue;
  if (pat != null) values["Profit After Tax__ProfitLoss"] = pat;
  return {
    company_id: "TEST",
    period_end,
    accounting_standard: "ind-as",
    currency_unit: "Crores",
    raw_metric_values: values,
  };
}

/** March-fiscal-year annual filer — the shape of every company in this repo. */
const ANNUAL_MARCH: RawPeriodData[] = [
  raw("2022-03-31", 100, 10),
  raw("2023-03-31", 110, 11),
  raw("2024-03-31", 120, 12),
  // PAT deliberately non-proportional: latest margin 0.20 vs blended 0.128.
  raw("2025-03-31", 130, 26),
];

/** December-fiscal-year annual filer — regression case for defect 2. */
const ANNUAL_DECEMBER: RawPeriodData[] = [
  raw("2021-12-31", 200, 20),
  raw("2022-12-31", 210, 21),
  raw("2023-12-31", 220, 22),
  raw("2024-12-31", 230, 23),
];

/** Four consecutive quarters — gaps of 90-92 days. */
const QUARTERLY: RawPeriodData[] = [
  raw("2024-06-30", 25, 2),
  raw("2024-09-30", 26, 3),
  raw("2024-12-31", 27, 4),
  raw("2025-03-31", 28, 5),
];

describe("quarterlyDriverModel — cadence detection", () => {
  it("classifies a March-fiscal-year annual filer as annual-only", () => {
    expect(buildQuarterlyDriverSummary(ANNUAL_MARCH, []).filingCadence).toBe("annual-only");
  });

  it("classifies a December-fiscal-year annual filer as annual-only, not quarterly", () => {
    // The month-day regex counted every `-12-31` as a quarter end, so four
    // annual periods read as `quarterly-ready` and the TTM sum followed.
    expect(buildQuarterlyDriverSummary(ANNUAL_DECEMBER, []).filingCadence).toBe("annual-only");
  });

  it("classifies four consecutive quarters as quarterly-ready", () => {
    expect(buildQuarterlyDriverSummary(QUARTERLY, []).filingCadence).toBe("quarterly-ready");
  });

  it("classifies an annual series with a stub quarter as mixed", () => {
    const mixed = [raw("2023-03-31", 100, 10), raw("2024-03-31", 110, 11), raw("2024-06-30", 30, 3)];
    expect(buildQuarterlyDriverSummary(mixed, []).filingCadence).toBe("mixed");
  });

  it("treats a single period as annual-only rather than guessing from its date", () => {
    expect(buildQuarterlyDriverSummary([raw("2024-12-31", 100, 10)], []).filingCadence).toBe("annual-only");
  });

  it("detects cadence regardless of input ordering", () => {
    const shuffled = [ANNUAL_MARCH[2]!, ANNUAL_MARCH[0]!, ANNUAL_MARCH[3]!, ANNUAL_MARCH[1]!];
    const summary = buildQuarterlyDriverSummary(shuffled, []);
    expect(summary.filingCadence).toBe("annual-only");
    // Latest period must be resolved by date, not by array position.
    expect(summary.latestQuarterLabel).toBe("2025-03-31");
    expect(summary.ttmRevenueProxy).toBe(130);
  });
});

describe("quarterlyDriverModel — TTM proxies", () => {
  it("uses the latest annual figures for an annual filer, not the four-year sum", () => {
    const summary = buildQuarterlyDriverSummary(ANNUAL_MARCH, []);
    // The defect: 100+110+120+130 = 460 revenue and 10+11+12+26 = 59 PAT.
    expect(summary.ttmRevenueProxy).toBe(130);
    expect(summary.ttmPatProxy).toBe(26);
  });

  it("sums four quarters for a quarterly filer", () => {
    const summary = buildQuarterlyDriverSummary(QUARTERLY, []);
    expect(summary.ttmRevenueProxy).toBe(25 + 26 + 27 + 28);
    expect(summary.ttmPatProxy).toBe(2 + 3 + 4 + 5);
  });

  it("withholds a TTM proxy on mixed cadence rather than reporting a wrong one", () => {
    const mixed = [raw("2023-03-31", 100, 10), raw("2024-03-31", 110, 11), raw("2024-06-30", 30, 3)];
    const summary = buildQuarterlyDriverSummary(mixed, []);
    expect(summary.ttmRevenueProxy).toBeNull();
    expect(summary.ttmPatProxy).toBeNull();
  });

  it("withholds a TTM proxy when a quarterly series has fewer than four quarters", () => {
    const summary = buildQuarterlyDriverSummary(QUARTERLY.slice(1), []);
    expect(summary.filingCadence).toBe("quarterly-ready");
    expect(summary.ttmRevenueProxy).toBeNull();
  });

  it("withholds a TTM proxy when a quarter is missing the metric", () => {
    const gap = [QUARTERLY[0]!, raw("2024-09-30", null, 3), QUARTERLY[2]!, QUARTERLY[3]!];
    expect(buildQuarterlyDriverSummary(gap, []).ttmRevenueProxy).toBeNull();
  });

  it("reports the latest annual margin, not a four-year blend", () => {
    const summary = buildQuarterlyDriverSummary(ANNUAL_MARCH, []);
    // Blended would be 59/460 = 0.128.
    expect(summary.drivers.marginRunRate).toBeCloseTo(26 / 130, 10);
  });

  it("reports an annualised revenue run rate, not the mean of four years", () => {
    const summary = buildQuarterlyDriverSummary(ANNUAL_MARCH, []);
    // Previously 460/4 = 115, the four-year mean.
    expect(summary.drivers.revenueRunRate).toBe(130);
  });

  it("annualises the run rate from the quarter sum for a quarterly filer", () => {
    expect(buildQuarterlyDriverSummary(QUARTERLY, []).drivers.revenueRunRate).toBe(106);
  });
});

describe("quarterlyDriverModel — degenerate input", () => {
  it("survives empty and nullish input", () => {
    const inputs: Array<RawPeriodData[] | null | undefined> = [null, undefined, []];
    for (const input of inputs) {
      const summary = buildQuarterlyDriverSummary(input, []);
      expect(summary.ttmRevenueProxy).toBeNull();
      expect(summary.latestQuarterLabel).toBeNull();
      // Narrative fields are rendered directly; they must never be empty.
      expect(summary.capacitySignal.length).toBeGreaterThan(10);
      expect(summary.priceVolumeMixSignal.length).toBeGreaterThan(10);
    }
  });
});
