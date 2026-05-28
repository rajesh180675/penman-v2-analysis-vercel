/* ================================================================
   Plan 3 PR-3.4 — NBFC + Insurance strategy contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import { listStrategies, selectStrategy } from "../../pipeline/registry";
import "../../pipeline/strategies"; // side-effect: register all strategies
import type { RawPeriodData } from "../../types/raw";
import { DEFAULT_CONFIG } from "../../types/config";

const sampleRaw: RawPeriodData[] = [
  {
    company_id: "TEST",
    period_end: "2024-03-31",
    raw_metric_values: { Revenue: 100, "Total Assets": 1000 },
  },
];

describe("NbfcPipelineStrategy + InsurancePipelineStrategy (Plan 3 PR-3.4)", () => {
  it("registry contains all four sector strategies", () => {
    const kinds = listStrategies().map((s) => s.kind);
    expect(kinds).toContain("bank");
    expect(kinds).toContain("nbfc");
    expect(kinds).toContain("insurance");
    expect(kinds).toContain("industrial");
    // Industrial MUST be last
    expect(kinds[kinds.length - 1]).toBe("industrial");
  });

  it("matches NBFC when company_type === 'nbfc'", () => {
    const cfg = { ...DEFAULT_CONFIG, company_type: "nbfc" as const };
    const chosen = selectStrategy(sampleRaw, cfg);
    expect(chosen.kind).toBe("nbfc");
    expect(chosen.id).toBe("nbfc-v1");
  });

  it("matches insurance when company_type === 'insurance'", () => {
    const cfg = { ...DEFAULT_CONFIG, company_type: "insurance" as const };
    const chosen = selectStrategy(sampleRaw, cfg);
    expect(chosen.kind).toBe("insurance");
    expect(chosen.id).toBe("insurance-v1");
  });

  it("falls through to industrial for unknown sector tags", () => {
    const cfg = { ...DEFAULT_CONFIG, company_type: "auto" as const };
    const chosen = selectStrategy(sampleRaw, cfg);
    expect(chosen.kind).toBe("industrial");
  });
});
