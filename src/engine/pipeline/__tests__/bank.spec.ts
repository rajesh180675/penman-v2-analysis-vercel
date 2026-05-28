/* ================================================================
   Plan 3 PR-3.3 — BankPipelineStrategy contract test.
================================================================ */

import { describe, it, expect } from "vitest";
import { selectStrategy } from "../../pipeline/registry";
import "../../pipeline/strategies"; // side-effect: register all strategies
import type { RawPeriodData } from "../../types/raw";
import { DEFAULT_CONFIG } from "../../types/config";

const sampleRaw: RawPeriodData[] = [
  {
    company_id: "TESTBANK",
    period_end: "2024-03-31",
    raw_metric_values: { "Net Interest Income": 100, "Total Assets": 5000, "Net NPA %": 0.5 },
  },
];

describe("BankPipelineStrategy (Plan 3 PR-3.3)", () => {
  it("matches when config.company_type === 'bank'", () => {
    const cfg = { ...DEFAULT_CONFIG, company_type: "bank" as const };
    const chosen = selectStrategy(sampleRaw, cfg);
    expect(chosen.kind).toBe("bank");
    expect(chosen.id).toBe("bank-v1");
  });

  it("falls through to industrial catch-all for 'auto'", () => {
    const cfg = { ...DEFAULT_CONFIG, company_type: "auto" as const };
    const chosen = selectStrategy(sampleRaw, cfg);
    expect(chosen.kind).toBe("industrial");
  });

  it("validateRaw flags empty input", () => {
    const cfg = { ...DEFAULT_CONFIG, company_type: "bank" as const };
    const chosen = selectStrategy(sampleRaw, cfg);
    const r1 = chosen.validateRaw([]);
    expect(r1.ok).toBe(true);
    expect(r1.warnings).toContain("rawData is empty");
  });

  it("recast() returns [] (bank emits BankPeriodMetrics, not industrial periods)", () => {
    const cfg = { ...DEFAULT_CONFIG, company_type: "bank" as const };
    const chosen = selectStrategy(sampleRaw, cfg);
    const periods = chosen.recast(sampleRaw, cfg);
    expect(Array.isArray(periods)).toBe(true);
    expect(periods.length).toBe(0);
  });
});
