import { describe, expect, it } from "vitest";
import { buildFallbackSnapshot, parseAlphaVantageHistory, parseNseHistoryRows } from "./snapshot.js";

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

/**
 * This file is the DEPLOYED market-data endpoint. `server/routes/marketData.ts`
 * is the local dev twin behind vite's proxy, and #291/#292 fixed the history
 * parse there — but this copy is `.js`, so `tsconfig`'s `api/**\/*.ts` include
 * never typechecked it and the same three defects stayed live in production.
 *
 * All three end the same way: `fetchNseHistory`'s caller converts any throw into
 * `[]`, so one bad element discarded every valid observation beside it and the
 * caller could not distinguish that from "NSE returned nothing" — the 52-week
 * range and percentile silently vanish rather than being computed from the rows
 * that did arrive.
 */
describe("NSE history parsing (deployed handler)", () => {
  const VALID = { CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: 3450.5 };

  it("keeps valid observations when a malformed element sits beside them", () => {
    // Defect 1: elements were read without being narrowed, so `d.CH_TIMESTAMP`
    // threw on a null row.
    const points = parseNseHistoryRows([
      VALID,
      null,
      "unexpected string row",
      42,
      ["nested", "array"],
      { CH_TIMESTAMP: "2026-07-23", CH_CLOSING_PRICE: 3402.15 },
    ]);
    expect(points.map(p => p.date)).toEqual(["2026-07-24", "2026-07-23"]);
  });

  it("drops a numeric timestamp rather than admitting it to the series", () => {
    // Defect 2, specific to this file: the filter was `d.date && d.close != null`,
    // a truthiness test, so a numeric CH_TIMESTAMP passed it. Measured, that
    // leaks a junk row rather than always throwing — `localeCompare` coerces its
    // argument, so it only fails when the comparator reads the number as the
    // receiver. Whether a partial payload yields a bad point or no points at all
    // depends on sort order.
    const points = parseNseHistoryRows([VALID, { CH_TIMESTAMP: 20260723, CH_CLOSING_PRICE: 3402.15 }]);
    expect(points).toEqual([{ date: "2026-07-24", close: 3450.5 }]);
  });

  it("rejects closes the feed never reported rather than scoring them zero", () => {
    // Defect 3: Number("") / Number(null) / Number("  ") / Number([]) are all 0,
    // and Number(true) is 1. A zero then becomes the 52-week low via Math.min,
    // prints as ₹0.00, and trips summarizeHistoricalPrices' own `low52Week > 0`
    // guard so distanceFrom52WeekLowPct silently blanks.
    for (const raw of ["", "   ", [], true, -5, 0]) {
      expect(parseNseHistoryRows([{ CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: raw }])).toEqual([]);
    }
    // `null` reaches the coercion only in the alternate-field position:
    // `undefined ?? null` is null, where a lone CH_CLOSING_PRICE falls through to
    // an absent CLOSE_PRICE and Number(undefined) is NaN. Both pinned.
    expect(parseNseHistoryRows([{ CH_TIMESTAMP: "2026-07-24", CLOSE_PRICE: null }])).toEqual([]);
    expect(parseNseHistoryRows([{ CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: null }])).toEqual([]);
  });

  it("rejects a non-numeric placeholder, as it did before this fix", () => {
    // Characterises rather than guards: `toNumber` has always returned null for
    // these, since `Number("NA")` is NaN — unlike `Number("")`, which is 0. The
    // typed twin's spec pins the same shape via "not-a-number". Kept explicit
    // because a placeholder string is the other way a feed reports "no trade",
    // and the fix above deliberately screens only blank-and-non-positive.
    for (const raw of ["NA", "-", "—", "n/a"]) {
      expect(parseNseHistoryRows([{ CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: raw }])).toEqual([]);
    }
  });

  it("keeps a blank close from hiding a usable alternate field", () => {
    const points = parseNseHistoryRows([
      { CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: "", CLOSE_PRICE: 3450.5 },
    ]);
    expect(points).toEqual([{ date: "2026-07-24", close: 3450.5 }]);
  });

  it("still accepts a legitimately small price", () => {
    // Non-positive is rejected, not sub-rupee: penny scrips are real.
    expect(parseNseHistoryRows([{ CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: 0.05 }]))
      .toEqual([{ date: "2026-07-24", close: 0.05 }]);
  });

  it("reads the alternate field names and sorts newest first", () => {
    const points = parseNseHistoryRows([
      { TIMESTAMP: "2026-07-22", CLOSE_PRICE: "3400" },
      { CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: 3450.5 },
      { TIMESTAMP: "2026-07-23", CLOSE_PRICE: "3402.15" },
    ]);
    expect(points.map(p => p.date)).toEqual(["2026-07-24", "2026-07-23", "2026-07-22"]);
  });

  it("returns empty for a payload that is not an array", () => {
    for (const notAnArray of [undefined, null, {}, "", "rows", 0, { data: [VALID] }]) {
      expect(parseNseHistoryRows(notAnArray)).toEqual([]);
    }
  });
});

/**
 * The AlphaVantage series feeds the same `summarizeHistoricalPrices`, so a blank
 * close costs the same fake 52-week low. It needs no row narrowing (the `?.`
 * reads already tolerate a null entry) and no date check (dates are object keys,
 * so always strings) — only the close screen applies.
 *
 * Reachable only when ALPHAVANTAGE_API_KEY is set. Whether that is configured in
 * any deployment is not established here; the coercion is the defect either way.
 */
describe("AlphaVantage history parsing (deployed handler)", () => {
  const series = (entries) => ({ "Time Series (Daily)": entries });

  it("rejects a blank close rather than scoring it zero", () => {
    for (const raw of ["", "   ", null, 0, -5]) {
      expect(parseAlphaVantageHistory(series({ "2026-07-24": { "4. close": raw } }))).toEqual([]);
    }
  });

  it("rejects a non-numeric placeholder, as it did before this fix", () => {
    // Same characterisation as the NSE case above: NaN was already rejected.
    for (const raw of ["NA", "-", "—", "n/a"]) {
      expect(parseAlphaVantageHistory(series({ "2026-07-24": { "4. close": raw } }))).toEqual([]);
    }
  });

  it("falls back to the raw close when the adjusted one is blank", () => {
    // The reason each field is screened separately: `"" ?? x` is `""`, not `x`,
    // so the old chain scored this row zero instead of reading the real value.
    const points = parseAlphaVantageHistory(series({
      "2026-07-24": { "5. adjusted close": "", "4. close": "3450.50" },
    }));
    expect(points).toEqual([{ date: "2026-07-24", close: 3450.5 }]);
  });

  it("prefers the adjusted close and sorts newest first", () => {
    const points = parseAlphaVantageHistory(series({
      "2026-07-22": { "5. adjusted close": "3400.00", "4. close": "3399.00" },
      "2026-07-24": { "5. adjusted close": "3450.50", "4. close": "3449.00" },
    }));
    expect(points).toEqual([
      { date: "2026-07-24", close: 3450.5 },
      { date: "2026-07-22", close: 3400 },
    ]);
  });

  it("reads the adjusted-series key and tolerates junk entries", () => {
    const points = parseAlphaVantageHistory({
      "Time Series (Daily Adjusted)": {
        "2026-07-24": { "4. close": "3450.50" },
        "2026-07-23": null,
        "2026-07-22": "unexpected string",
      },
    });
    expect(points).toEqual([{ date: "2026-07-24", close: 3450.5 }]);
  });

  it("returns empty when no series is present", () => {
    for (const payload of [undefined, null, {}, "", { "Time Series (Daily)": null }]) {
      expect(parseAlphaVantageHistory(payload)).toEqual([]);
    }
  });
});
