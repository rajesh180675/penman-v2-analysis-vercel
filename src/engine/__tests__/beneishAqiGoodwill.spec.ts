import { describe, expect, it } from "vitest";
import { computeQuality } from "../PenmanNissimEngine/quality";
import type { RawPeriodData, RecastPeriod } from "../types";

/**
 * Beneish AQI goodwill-exclusion regression (#81b).
 *
 * Beneish AQI = [1 − (CurrentAssets + PP&E)/TA]_t / [...]_{t-1}. "Hard" assets
 * are PP&E + Current Assets; goodwill (a soft/intangible asset whose YoY growth
 * AQI is meant to FLAG) must NOT be in the hard bucket. The prior code included
 * cur.bs.Goodwill in hardAssets, which subtracted goodwill back out of the soft
 * bucket and inverted the signal — a goodwill build lowered AQI (looked cleaner).
 *
 * Fixture isolates the bucket change: PP&E, Current Assets and TA are constant
 * across both periods, only goodwill grows (prev 0 → cur 200, TA 1000).
 *   old (goodwill in hard): hardCur 700, hardPrev 500 → aqi = 0.30/0.50 = 0.60
 *   new (goodwill excluded): hardCur 500, hardPrev 500 → aqi = 0.50/0.50 = 1.00
 * AQI = 1.00 is the correct neutral reading: hard-asset share is unchanged, so
 * there is no soft-asset-growth signal to report.
 */

// Minimal RecastPeriod — computeQuality reads many fields, but beneish_aqi
// depends ONLY on bs.{PPE, CurrentAssets, TA}. Other reads resolve to 0 against
// the empty raw_metric_values, which cannot affect the AQI ratio under test.
function mkPeriod(goodwill: number): RecastPeriod {
  return {
    period_end: "2025-03-31",
    bs: {
      TA: 1000, CSE: 600, MI: 0, FA: 150, FO: 150, OA: 850, OL: 250,
      NOA: 600, NFO: 0,
      PPE: 200, Goodwill: goodwill, CurrentAssets: 300, CurrentLiabilities: 150,
      Inventory: 90, TradeReceivables: 110, TradePayables: 80, LIFO_reserve: 0,
    },
    is: {
      Sales: 900, COGS: 600, PAT: 90, FinanceCost: 12, OI: 100, taxRate: 0.25,
    },
    cf: { CFO: 120, Capex: 40, EquityIssued: 0, ShareBuybacks: 0 },
    cu: { ExceptionalItemsAfterTax: 0 },
  } as unknown as RecastPeriod;
}

function mkRaw(): RawPeriodData {
  return {
    company_id: "test",
    period_end: "2025-03-31",
    raw_metric_values: {},
  } as unknown as RawPeriodData;
}

describe("Beneish AQI excludes goodwill from the hard-asset bucket", () => {
  it("reports a neutral AQI (≈1.0) when only goodwill grows and hard assets are flat", () => {
    const cur = mkPeriod(200); // goodwill build
    const prev = mkPeriod(0);
    const q = computeQuality(cur, prev, mkRaw(), mkRaw());

    // New (correct) reading: hard-asset share unchanged → AQI = 1.0.
    expect(q.beneish_aqi).toBeCloseTo(1.0, 6);
    // Guard against the old goodwill-in-hard form, which produced 0.60.
    expect(q.beneish_aqi).not.toBeCloseTo(0.6, 2);
  });
});
