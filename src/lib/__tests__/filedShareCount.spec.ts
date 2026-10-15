import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFiledShareCount, withFiledShareCount } from "../filedShareCount";
import type { LiveMarketDataSnapshot } from "../../engine/marketData";

const quote: LiveMarketDataSnapshot = {
  symbol: "NESTLEIND", provider: "NSE India", fetchedAt: "2026-10-13T10:00:00.000Z", price: 1450, previousClose: 1440, changePct: 0.7,
  marketCap: null, enterpriseValue: null, sharesOutstanding: null, riskFreeRate: null, priceAsOf: "2026-10-13",
  rateAsOf: null, freshness: "live", sourceSummary: "NSE", warnings: [], history: null,
};
const filed = { fiscalYearEnd: "2026-03-31", sharesOutstandingCr: 192.83 };

describe("withFiledShareCount", () => {
  it("fills today's count from the latest filing when the quote reports none, and says so", () => {
    expect(withFiledShareCount(quote, filed)).toMatchObject({
      price: 1450,
      sharesOutstanding: 192.83 * 1e7,
      sharesOutstandingSource: "the latest annual filing (2026-03-31)",
    });
  });

  it("keeps the quote's own count, and passes a missing quote or filing through", () => {
    const counted = { ...quote, sharesOutstanding: 96.42 * 1e7 };
    expect(withFiledShareCount(counted, filed)).toBe(counted);
    expect(withFiledShareCount(quote, null)).toBe(quote);
    expect(withFiledShareCount(null, filed)).toBeNull();
  });
});

describe("fetchFiledShareCount", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the as-filed ledger once and finds the symbol's latest filing", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { symbol: "NESTLEIND", latestFiling: { fiscalYearEnd: "2026-03-31", sharesOutstandingCr: 192.83 } },
        { symbol: "LICI", latestFiling: { fiscalYearEnd: "2026-03-31", sharesOutstandingCr: null } },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchFiledShareCount("NESTLEIND")).toEqual(filed);
    // A filing without a count and an unknown symbol give none.
    expect(await fetchFiledShareCount("LICI")).toBeNull();
    expect(await fetchFiledShareCount("NOSUCH")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
