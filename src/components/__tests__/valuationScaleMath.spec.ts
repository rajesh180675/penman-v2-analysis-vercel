/* ================================================================
   Four chart values were 1e7× too large; these are the two that only
   needed rescaling. (The SOTP radar spoke also needed an
   enterprise→equity bridge at the anchor period, so it moved into the
   engine — see `sotpEquityPerShare` in valuationCommandCenter/helpers.ts
   and its spec in engine/__tests__/sotpEquityPerShare.spec.ts.)

   `AnchorAnalysisGrid` computed per-share values as
   `(equityCr / sharesCr) * 1e7`, and `ComparisonReport` computed a "P/B"
   axis as `(price * sharesCr * 1e7) / cseCr`. Both operands are
   crore-denominated on every path, so each quotient was already correct
   before the factor:

     - `config.shares_outstanding` is typed `CroreShares`
       (engine/types/config.ts), and `resolveShareBasis` wraps the derived
       count in `CroreShares(...)` (shareCountTools.ts).
     - `deriveShareCount` documents every field "(Cr)", and its own
       face-value proxy divides ₹Cr equity by a rupee face value, then
       sanity-checks `fallbackVPrimary / shares` against a ₹1–₹100,000
       per-share band (v3Analytics/shareCount.ts).
     - The peer table's share input column header reads "Shares (Cr)",
       and the NSE fetch divides its absolute count by 1e7.

   Every other per-share site in the engine omits the factor — including
   `grahamDoddEPV.ts` and `sotpValueRange`, which divide by the *same*
   `shareBasis.shares`. `marketCapCroreFromPrice` exists specifically to
   document that this conversion must not be applied twice
   (engine/types/units.ts).

   The tornado is the case no reading of `shares` can rescue: it received
   `baseValue = intrinsicPerShare` (a bare quotient) alongside drivers
   carrying the factor, and differences the two (ForecastTornado.tsx).
================================================================ */

import { describe, expect, it } from "vitest";
import { priceToBook, rePerpetuityPerShare } from "../valuationScaleMath";
import { CroreShares, INRAbsolute, marketCapCroreFromPrice } from "../../engine/types/units";

/* A mid-cap on Capitaline's scale: ₹12,000 Cr book equity, 120 Cr shares.
   Book value per share is therefore exactly ₹100 — anything that plots in
   the crores has lost the unit. */
const CSE = 12_000;
const SHARES = 120;

describe("rePerpetuityPerShare", () => {
  it("returns rupees per share, not rupees", () => {
    // RNOA == ke, so the residual term vanishes and the value is just
    // CSE/shares = ₹100. This is the assertion the ×1e7 broke: it produced
    // ₹1,000,000,000 per share for a company trading in the hundreds.
    const value = rePerpetuityPerShare({ cse: CSE, noa: 8_000, rnoa: 0.12, ke: 0.12, g: 0.04, shares: SHARES });
    expect(value).toBe(100);
  });

  it("prices a positive spread above book value per share", () => {
    // (0.20 − 0.12) × 8000 / (0.12 − 0.04) = ₹8,000 Cr of franchise value.
    // (12000 + 8000) / 120 = ₹166.67.
    const value = rePerpetuityPerShare({ cse: CSE, noa: 8_000, rnoa: 0.20, ke: 0.12, g: 0.04, shares: SHARES });
    expect(value).toBeCloseTo(166.667, 3);
  });

  it("lands in a plausible rupee band for a real-scale input", () => {
    // The band `deriveShareCount` itself uses to pick a face value
    // (v3Analytics/shareCount.ts:171). A ×1e7 result fails it by construction,
    // so this is the scale-independent guard, not a restatement of the maths.
    const value = rePerpetuityPerShare({ cse: CSE, noa: 8_000, rnoa: 0.20, ke: 0.12, g: 0.04, shares: SHARES })!;
    expect(value).toBeGreaterThan(1);
    expect(value).toBeLessThan(100_000);
  });

  it("refuses a non-convergent perpetuity instead of returning a negative value", () => {
    // ke ≤ g flips the denominator's sign and the Gordon form is meaningless.
    expect(rePerpetuityPerShare({ cse: CSE, noa: 8_000, rnoa: 0.20, ke: 0.04, g: 0.04, shares: SHARES })).toBeNull();
    expect(rePerpetuityPerShare({ cse: CSE, noa: 8_000, rnoa: 0.20, ke: 0.03, g: 0.04, shares: SHARES })).toBeNull();
  });

  it("returns null rather than Infinity when the share basis is unusable", () => {
    for (const shares of [null, undefined, 0, -5, Number.NaN]) {
      expect(rePerpetuityPerShare({ cse: CSE, noa: 8_000, rnoa: 0.20, ke: 0.12, g: 0.04, shares })).toBeNull();
    }
  });
});

describe("priceToBook", () => {
  it("is dimensionless: a rupee price over crore shares needs no scaling", () => {
    // Book value per share is ₹100, so a ₹250 price is 2.5× book.
    expect(priceToBook(250, SHARES, CSE)).toBeCloseTo(2.5, 10);
  });

  it("agrees with the branded market-cap helper", () => {
    // Metamorphic: the numerator is exactly `marketCapCroreFromPrice`, whose
    // docblock is the standing warning against the ×1e7 removed here.
    const marketCapCr = marketCapCroreFromPrice(INRAbsolute(250), CroreShares(SHARES)) as number;
    expect(priceToBook(250, SHARES, CSE)).toBeCloseTo(marketCapCr / CSE, 10);
  });

  it("stays in multiple space for a real large-cap", () => {
    // Reliance-scale: ~₹1,400/share on ~677 Cr shares over ~₹8,00,000 Cr book.
    // Roughly 1.2× — a defensible P/B. The old expression returned ~1.2e7.
    const pb = priceToBook(1_400, 677, 800_000)!;
    expect(pb).toBeGreaterThan(0.1);
    expect(pb).toBeLessThan(100);
  });

  it("returns null for non-positive book equity instead of dividing by ₹1 Cr", () => {
    // The old code substituted 1 for a non-positive CSE, so a company that had
    // wiped out its book equity plotted at its market cap in crores.
    expect(priceToBook(250, SHARES, 0)).toBeNull();
    expect(priceToBook(250, SHARES, -500)).toBeNull();
  });

  it("returns null when price or share count is missing", () => {
    expect(priceToBook(null, SHARES, CSE)).toBeNull();
    expect(priceToBook(undefined, SHARES, CSE)).toBeNull();
    expect(priceToBook(0, SHARES, CSE)).toBeNull();
    expect(priceToBook(250, null, CSE)).toBeNull();
    expect(priceToBook(250, 0, CSE)).toBeNull();
    expect(priceToBook(250, SHARES, null)).toBeNull();
  });
});

describe("cross-helper unit consistency", () => {
  it("keeps a tornado driver differenceable against a bare per-share base", () => {
    // ForecastTornado subtracts `baseValue` (intrinsicPerShare, a bare
    // equity/shares quotient) from each driver. The difference has to be a
    // rupee swing per share, not 1e7 of them.
    const base = CSE / SHARES;
    const driver = rePerpetuityPerShare({ cse: CSE, noa: 8_000, rnoa: 0.20, ke: 0.12, g: 0.04, shares: SHARES })!;
    expect(driver - base).toBeCloseTo(66.667, 3);
  });
});
