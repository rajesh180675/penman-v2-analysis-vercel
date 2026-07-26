import { describe, expect, it } from "vitest";
import { buildFallbackSnapshot } from "./snapshot.js";

describe("market snapshot point-in-time fallbacks", () => {
  it("pins a fallback price to the instant it became known", () => {
    const fetchedAt = "2026-07-13T08:00:00.000Z";
    const snapshot = buildFallbackSnapshot({
      provider: "Manual / Fallback",
      symbol: "TCS",
      instrumentKey: null,
      fallbackPrice: 3_450,
      fallbackRiskFreeRate: 0.07,
      warnings: [],
      fetchedAt,
      sourceSummary: "Analyst-configured fallback.",
    });
    expect(snapshot).toMatchObject({ price: 3_450, priceAsOf: fetchedAt, freshness: "fallback" });
  });

  it("reports no risk-free rate, because no rate was observed here", () => {
    // This used to echo `fallbackRiskFreeRate` back as `riskFreeRate` with
    // `rateAsOf: fetchedAt`. Both halves were false: the value is the caller's
    // own `config.risk_free_rate` round-tripping through an HTTP call, and
    // `fetchedAt` dates that call rather than an observation of any rate.
    //
    // It mattered because the client tiers a *dated* live rate `sourced`
    // (`resolveRiskFreeRate`), so the pair presented an engine default to
    // reviewers as attributable market data — and, once a pinned macro pack is
    // supplied, would have outranked a genuinely dated G-Sec observation.
    const fetchedAt = "2026-07-13T08:00:00.000Z";
    const snapshot = buildFallbackSnapshot({
      provider: "Manual / Fallback",
      symbol: "TCS",
      instrumentKey: null,
      fallbackPrice: 3_450,
      fallbackRiskFreeRate: 0.07,
      warnings: [],
      fetchedAt,
      sourceSummary: "Analyst-configured fallback.",
    });
    expect(snapshot.riskFreeRate).toBeNull();
    expect(snapshot.rateAsOf).toBeNull();
  });

  it("does not invent a price timestamp when no fallback price exists", () => {
    const snapshot = buildFallbackSnapshot({
      provider: "Manual / Fallback", symbol: "TCS", instrumentKey: null,
      fallbackPrice: null, fallbackRiskFreeRate: null, warnings: [],
      fetchedAt: "2026-07-13T08:00:00.000Z", sourceSummary: "Missing.",
    });
    expect(snapshot).toMatchObject({ priceAsOf: null, rateAsOf: null, freshness: "missing" });
  });

  it("reports missing when only a rate was configured, since it carries no rate", () => {
    // Freshness keys on the price alone. A configured rate is not something this
    // snapshot carries, so counting it would claim "fallback" over an empty
    // payload.
    const snapshot = buildFallbackSnapshot({
      provider: "Manual / Fallback", symbol: "TCS", instrumentKey: null,
      fallbackPrice: null, fallbackRiskFreeRate: 0.07, warnings: [],
      fetchedAt: "2026-07-13T08:00:00.000Z", sourceSummary: "Rate only.",
    });
    expect(snapshot.freshness).toBe("missing");
  });
});
