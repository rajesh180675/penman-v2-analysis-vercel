/** @vitest-environment jsdom */

/* ================================================================
   The classic shell's quote carries today's share count.

   The price is per share of today's count. NSE's quote API refuses
   the request, so the snapshot reports no count, and until the next
   UI's run filled it from the latest filing (#450) the classic shell
   still set Nestlé's value per pre-bonus share against a price per
   post-bonus share. Both shells now fill it the same way.
================================================================ */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveMarketData } from "../useLiveMarketData";
import type { LiveMarketDataSnapshot } from "../../engine/marketData";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const quote: LiveMarketDataSnapshot = {
  symbol: "NESTLEIND", provider: "NSE India", fetchedAt: "2026-10-13T10:00:00.000Z", price: 1450, previousClose: 1440, changePct: 0.7,
  marketCap: null, enterpriseValue: null, sharesOutstanding: null, riskFreeRate: null, priceAsOf: "2026-10-13",
  rateAsOf: null, freshness: "live", sourceSummary: "NSE", warnings: [], history: null,
};

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => { root!.unmount(); });
  root = null;
  vi.unstubAllGlobals();
});

async function snapshotFor(symbol: string): Promise<LiveMarketDataSnapshot | null> {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url.startsWith("/api/market-data/snapshot")
      ? { snapshot: quote }
      : [{ symbol: "NESTLEIND", latestFiling: { fiscalYearEnd: "2026-03-31", sharesOutstandingCr: 192.83 } }]),
  })));
  let seen: LiveMarketDataSnapshot | null = null;
  function Probe() {
    seen = useLiveMarketData({ provider: "nse", symbol }).snapshot;
    return null;
  }
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => { root!.render(<Probe />); });
  await act(async () => { await Promise.resolve(); });
  return seen;
}

describe("useLiveMarketData", () => {
  it("fills today's share count from the latest filing when the quote reports none", async () => {
    expect(await snapshotFor("NESTLEIND")).toMatchObject({
      price: 1450,
      sharesOutstanding: 192.83 * 1e7,
      sharesOutstandingSource: "the latest annual filing (2026-03-31)",
    });
  });

  it("leaves the count empty for a company the ledger does not hold", async () => {
    const snapshot = await snapshotFor("NOSUCH");
    expect(snapshot?.price).toBe(1450);
    expect(snapshot?.sharesOutstanding).toBeNull();
  });
});
