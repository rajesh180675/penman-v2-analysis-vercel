/**
 * Tests for the pinned India equity beta pack.
 *
 * Every assertion uses an EXPLICIT analysis date, for the same reason
 * `indiaMacroPack.spec.ts` does: a test that resolved the pack against
 * `new Date()` would pass today, go red 180 days after the regression window
 * closes, and look like a code regression when it is really a calendar event.
 *
 * The mechanism is covered by `equityBetaPack.spec.ts` against synthetic packs.
 * What these tests add is the claim that the *generated* pack is the shape the
 * mechanism expects and that its precision gate does real work on real data —
 * two of the thirty-three companies genuinely fail it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { INDIA_EQUITY_BETA_PACK } from "../indiaEquityBetaPack";
import { BETA_STALENESS_DAYS, MAX_BETA_STANDARD_ERROR, resolveEquityBeta } from "../equityBetaPack";

/** Shortly after the pack's window closed, so nothing is stale. */
const ANALYSIS_AS_OF = "2026-07-26";

describe("INDIA_EQUITY_BETA_PACK — shape and provenance", () => {
  it("records the benchmark, frequency, and a re-fetchable source", () => {
    // All three are what make the estimate reproducible rather than merely
    // plausible: the same five years at daily sampling gives a different slope.
    expect(INDIA_EQUITY_BETA_PACK.benchmark).toContain("NIFTY 50");
    expect(INDIA_EQUITY_BETA_PACK.benchmark).toContain("^NSEI");
    expect(INDIA_EQUITY_BETA_PACK.frequency).toBe("weekly");
    expect(INDIA_EQUITY_BETA_PACK.source).toMatch(/query1\.finance\.yahoo\.com/);
  });

  it("carries a beta, a standard error, an r-squared, and a window for every constituent", () => {
    // A beta without its diagnostics cannot be gated, and an ungated beta is a
    // sector prior wearing a decimal point.
    expect(INDIA_EQUITY_BETA_PACK.constituents.length).toBeGreaterThan(0);
    for (const item of INDIA_EQUITY_BETA_PACK.constituents) {
      expect(item.ticker).toMatch(/^[A-Z&]+$/);
      expect(Number.isFinite(item.leveredBeta)).toBe(true);
      expect(item.leveredBeta).toBeGreaterThan(0);
      expect(item.standardError).toBeGreaterThan(0);
      expect(item.rSquared).toBeGreaterThanOrEqual(0);
      expect(item.rSquared).toBeLessThanOrEqual(1);
      expect(item.observations).toBeGreaterThan(0);
      expect(Number.isFinite(Date.parse(item.windowStart))).toBe(true);
      expect(Number.isFinite(Date.parse(item.windowEnd))).toBe(true);
      expect(Date.parse(item.windowStart)).toBeLessThan(Date.parse(item.windowEnd));
    }
  });

  it("dates no window later than the pack itself", () => {
    for (const item of INDIA_EQUITY_BETA_PACK.constituents) {
      expect(Date.parse(item.windowEnd)).toBeLessThanOrEqual(Date.parse(INDIA_EQUITY_BETA_PACK.asOf));
    }
  });

  it("has no duplicate tickers", () => {
    // A duplicate would make the resolver's first-match lookup silently
    // order-dependent.
    const tickers = INDIA_EQUITY_BETA_PACK.constituents.map((item) => item.ticker);
    expect(new Set(tickers).size).toBe(tickers.length);
  });

  it("carries the pinned figures for a representative name", () => {
    // Pinned so a regenerated pack is a visible diff rather than drift. HDFCBANK
    // is the tightest fit in the set, which makes it the least likely to move
    // for reasons other than a genuine data change.
    const hdfc = INDIA_EQUITY_BETA_PACK.constituents.find((item) => item.ticker === "HDFCBANK");
    expect(hdfc).toBeDefined();
    expect(hdfc!.leveredBeta).toBe(1.0258);
    expect(hdfc!.standardError).toBe(0.0673);
    expect(hdfc!.observations).toBe(260);
  });

  it("keeps shorter histories honest about their length", () => {
    // Recently-listed names have genuinely less data. The observation count is
    // what stops a two-year regression being read as a five-year one.
    const lici = INDIA_EQUITY_BETA_PACK.constituents.find((item) => item.ticker === "LICI");
    expect(lici!.observations).toBeLessThan(260);
    expect(lici!.windowStart).toBe("2022-05-22");
  });
});

describe("INDIA_EQUITY_BETA_PACK — resolution against a fixed analysis date", () => {
  it("resolves a precise estimate as usable", () => {
    const result = resolveEquityBeta(INDIA_EQUITY_BETA_PACK, "TCS", { analysisAsOf: ANALYSIS_AS_OF });

    expect(result.status).toBe("usable");
    if (result.status !== "usable") return;
    expect(result.beta).toBe(0.8909);
    expect(result.asOf).toBe("2026-07-19");
    expect(result.method).toContain("NIFTY 50");
  });

  it("rejects the two names whose betas are not actually measured", () => {
    // The gate earning its keep on real data. IDEA's market model explains 11%
    // of its return variance and PAYTM's 3%; their slopes carry standard errors
    // of 0.25, so a 95% interval spans roughly a full unit of beta.
    for (const ticker of ["IDEA", "PAYTM"]) {
      const result = resolveEquityBeta(INDIA_EQUITY_BETA_PACK, ticker, { analysisAsOf: ANALYSIS_AS_OF });
      expect(result.status).toBe("unusable");
      if (result.status === "unusable") expect(result.reason).toContain("too imprecise");
    }
  });

  it("admits every other constituent", () => {
    // Stated as a count so a refresh that quietly degrades many names shows up
    // here rather than only in whichever single name a test happened to pin.
    const usable = INDIA_EQUITY_BETA_PACK.constituents
      .map((item) => resolveEquityBeta(INDIA_EQUITY_BETA_PACK, item.ticker, { analysisAsOf: ANALYSIS_AS_OF }))
      .filter((result) => result.status === "usable");

    expect(usable.length).toBe(INDIA_EQUITY_BETA_PACK.constituents.length - 2);
  });

  it("keeps the thresholds this pack was measured against", () => {
    // If these move, the two assertions above stop meaning what they say.
    expect(MAX_BETA_STANDARD_ERROR).toBe(0.15);
    expect(BETA_STALENESS_DAYS).toBe(180);
  });

  it("rejects the whole pack as look-ahead when valuing an earlier date", () => {
    // A 2026 regression window cannot inform a 2024 valuation. Without a
    // vintage-appropriate pack the honest answer is the stated prior.
    const result = resolveEquityBeta(INDIA_EQUITY_BETA_PACK, "TCS", { analysisAsOf: "2024-03-31" });

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") expect(result.reason).toContain("look-ahead");
  });

  it("goes stale rather than being used indefinitely", () => {
    // 2026-07-19 + 181 days.
    const result = resolveEquityBeta(INDIA_EQUITY_BETA_PACK, "TCS", { analysisAsOf: "2027-01-16" });

    expect(result.status).toBe("unusable");
    if (result.status === "unusable") expect(result.reason).toContain("limit is 180 days");
  });
});

describe("INDIA_EQUITY_BETA_PACK — registry coverage", () => {
  it("covers every company in the registry", () => {
    // A company added to the registry without regenerating the pack would
    // resolve to a sector prior. That fallback is honest — it states its reason
    // — but it is not what anyone adding a company intends, and the fix is one
    // command. Same discipline as `validate-registry` and the model-catalog
    // freshness check: the repo prefers a red test to a silent downgrade.
    //
    // If a ticker genuinely has no fetchable price history (a fresh listing, a
    // symbol the provider does not carry), the refresh script logs it as skipped
    // and this test will stay red. Record that exclusion explicitly here rather
    // than deleting the assertion — an unfetchable name is a fact worth naming,
    // and loosening the check would hide the next twelve that regress.
    const registryPath = resolve(__dirname, "../../../../public/data/companies/registry.json");
    const registry: Array<{ ticker: string }> = JSON.parse(readFileSync(registryPath, "utf-8"));
    const covered = new Set(INDIA_EQUITY_BETA_PACK.constituents.map((item) => item.ticker));

    const missing = registry.map((entry) => entry.ticker).filter((ticker) => !covered.has(ticker));

    expect(missing, `Not in the beta pack — run: npx tsx scripts/refresh-beta-pack.ts`).toEqual([]);
  });
});
