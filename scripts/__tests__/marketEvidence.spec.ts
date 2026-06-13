/**
 * @vitest-environment node
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchMarketEvidence } from "../lib/auditCompanyRun";
import { marketCachePath, readJson, deleteFile } from "../../server/store/fsStore";

const today = new Date().toISOString().slice(0, 10);

function yahooUrl(symbol: string) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?interval=1d&range=5d`;
}

function mockYahooResponse(price = 1234.56) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      chart: {
        result: [
          {
            meta: {
              regularMarketPrice: price,
              regularMarketTime: Math.floor(Date.now() / 1000),
              chartPreviousClose: price * 0.99,
            },
          },
        ],
      },
    }),
  } as unknown as Response;
}

function mockFailedResponse(status = 404) {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response;
}

describe("fetchMarketEvidence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await deleteFile(marketCachePath("SHRIRAMFIN", today));
    await deleteFile(marketCachePath("UNKNOWN", today));
  });

  it("applies ticker parity when the registry ticker has drifted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === yahooUrl("SHRIRAMFIN")) return mockYahooResponse(954.95);
      return mockFailedResponse(404);
    });

    const result = await fetchMarketEvidence("SHRIRAMFINAN", "Shriram Finance");

    expect(fetchSpy).toHaveBeenCalledWith(yahooUrl("SHRIRAMFIN"), expect.any(Object));
    expect(result.status).toBe("fresh");
    expect(result.inputs.length).toBeGreaterThan(0);
    expect(result.inputs[0]?.value).toBe(954.95);
    expect(result.reason).toMatch(/Ticker parity: SHRIRAMFINAN → SHRIRAMFIN/);
  });

  it("writes a cached market snapshot after a successful fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === yahooUrl("SHRIRAMFIN")) return mockYahooResponse(954.95);
      return mockFailedResponse(404);
    });

    await fetchMarketEvidence("SHRIRAMFIN", "Shriram Finance");

    const cached = await readJson<ReturnType<typeof fetchMarketEvidence>>(marketCachePath("SHRIRAMFIN", today));
    expect(cached).not.toBeNull();
    expect(cached?.status).toBe("fresh");
    expect(cached?.inputs[0]?.value).toBe(954.95);
  });

  it("falls back to a cached snapshot when Yahoo is unreachable", async () => {
    const staleSnapshot = {
      status: "fresh" as const,
      inputs: [{ kind: "market-price" as const, source: "yahoo_finance", asOf: "2025-01-01T00:00:00.000Z", value: 800 }],
      reason: "Cached",
    };
    await deleteFile(marketCachePath("UNKNOWN", today));
    // Seed yesterday's cache so the offline path can find it.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);
    const cachePath = marketCachePath("UNKNOWN", yesterdayKey);
    const { writeJson } = await import("../../server/store/fsStore");
    await writeJson(cachePath, staleSnapshot);

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    const result = await fetchMarketEvidence("UNKNOWN");

    expect(result.status).toBe("stale");
    expect(result.inputs[0]?.value).toBe(800);
    expect(result.reason).toMatch(/serving cached market snapshot/);

    await deleteFile(cachePath);
  });

  it("returns source_unavailable when there is no live or cached data", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    const result = await fetchMarketEvidence("UNKNOWN");

    expect(result.status).toBe("source_unavailable");
    expect(result.inputs.length).toBe(0);
    expect(result.reason).toMatch(/Market data fetch failed/);
  });
});
