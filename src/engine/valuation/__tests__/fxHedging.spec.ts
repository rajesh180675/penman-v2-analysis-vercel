/* ================================================================
   Plan 5b PR-5b.5 — FX hedging contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import { fxNeutralRevenue, hedgingEffectiveness } from "../fxHedging";

describe("fxNeutralRevenue (Plan 5b PR-5b.5)", () => {
  it("Constant USD/INR rate -> reportedGrowth == fxNeutralGrowth", () => {
    const r = fxNeutralRevenue([
      { periodEnd: "2023-03-31", reportedRevenueCr: 1000, averageRateInrPerForeign: 80, closingRateInrPerForeign: 80, foreignCurrencyMix: 0.7 },
      { periodEnd: "2024-03-31", reportedRevenueCr: 1100, averageRateInrPerForeign: 80, closingRateInrPerForeign: 80, foreignCurrencyMix: 0.7 },
    ]);
    expect(r.reportedGrowth).toBeCloseTo(0.10, 6);
    expect(r.fxNeutralGrowth).toBeCloseTo(0.10, 6);
    expect(r.fxImpactBps).toBeCloseTo(0, 0);
  });

  it("INR weakens (higher rate) -> reported > fx-neutral", () => {
    // 70% USD revenue. Rate moves 80 -> 84 (INR weakens 5%). Reported revenue rises
    // partly from USD volume, partly from FX.
    const r = fxNeutralRevenue([
      { periodEnd: "2023-03-31", reportedRevenueCr: 1000, averageRateInrPerForeign: 80, closingRateInrPerForeign: 80, foreignCurrencyMix: 0.7 },
      { periodEnd: "2024-03-31", reportedRevenueCr: 1100, averageRateInrPerForeign: 84, closingRateInrPerForeign: 84, foreignCurrencyMix: 0.7 },
    ]);
    expect(r.reportedGrowth).toBeGreaterThan(r.fxNeutralGrowth);
    expect(r.fxImpactBps).toBeGreaterThan(0);
  });

  it("INR strengthens -> reported < fx-neutral (FX hurt revenue)", () => {
    const r = fxNeutralRevenue([
      { periodEnd: "2023-03-31", reportedRevenueCr: 1000, averageRateInrPerForeign: 84, closingRateInrPerForeign: 84, foreignCurrencyMix: 0.7 },
      { periodEnd: "2024-03-31", reportedRevenueCr: 1050, averageRateInrPerForeign: 80, closingRateInrPerForeign: 80, foreignCurrencyMix: 0.7 },
    ]);
    expect(r.reportedGrowth).toBeLessThan(r.fxNeutralGrowth);
    expect(r.fxImpactBps).toBeLessThan(0);
  });

  it("100% INR business has zero FX impact regardless of rate move", () => {
    const r = fxNeutralRevenue([
      { periodEnd: "2023-03-31", reportedRevenueCr: 1000, averageRateInrPerForeign: 80, closingRateInrPerForeign: 80, foreignCurrencyMix: 0 },
      { periodEnd: "2024-03-31", reportedRevenueCr: 1100, averageRateInrPerForeign: 100, closingRateInrPerForeign: 100, foreignCurrencyMix: 0 },
    ]);
    expect(r.fxImpactBps).toBeCloseTo(0, 0);
  });

  it("requires at least 2 periods", () => {
    expect(() => fxNeutralRevenue([])).toThrow();
    expect(() =>
      fxNeutralRevenue([
        { periodEnd: "2023-03-31", reportedRevenueCr: 100, averageRateInrPerForeign: 80, closingRateInrPerForeign: 80, foreignCurrencyMix: 0.5 },
      ]),
    ).toThrow();
  });
});

describe("hedgingEffectiveness (Plan 5b PR-5b.5)", () => {
  it("Hedge fully offsetting unhedged exposure -> 'effective', ratio = -1", () => {
    // Notional 100cr USD revenue, INR weakens 5% -> unhedged impact +5cr.
    // Hedge derivative loses 5cr (offsetting).
    const r = hedgingEffectiveness({
      notionalExposureCr: 100,
      spotMove: 0.05,
      derivativeFvChangeCr: -5,
    });
    expect(r.verdict).toBe("effective");
    expect(r.hedgeRatio).toBeCloseTo(-1.0, 2);
  });

  it("Partial hedge (50% offset) -> 'partial'", () => {
    const r = hedgingEffectiveness({
      notionalExposureCr: 100,
      spotMove: 0.05,
      derivativeFvChangeCr: -2.5,
    });
    expect(r.verdict).toBe("partial");
    expect(r.hedgeRatio).toBeCloseTo(-0.5, 2);
  });

  it("Token hedge (10% offset) -> 'ineffective'", () => {
    const r = hedgingEffectiveness({
      notionalExposureCr: 100,
      spotMove: 0.05,
      derivativeFvChangeCr: -0.5,
    });
    expect(r.verdict).toBe("ineffective");
  });

  it("Same-direction position large enough -> 'speculative'", () => {
    // INR weakens 5%, derivative GAINS — directional bet, not hedge.
    const r = hedgingEffectiveness({
      notionalExposureCr: 100,
      spotMove: 0.05,
      derivativeFvChangeCr: +5,
    });
    expect(r.verdict).toBe("speculative");
    expect(r.diagnostics.some((d) => d.includes("directional"))).toBe(true);
  });

  it("Custom thresholds shift the verdict bands", () => {
    // 50% offset would normally be 'partial'. Tighten the bar.
    const r = hedgingEffectiveness({
      notionalExposureCr: 100,
      spotMove: 0.05,
      derivativeFvChangeCr: -2.5,
      effectiveThreshold: 0.40,
    });
    expect(r.verdict).toBe("effective");
  });

  it("Unhedged impact = notional * spotMove", () => {
    const r = hedgingEffectiveness({
      notionalExposureCr: 200,
      spotMove: 0.03,
      derivativeFvChangeCr: -5,
    });
    expect(r.unhedgedImpactCr).toBeCloseTo(6, 6);
  });
});
