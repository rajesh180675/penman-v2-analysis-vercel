import { describe, expect, it } from "vitest";
import {
  MACRO_STALENESS_DAYS,
  resolveMacroObservation,
  resolveMacroPack,
  type MacroObservation,
  type MacroPack,
} from "../macroPack";

function observation(overrides: Partial<MacroObservation> = {}): MacroObservation {
  return { value: 0.0685, asOf: "2026-07-20", source: "RBI 10Y G-Sec close", ...overrides };
}

function macroPack(overrides: Partial<MacroPack> = {}): MacroPack {
  return {
    asOf: "2026-07-20",
    riskFreeRate: observation(),
    equityRiskPremium: observation({ value: 0.058, asOf: "2026-03-31", source: "Damodaran India implied ERP" }),
    longRunNominalGrowth: observation({ value: 0.105, asOf: "2025-12-31", source: "IMF WEO India nominal GDP trend" }),
    ...overrides,
  };
}

describe("resolveMacroObservation", () => {
  it("accepts a dated, sourced, plausible value", () => {
    const result = resolveMacroObservation("riskFreeRate", observation(), "2026-07-26");

    expect(result.status).toBe("usable");
    if (result.status === "usable") {
      expect(result.value).toBeCloseTo(0.0685, 4);
      expect(result.source).toContain("RBI");
    }
  });

  it("reports absence rather than substituting a default", () => {
    const result = resolveMacroObservation("equityRiskPremium", null);

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") expect(result.reason).toContain("No pinned equityRiskPremium");
  });

  it("catches a percentage entered where a fraction was expected", () => {
    // 6.85 instead of 0.0685 — the error that would otherwise produce a 685%
    // discount rate and a near-zero valuation.
    const result = resolveMacroObservation("riskFreeRate", observation({ value: 6.85 }), "2026-07-26");

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") expect(result.reason).toContain("plausible band");
  });

  it("refuses an unattributed value", () => {
    const result = resolveMacroObservation("equityRiskPremium", observation({ value: 0.06, source: "   " }), "2026-07-26");

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") expect(result.reason).toContain("no source");
  });

  it("refuses an observation dated after the analysis", () => {
    const result = resolveMacroObservation("riskFreeRate", observation({ asOf: "2026-08-15" }), "2026-07-26");

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") expect(result.reason).toContain("look-ahead");
  });

  it("applies a per-quantity staleness window rather than one shared limit", () => {
    // A 90-day-old bond yield is stale; a 90-day-old ERP estimate is not.
    const asOf = "2026-04-27";
    const analysisAsOf = "2026-07-26";

    expect(resolveMacroObservation("riskFreeRate", observation({ asOf }), analysisAsOf).status).toBe("unusable");
    expect(resolveMacroObservation("equityRiskPremium", observation({ value: 0.058, asOf }), analysisAsOf).status).toBe("usable");
    expect(MACRO_STALENESS_DAYS.riskFreeRate).toBeLessThan(MACRO_STALENESS_DAYS.equityRiskPremium);
  });

  it("rejects a non-finite value", () => {
    expect(resolveMacroObservation("riskFreeRate", observation({ value: Number.NaN })).status).toBe("unusable");
  });

  it("rejects an invalid as-of date", () => {
    const result = resolveMacroObservation("riskFreeRate", observation({ asOf: "not-a-date" }));

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") expect(result.reason).toContain("invalid as-of");
  });
});

describe("resolveMacroPack", () => {
  it("is complete only when all three quantities are usable", () => {
    const resolution = resolveMacroPack(macroPack(), "2026-07-26");

    expect(resolution.complete).toBe(true);
  });

  it("is incomplete when any one quantity is missing, and says which", () => {
    const resolution = resolveMacroPack(macroPack({ equityRiskPremium: null }), "2026-07-26");

    expect(resolution.complete).toBe(false);
    expect(resolution.riskFreeRate.status).toBe("usable");
    expect(resolution.equityRiskPremium.status).toBe("unusable");
  });

  it("reports every quantity as unusable when no pack exists at all", () => {
    const resolution = resolveMacroPack(null, "2026-07-26");

    expect(resolution.complete).toBe(false);
    expect([resolution.riskFreeRate.status, resolution.equityRiskPremium.status, resolution.longRunNominalGrowth.status])
      .toEqual(["unusable", "unusable", "unusable"]);
  });
});
