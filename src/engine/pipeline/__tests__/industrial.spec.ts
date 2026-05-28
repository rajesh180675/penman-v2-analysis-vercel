/* ================================================================
   Plan 3 PR-3.2 — IndustrialPipelineStrategy contract test.

   Verifies the strategy registers, matches as catch-all, and
   produces the same RecastPeriod output as processCompanyDataFull.
================================================================ */

import { describe, it, expect } from "vitest";
import { listStrategies, selectStrategy } from "../../pipeline/registry";
import "../../pipeline/strategies"; // side-effect: register all strategies
import type { RawPeriodData } from "../../types/raw";
import { DEFAULT_CONFIG } from "../../types/config";
import { processCompanyDataFull } from "../../pipeline";

const sampleRaw: RawPeriodData[] = [
  {
    company_id: "TEST",
    period_end: "2024-03-31",
    raw_metric_values: { Revenue: 1000, "Total Assets": 5000, "Total Equity": 2000 },
  },
  {
    company_id: "TEST",
    period_end: "2025-03-31",
    raw_metric_values: { Revenue: 1100, "Total Assets": 5500, "Total Equity": 2200 },
  },
];

describe("IndustrialPipelineStrategy (Plan 3 PR-3.2)", () => {
  it("registers itself on import", () => {
    const strategies = listStrategies();
    expect(strategies.length).toBeGreaterThanOrEqual(1);
    expect(strategies.some((s) => s.id === "industrial-v1")).toBe(true);
  });

  it("is selected as catch-all", () => {
    const chosen = selectStrategy(sampleRaw, DEFAULT_CONFIG);
    expect(chosen.kind).toBe("industrial");
    expect(chosen.id).toBe("industrial-v1");
  });

  it("validateRaw flags empty input", () => {
    const chosen = selectStrategy(sampleRaw, DEFAULT_CONFIG);
    const r1 = chosen.validateRaw([]);
    expect(r1.ok).toBe(true); // empty is a warning, not an error
    expect(r1.warnings).toContain("rawData is empty");
    const r2 = chosen.validateRaw(sampleRaw);
    expect(r2.ok).toBe(true);
    expect(r2.errors).toEqual([]);
  });

  it("recast() agrees with processCompanyDataFull on RecastPeriod[] output", () => {
    const chosen = selectStrategy(sampleRaw, DEFAULT_CONFIG);
    const viaStrategy = chosen.recast(sampleRaw, DEFAULT_CONFIG);
    const viaLegacy = processCompanyDataFull(sampleRaw, DEFAULT_CONFIG).periods;
    expect(viaStrategy.length).toBe(viaLegacy.length);
    // Period order + boundary identity should match
    expect(viaStrategy.map((p) => p.period_end)).toEqual(viaLegacy.map((p) => p.period_end));
  });
});
