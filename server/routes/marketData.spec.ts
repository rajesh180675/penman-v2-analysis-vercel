import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import marketDataRouter, { parseNseHistoryRows } from "./marketData";

/**
 * Every snapshot value must ship with its own pinned as-of date.
 *
 * The AnalysisRun request-validation gate rejects a snapshot carrying a price or
 * risk-free rate without one (MARKET_PRICE_DATE_REQUIRED /
 * MARKET_RATE_DATE_REQUIRED). That rejection blocks the run *before* the
 * pipeline runs, so the UI projection receives no pipelineResult, recastData is
 * empty, and every data-gated tab (dashboard, statements, ratios, quality,
 * valuation, report) silently disappears. Local-only regression: this route
 * defaulted riskFreeRate to 0.07 while leaving rateAsOf null, which is why the
 * Vercel deployment showed all tabs and `npm run dev:local` did not.
 */
interface Snapshot {
  price: number | null;
  priceAsOf: string | null;
  riskFreeRate: number | null;
  rateAsOf: string | null;
}

async function getSnapshot(query: string): Promise<Snapshot> {
  const app = express();
  app.use("/api/market-data", marketDataRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/market-data/snapshot?${query}`);
    const payload = await response.json() as { ok: boolean; snapshot: Snapshot };
    expect(payload.ok).toBe(true);
    return payload.snapshot;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** The exact invariant validateInput enforces in legacyExecutor. */
function expectAsOfPairing(snapshot: Snapshot) {
  if (snapshot.price != null) expect(snapshot.priceAsOf).toBeTruthy();
  if (snapshot.riskFreeRate != null) expect(snapshot.rateAsOf).toBeTruthy();
}

describe("local market-data snapshot as-of pinning", () => {
  it("pins rateAsOf whenever a risk-free rate is returned", async () => {
    const snapshot = await getSnapshot("symbol=ASIANPAINT&provider=manual&fallbackPrice=3450&fallbackRiskFreeRate=0.07");
    expect(snapshot.riskFreeRate).toBe(0.07);
    expect(snapshot.rateAsOf).toBeTruthy();
    expect(snapshot.price).toBe(3450);
    expect(snapshot.priceAsOf).toBeTruthy();
    expectAsOfPairing(snapshot);
  });

  it("leaves both dates null when neither value is present", async () => {
    const snapshot = await getSnapshot("symbol=ASIANPAINT&provider=manual");
    expect(snapshot.price).toBeNull();
    expect(snapshot.priceAsOf).toBeNull();
    expect(snapshot.riskFreeRate).toBeNull();
    expect(snapshot.rateAsOf).toBeNull();
  });

  it("pins a date for a value present without its counterpart", async () => {
    const rateOnly = await getSnapshot("symbol=ASIANPAINT&provider=manual&fallbackRiskFreeRate=0.07");
    expect(rateOnly.rateAsOf).toBeTruthy();
    expect(rateOnly.priceAsOf).toBeNull();
    expectAsOfPairing(rateOnly);

    const priceOnly = await getSnapshot("symbol=ASIANPAINT&provider=manual&fallbackPrice=3450");
    expect(priceOnly.priceAsOf).toBeTruthy();
    expect(priceOnly.rateAsOf).toBeNull();
    expectAsOfPairing(priceOnly);
  });

  it("holds the invariant for an unsupported provider", async () => {
    const snapshot = await getSnapshot("symbol=ASIANPAINT&provider=alphavantage&fallbackRiskFreeRate=0.07");
    expectAsOfPairing(snapshot);
    expect(snapshot.rateAsOf).toBeTruthy();
  });

  it("holds the invariant when no symbol is configured for a live provider", async () => {
    // This branch defaults riskFreeRate to 0.07 without a caller-supplied rate.
    const snapshot = await getSnapshot("provider=nse");
    expect(snapshot.riskFreeRate).toBe(0.07);
    expectAsOfPairing(snapshot);
  });
});

/**
 * A partial NSE payload must cost only the rows that are actually unusable.
 *
 * Both narrowing steps guard the same failure mode: something throws while
 * reading or sorting rows, `fetchNseHistory`'s catch turns the throw into `[]`,
 * and every valid observation beside the bad one is lost. The caller cannot tell
 * that from "NSE returned nothing", so the 52-week range and percentile silently
 * disappear instead of being computed from the rows that did arrive.
 */
describe("NSE history row narrowing", () => {
  const VALID = { CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: 3450.5 };

  it("keeps valid observations when a malformed element sits beside them", () => {
    // The regression: elements were cast, not narrowed, so reading
    // `row.CH_TIMESTAMP` off a null threw before any filter ran.
    const points = parseNseHistoryRows([
      VALID,
      null,
      "unexpected string row",
      42,
      ["nested", "array"],
      { CH_TIMESTAMP: "2026-07-23", CH_CLOSING_PRICE: 3402.15 },
    ]);
    expect(points).toHaveLength(2);
    expect(points.map(p => p.date)).toEqual(["2026-07-24", "2026-07-23"]);
  });

  it("drops a row whose timestamp is not a string rather than losing the series", () => {
    // `localeCompare` is a string method; a numeric timestamp satisfied the row
    // shape and threw at sort time.
    const points = parseNseHistoryRows([VALID, { CH_TIMESTAMP: 20260723, CH_CLOSING_PRICE: 3402.15 }]);
    expect(points).toEqual([{ date: "2026-07-24", close: 3450.5 }]);
  });

  it("drops rows with no usable close but keeps their neighbours", () => {
    const points = parseNseHistoryRows([
      VALID,
      { CH_TIMESTAMP: "2026-07-23" },
      { CH_TIMESTAMP: "2026-07-22", CH_CLOSING_PRICE: "not-a-number" },
      { CH_TIMESTAMP: "", CH_CLOSING_PRICE: 3400 },
    ]);
    expect(points).toEqual([{ date: "2026-07-24", close: 3450.5 }]);
  });

  it("sorts newest first regardless of payload order", () => {
    const points = parseNseHistoryRows([
      { CH_TIMESTAMP: "2026-07-22", CH_CLOSING_PRICE: 3400 },
      { CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: 3450.5 },
      { CH_TIMESTAMP: "2026-07-23", CH_CLOSING_PRICE: 3402.15 },
    ]);
    expect(points.map(p => p.date)).toEqual(["2026-07-24", "2026-07-23", "2026-07-22"]);
  });

  it("reads the alternate field names NSE also serves", () => {
    const points = parseNseHistoryRows([{ TIMESTAMP: "2026-07-24", CLOSE_PRICE: "3450.50" }]);
    expect(points).toEqual([{ date: "2026-07-24", close: 3450.5 }]);
  });

  it("returns empty for a payload that is not an array", () => {
    for (const notAnArray of [undefined, null, {}, "", "rows", 0, { data: [VALID] }]) {
      expect(parseNseHistoryRows(notAnArray)).toEqual([]);
    }
  });
});

/**
 * A close price the feed never reported must not become a traded zero.
 *
 * Distinct from the narrowing above: that guards against losing real rows, this
 * guards against inventing a fake one. `Number("")`, `Number(null)`,
 * `Number("  ")` and `Number([])` are all `0`, so a blank close used to arrive as
 * a real observation at zero — which `Math.min` then makes the 52-week low, the
 * UI renders as `₹0.00` (RunInspector.tsx:297, SignalEngineSection.tsx:78), and
 * `summarizeHistory`'s own `low52 > 0` guard rejects, silently blanking
 * `distanceFrom52WeekLowPct` with no stated reason.
 *
 * Not a valuation defect: the percentile only selects narrative text in
 * `buildRegimeContext` (regimeModel.ts:11-15), and `discountRateAdjustment`
 * depends solely on the risk-free rate. It misreports a price, not a discount
 * rate.
 */
describe("NSE close-price screening", () => {
  // Each label records what this raw value produced before the screen. Measured
  // against the real function, not hypothesised.
  const COERCED_TO_A_NUMBER: [string, unknown][] = [
    ["an empty string (was 0)", ""],
    ["a whitespace-only string (was 0)", "   "],
    ["an empty array (was 0)", []],
    ["boolean true (was 1)", true],
    ["a negative price (was -5)", -5],
    ["an explicit zero", 0],
  ];

  it.each(COERCED_TO_A_NUMBER)(
    "rejects %s rather than reporting it as a trade",
    (_label, raw) => {
      expect(parseNseHistoryRows([{ CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: raw }])).toEqual([]);
    },
  );

  /**
   * `null` — the ordinary JSON encoding for a missing value — reaches the
   * coercion only in the alternate field position, and the asymmetry is
   * invisible from the call site.
   *
   * `CH_CLOSING_PRICE: null` alone was already rejected, but incidentally rather
   * than deliberately: `??` fell through to an absent `CLOSE_PRICE`, and
   * `Number(undefined)` is `NaN` where `Number(null)` is `0`. `CLOSE_PRICE: null`
   * on its own did produce a zero, because `undefined ?? null` is `null`. All
   * three positions are pinned so a later simplification of the chain cannot
   * quietly restore the zero.
   */
  it("rejects a null close in every field position", () => {
    const day = "2026-07-24";
    expect(parseNseHistoryRows([{ CH_TIMESTAMP: day, CLOSE_PRICE: null }])).toEqual([]);
    expect(parseNseHistoryRows([{ CH_TIMESTAMP: day, CH_CLOSING_PRICE: null }])).toEqual([]);
    expect(parseNseHistoryRows([{ CH_TIMESTAMP: day, CH_CLOSING_PRICE: null, CLOSE_PRICE: null }])).toEqual([]);
  });

  it("keeps a blank close from hiding a usable alternate field", () => {
    // `CH_CLOSING_PRICE ?? CLOSE_PRICE` stopped at "" — not nullish — and never
    // reached the real value beside it. Screening each field separately recovers
    // this row instead of scoring it zero.
    const points = parseNseHistoryRows([
      { CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: "", CLOSE_PRICE: 3450.5 },
    ]);
    expect(points).toEqual([{ date: "2026-07-24", close: 3450.5 }]);
  });

  it("does not let one blank close become the 52-week low of the series", () => {
    const points = parseNseHistoryRows([
      { CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: 3450.5 },
      { CH_TIMESTAMP: "2026-07-23", CH_CLOSING_PRICE: null },
      { CH_TIMESTAMP: "2026-07-22", CH_CLOSING_PRICE: 3402.15 },
    ]);
    expect(points.map(p => p.close)).toEqual([3450.5, 3402.15]);
    expect(Math.min(...points.map(p => p.close!))).toBe(3402.15);
  });

  it("still accepts a legitimately small price", () => {
    // The screen rejects non-positive, not sub-rupee: penny scrips are real.
    const points = parseNseHistoryRows([{ CH_TIMESTAMP: "2026-07-24", CH_CLOSING_PRICE: 0.05 }]);
    expect(points).toEqual([{ date: "2026-07-24", close: 0.05 }]);
  });
});
