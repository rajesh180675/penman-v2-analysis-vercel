/* ================================================================
   The SOTP radar spoke was an enterprise value on a per-share axis.

   `AnchorAnalysisGrid` plotted `(sotp.discountedSum / shares) * 1e7` beside
   four post-bridge equity anchors, normalized against the market price.
   Two defects in one expression:

     1. `discountedSum` is the sum of segment *operating* values after the
        conglomerate discount — a whole-entity figure. A share price is an
        equity claim, so it needs the −NFO bridge `sotpValueRange` already
        applied to the identical quantity.
     2. ₹Cr ÷ Cr-shares is already ₹/share, so the ×1e7 put it 1e7× out.

   The bridge lives here, not in the component, because the NFO it must
   pair with belongs to the *anchor* period — which `resolveValuationReadiness`
   moves off the newest period when the terminal one is contaminated
   (valuationPolicy.ts:145-166). A surface cannot resolve that, so pairing
   this sum with `data[data.length - 1]`'s net debt would mix vintages on
   exactly the guarded runs a reviewer looks hardest at.
================================================================ */

import { describe, expect, it } from "vitest";
import { sotpEquityPerShare, sotpValueRange } from "../valuationCommandCenter/helpers";
import { DEFAULT_CONFIG } from "../types";
import type { SOTPResult } from "../sotpValuation";
import type { resolveShareBasis } from "../shareCountTools";

/* ₹30,000 Cr of segment value discounted to ₹27,000 Cr, over 120 Cr shares. */
function sotp(overrides: Partial<SOTPResult> = {}): SOTPResult {
  return {
    segments: [],
    operatingSum: 30_000,
    conglomerateDiscountPct: 0.1,
    discountedSum: 27_000,
    unallocatedNOA: 0,
    totalEnterpriseValue: 27_000,
    explanation: [],
    ...overrides,
  };
}

function basis(shares: number | null): ReturnType<typeof resolveShareBasis> {
  return {
    sharesForPerShare: shares,
    sharesForMarketCap: shares,
    shares,
    source: "test",
    sourceForMarketCap: "test",
    confidence: "HIGH",
    valuationConfig: DEFAULT_CONFIG,
  };
}

describe("sotpEquityPerShare", () => {
  it("bridges enterprise value to equity before dividing", () => {
    // (27,000 − 6,000) / 120 = ₹175. Unbridged it is ₹225 — a 29% overstated
    // spoke, and the overstatement is exactly the leverage the comparison
    // against an equity price is supposed to expose.
    expect(sotpEquityPerShare(sotp(), basis(120), 6_000)).toBe(175);
    expect(sotpEquityPerShare(sotp(), basis(120), 0)).toBe(225);
  });

  it("adds back a net cash position", () => {
    // NFO is negative for a net-cash company, so the bridge raises the value.
    expect(sotpEquityPerShare(sotp(), basis(120), -6_000)).toBe(275);
  });

  it("returns rupees per share, not rupees", () => {
    // The ×1e7 this replaces produced ₹1.75 billion per share. Anything
    // outside the band `deriveShareCount` itself sanity-checks against
    // (v3Analytics/shareCount.ts:171) has lost the unit.
    const value = sotpEquityPerShare(sotp(), basis(120), 6_000)!;
    expect(value).toBeGreaterThan(1);
    expect(value).toBeLessThan(100_000);
  });

  it("returns null rather than Infinity when the share basis is unusable", () => {
    expect(sotpEquityPerShare(sotp(), basis(null), 6_000)).toBeNull();
    expect(sotpEquityPerShare(sotp(), basis(0), 6_000)).toBeNull();
    expect(sotpEquityPerShare(sotp(), basis(-5), 6_000)).toBeNull();
  });

  it("can go negative when net debt exceeds the discounted sum", () => {
    // A real signal, not an error: the segments do not cover the borrowings.
    // Must not be clamped to 0, or an insolvent conglomerate reads as merely
    // worthless. FrameworkRadar drops non-positive anchors itself (:30).
    expect(sotpEquityPerShare(sotp(), basis(120), 30_000)).toBe(-25);
  });

  it("is the same quantity sotpValueRange reports as its floor", () => {
    // One definition, two consumers — the radar spoke and the value range
    // must not be able to drift apart.
    const range = sotpValueRange(sotp(), basis(120), 6_000);
    expect(range.floorPerShare).toBe(sotpEquityPerShare(sotp(), basis(120), 6_000));
  });

  it("sits at or below the range ceiling, which drops the discount", () => {
    // Ceiling uses operatingSum (no conglomerate discount), so the bridged
    // discounted value is the floor of the two.
    const range = sotpValueRange(sotp(), basis(120), 6_000);
    expect(range.ceilingPerShare).toBe(200);
    expect(range.floorPerShare!).toBeLessThan(range.ceilingPerShare!);
  });
});
