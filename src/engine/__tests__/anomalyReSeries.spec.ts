import { describe, expect, it } from "vitest";
import { buildAnomalyReSeries } from "../pipeline";
import type { EngineConfig, RecastPeriod } from "../types";

const config = { tax_rate_mode: "effective", statutory_tax_rate: 0.2517 } as EngineConfig;

// The S-10.1 materiality test is dead unless the pipeline hands it each
// period's OPENING equity (the previous period's CSE).
function period(end: string, cse: number, re: number | null): RecastPeriod {
  return { period_end: end, bs: { CSE: cse }, ri: re == null ? undefined : { RE: re, ReOI: re } } as unknown as RecastPeriod;
}

describe("buildAnomalyReSeries", () => {
  it("carries the previous period's CSE as each point's opening equity", () => {
    const series = buildAnomalyReSeries([
      period("2023-03-31", 1000, null),
      period("2024-03-31", 1100, 20),
      period("2025-03-31", 1250, 35),
    ], config);
    expect(series).toMatchObject([
      { period: "2024-03-31", RE: 20, ReOI: 20, openingCSE: 1000 },
      { period: "2025-03-31", RE: 35, ReOI: 35, openingCSE: 1100 },
    ]);
  });

  it("carries core residual earnings: RE less the filed one-offs, UFE added back", () => {
    // Core CNI = CNI − UOI + UFE, since NFE = CoreNFE + UFE.
    const withSplit = { ...period("2025-03-31", 1250, 35), cu: { UOI: 50, UFE: 4 } } as unknown as RecastPeriod;
    const [point] = buildAnomalyReSeries([period("2024-03-31", 1100, null), withSplit], config);
    expect(point!.coreRE).toBe(35 - 50 + 4);
  });

  it("says whether each year's core is taxed like the years before it", () => {
    // Airtel-shaped: 30–33% for three years, then 2.4% (a deferred-tax credit).
    const taxed = (end: string, rate: number) =>
      ({ ...period(end, 1000, 10), is: { taxRate: rate } }) as unknown as RecastPeriod;
    const series = buildAnomalyReSeries([
      taxed("2022-03-31", 0.335), taxed("2023-03-31", 0.258), taxed("2024-03-31", 0.325), taxed("2025-03-31", 0.024),
    ], config);
    expect(series.map((p) => p.coreTaxComparable)).toEqual([false, true, true, false]);
  });
});
