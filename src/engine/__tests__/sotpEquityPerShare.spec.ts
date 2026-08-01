/* ================================================================
   The SOTP radar spoke was an enterprise value on a per-share axis.

   `AnchorAnalysisGrid` plotted `(sotp.discountedSum / shares) * 1e7` beside
   four post-bridge equity anchors, normalized against the market price.
   Two defects in one expression:

     1. `discountedSum` is the sum of segment *operating* values after the
        conglomerate discount — a whole-entity figure. A share price is a
        *common* equity claim, so it needs the full enterprise→equity bridge:
        −NFO for net debt and −MI for the minorities' share of the consolidated
        subsidiaries (`NOA = CSE + NFO + MI`, identityTests.ts:180). The −NFO
        leg was already applied by `sotpValueRange` to the identical quantity;
        the −MI leg was missing from both.
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
    expect(sotpEquityPerShare(sotp(), basis(120), 6_000, 0)).toBe(175);
    expect(sotpEquityPerShare(sotp(), basis(120), 0, 0)).toBe(225);
  });

  it("subtracts minority interest, not just net debt", () => {
    // `NOA = CSE + NFO + MI` (identityTests.ts:180), so reaching *common* equity
    // needs both legs. With ₹1,200 Cr of minorities: (27,000 − 6,000 − 1,200)/120
    // = ₹165, against ₹175 when MI is ignored.
    //
    // The 6% gap is not the point — the sign of the error is. Consolidation pulls
    // a partly-owned subsidiary's full operating profit into the segment sums,
    // so a SOTP built on those segments always *overstates* the parent's claim
    // until MI comes out. And `sotpPreferred` fires on multi-segment
    // conglomerates (builders.ts:52/71), which are precisely the companies that
    // consolidate subsidiaries they do not wholly own.
    expect(sotpEquityPerShare(sotp(), basis(120), 6_000, 1_200)).toBe(165);
  });

  it("adds back a net cash position", () => {
    // NFO is negative for a net-cash company, so the bridge raises the value.
    expect(sotpEquityPerShare(sotp(), basis(120), -6_000, 0)).toBe(275);
  });

  it("returns rupees per share, not rupees", () => {
    // The ×1e7 this replaces produced ₹1.75 billion per share. Anything
    // outside the band `deriveShareCount` itself sanity-checks against
    // (v3Analytics/shareCount.ts:171) has lost the unit.
    const value = sotpEquityPerShare(sotp(), basis(120), 6_000, 0)!;
    expect(value).toBeGreaterThan(1);
    expect(value).toBeLessThan(100_000);
  });

  it("returns null rather than Infinity when the share basis is unusable", () => {
    expect(sotpEquityPerShare(sotp(), basis(null), 6_000, 0)).toBeNull();
    expect(sotpEquityPerShare(sotp(), basis(0), 6_000, 0)).toBeNull();
    expect(sotpEquityPerShare(sotp(), basis(-5), 6_000, 0)).toBeNull();
  });

  it("can go negative when net debt exceeds the discounted sum", () => {
    // A real signal, not an error: the segments do not cover the borrowings.
    // Must not be clamped to 0, or an insolvent conglomerate reads as merely
    // worthless. FrameworkRadar drops non-positive anchors itself (:30).
    expect(sotpEquityPerShare(sotp(), basis(120), 30_000, 0)).toBe(-25);
  });

  it("is the same quantity sotpValueRange reports as its floor", () => {
    // One definition, two consumers — the radar spoke and the value range
    // must not be able to drift apart. Asserted with MI non-zero so the two
    // cannot agree merely by both ignoring it.
    const range = sotpValueRange(sotp(), basis(120), 6_000, 1_200);
    expect(range.floorPerShare).toBe(sotpEquityPerShare(sotp(), basis(120), 6_000, 1_200));
    expect(range.floorPerShare).toBe(165);
  });

  it("sits at or below the range ceiling, which drops the discount", () => {
    // Ceiling uses operatingSum (no conglomerate discount) but the SAME bridge,
    // so the bridged discounted value is the floor of the two.
    const range = sotpValueRange(sotp(), basis(120), 6_000, 0);
    expect(range.ceilingPerShare).toBe(200);
    expect(range.floorPerShare!).toBeLessThan(range.ceilingPerShare!);
  });

  it("applies the minority bridge to the ceiling too", () => {
    // A ceiling that skipped MI would widen the published range at its top end
    // only — the asymmetry a reviewer reads as upside. (30,000 − 6,000 − 1,200)
    // / 120 = ₹190, not ₹200.
    const range = sotpValueRange(sotp(), basis(120), 6_000, 1_200);
    expect(range.ceilingPerShare).toBe(190);
  });

  it("returns null, not NaN, for both legs when the numerators are non-finite", () => {
    // The ceiling divides directly; the floor goes through `toPerShare`, which
    // rejects non-finite numerators. Before `ceilingPerShare` was routed through
    // the same helper, a NaN/Infinity from the segment sums or bridge legs
    // produced a `NaN` ceiling beside a `null` floor — and `!= null` is the guard
    // every range consumer uses, so the NaN passed through as a published point.
    const range = sotpValueRange(sotp({ operatingSum: NaN, discountedSum: NaN }), basis(120), 6_000, 1_200);
    expect(range.floorPerShare).toBeNull();
    expect(range.ceilingPerShare).toBeNull();
  });
});
