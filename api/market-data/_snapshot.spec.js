import { describe, expect, it } from "vitest";
import { buildFallbackSnapshot } from "./snapshot.js";

describe("market snapshot point-in-time fallbacks", () => {
  it("pins analyst fallback values to the instant they became known", () => {
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
    expect(snapshot).toMatchObject({ price: 3_450, riskFreeRate: 0.07, priceAsOf: fetchedAt, rateAsOf: fetchedAt, freshness: "fallback" });
  });

  it("does not invent a price timestamp when no fallback price exists", () => {
    const snapshot = buildFallbackSnapshot({
      provider: "Manual / Fallback", symbol: "TCS", instrumentKey: null,
      fallbackPrice: null, fallbackRiskFreeRate: null, warnings: [],
      fetchedAt: "2026-07-13T08:00:00.000Z", sourceSummary: "Missing.",
    });
    expect(snapshot).toMatchObject({ priceAsOf: null, rateAsOf: null, freshness: "missing" });
  });
});
