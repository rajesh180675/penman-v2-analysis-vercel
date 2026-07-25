import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import marketDataRouter from "./marketData";

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
