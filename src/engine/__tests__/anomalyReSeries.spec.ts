import { describe, expect, it } from "vitest";
import { buildAnomalyReSeries } from "../pipeline";
import type { RecastPeriod } from "../types";

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
    ]);
    expect(series).toEqual([
      { period: "2024-03-31", RE: 20, ReOI: 20, openingCSE: 1000 },
      { period: "2025-03-31", RE: 35, ReOI: 35, openingCSE: 1100 },
    ]);
  });
});
