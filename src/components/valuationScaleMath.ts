/* ================================================================
   Unit-scale arithmetic for the valuation charts.

   Extracted from AnchorAnalysisGrid and ComparisonReport so the numbers
   the charts plot can be asserted directly: SensitivityHeatmap,
   ForecastTornado and PeerScatterPlot all render through recharts'
   ResponsiveContainer, which measures to 0×0 under renderToStaticMarkup
   and emits no values at all.

   Unit contract — the operands are already crore-denominated on both
   sides, so these quotients are final and need NO further scaling:
     - balance-sheet and market-cap values are ₹ crore
       (the Capitaline recast convention, capitalineParser/cells.ts:19)
     - share counts are crore shares (`config.shares_outstanding` is
       `CroreShares`; `deriveShareCount` documents every field "(Cr)";
       the peer table's own column header reads "Shares (Cr)")
   Both call sites used to multiply by 1e7 — exactly the double
   conversion `marketCapCroreFromPrice` was written to warn against
   (engine/types/units.ts:96) — putting every plotted value 1e7× out.

   The fourth mis-scaled value, the SOTP radar spoke, is NOT here: it also
   needed an enterprise→equity bridge at the *anchor* period, which only
   the engine resolves. It ships as `commandCenter.sotpPerShare` via
   `sotpEquityPerShare` in valuationCommandCenter/helpers.ts.
================================================================ */

import { toPerShare } from "../engine/shareCountTools";

/**
 * Residual-earnings perpetuity, per share.
 *
 * equity = CSE + (RNOA − ke) × NOA / (ke − g), all in ₹ crore.
 * Returns null when the perpetuity does not converge (ke ≤ g) or the
 * share basis is unusable; a caller that wants a fallback supplies it.
 */
export function rePerpetuityPerShare(args: {
  cse: number;
  noa: number;
  rnoa: number;
  ke: number;
  g: number;
  shares: number | null | undefined;
}): number | null {
  const { cse, noa, rnoa, ke, g, shares } = args;
  if (ke <= g) return null;
  const equityCr = cse + ((rnoa - ke) * noa) / (ke - g);
  return toPerShare(equityCr, shares);
}

/**
 * Price-to-book from a rupee price and a crore share count.
 *
 * price (₹/share) × shares (Cr) is market cap in ₹ crore already — the
 * same unit as CSE — so the ratio is dimensionless. Null when any input
 * is missing or book equity is non-positive: a negative or zero CSE has
 * no meaningful multiple, and the old code substituted ₹1 Cr for it,
 * which turned an unmeasurable book value into a huge plotted one.
 */
export function priceToBook(
  price: number | null | undefined,
  shares: number | null | undefined,
  cseCr: number | null | undefined,
): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  if (shares == null || !Number.isFinite(shares) || shares <= 0) return null;
  if (cseCr == null || !Number.isFinite(cseCr) || cseCr <= 0) return null;
  return (price * shares) / cseCr;
}
