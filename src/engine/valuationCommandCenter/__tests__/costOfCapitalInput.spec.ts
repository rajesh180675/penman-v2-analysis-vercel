import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCapitalineZip } from "../../capitalineParser";
import { processCompanyDataFull } from "../../pipeline";
import { ACTIVE_MARKET_PACKS } from "../../marketPacks";
import { DEFAULT_CONFIG, type RecastPeriod } from "../../types";
import { INRAbsolute } from "../../types/units";
import type { CostOfCapitalResult } from "../../costOfCapital";
import type { LiveMarketDataSnapshot } from "../../marketData";
import { buildValuationCommandCenter } from "../core";

// Asian Paints: an industrial anchor whose capital cost the pack resolves.
const FOLDER = "Asian Paints";
const CONFIG = { ...DEFAULT_CONFIG, market_price: INRAbsolute(2400) };
let data: RecastPeriod[];

beforeAll(async () => {
  const buf = readFileSync(join(process.cwd(), "public", "data", "companies", FOLDER, `${FOLDER}.zip`));
  const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: FOLDER });
  data = processCompanyDataFull(parsed.periods, CONFIG).periods;
}, 120_000);

describe("command center cost of capital", () => {
  it("resolves its own when none is supplied, and values the same when handed that one", () => {
    const own = buildValuationCommandCenter({ data, config: CONFIG, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-10-30" });
    const handed = buildValuationCommandCenter({ data, config: CONFIG, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-10-30", costOfCapital: own.costOfCapital });
    expect(handed.costOfCapital).toEqual(own.costOfCapital);
    expect(handed.scenarios.map((card) => card.intrinsicPerShare)).toEqual(own.scenarios.map((card) => card.intrinsicPerShare));
  });

  it("discounts at the cost of capital it is handed", () => {
    const own = buildValuationCommandCenter({ data, config: CONFIG, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-10-30" });
    const higher: CostOfCapitalResult = { ...own.costOfCapital, ke: own.costOfCapital.ke + 0.02 };
    const handed = buildValuationCommandCenter({ data, config: CONFIG, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-10-30", costOfCapital: higher });
    expect(handed.costOfCapital.ke).toBe(higher.ke);
    const base = (cc: typeof own) => cc.scenarios.find((card) => card.key === "base")!.intrinsicPerShare!;
    expect(base(handed)).toBeLessThan(base(own));
  });

  it("values each earlier anchor of the backtest at that anchor's own cost of capital, not the one handed in", () => {
    // A daily close for every day of the library's span, so every anchor has a price.
    const first = Date.parse(`${data[0]!.period_end}T00:00:00Z`);
    const last = Date.parse("2026-10-29T00:00:00Z");
    const points = [];
    for (let time = first; time <= last; time += 86_400_000) points.push({ date: new Date(time).toISOString().slice(0, 10), close: 2400 });
    const marketData: LiveMarketDataSnapshot = {
      symbol: "ASIANPAINT", provider: "spec", fetchedAt: "2026-10-30T00:00:00Z", price: 2400, previousClose: 2400, changePct: 0,
      marketCap: null, enterpriseValue: null, sharesOutstanding: null, riskFreeRate: null, priceAsOf: "2026-10-29", rateAsOf: null,
      freshness: "live", sourceSummary: "spec", warnings: [],
      history: { points, currentPricePercentile: null, low52Week: null, high52Week: null, distanceFrom52WeekLowPct: null, drawdownFrom52WeekHighPct: null },
    };
    const context = { data, config: CONFIG, marketData, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-10-30" };
    const own = buildValuationCommandCenter(context);
    // A cost of capital no earlier anchor resolves: had the backtest inherited
    // it, its earlier anchors' values would move.
    const handed = buildValuationCommandCenter({ ...context, costOfCapital: { ...own.costOfCapital, ke: own.costOfCapital.ke + 0.05 } });
    expect(own.backtest.available).toBe(true);
    expect(own.backtest.points.length).toBeGreaterThan(1);
    expect(handed.backtest.points).toEqual(own.backtest.points);
  });
});
