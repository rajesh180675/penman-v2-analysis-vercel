/**
 * The basis of a per-share value shown away from the price. The Forecast and
 * Valuation sections value at the valuation date (the anchor year-end), per
 * share of that date's count; the Verdict carries values to the price's date
 * and spreads them over today's count (#448, #450). Without saying so the two
 * read as one figure that disagrees with itself (Nestlé's base case: ₹743 here,
 * ₹410 beside the price after its 1:1 bonus).
 */
export function valuationDateNote(cc: {
  readonly marketPrice: number | null;
  readonly anchorPeriod: { readonly period_end: string };
  readonly marketContext: {
    readonly priceDate: string | null;
    readonly yearsToPriceDate: number;
    readonly sharesAtValuationDate: number | null;
    readonly sharesAtPriceDate: number | null;
    readonly shareCountChange: number | null;
  };
}): string | null {
  const m = cc.marketContext;
  if (cc.marketPrice == null) return null;
  const carried = m.yearsToPriceDate > 0 && m.priceDate != null;
  const respread = m.shareCountChange != null && Math.abs(m.shareCountChange - 1) >= 0.01 && m.sharesAtPriceDate != null;
  if (!carried && !respread) return null;
  const onShares = m.sharesAtValuationDate != null ? `, on that date's ${m.sharesAtValuationDate.toFixed(2)} crore shares` : "";
  const how = [
    carried ? `carries values to the price's date, ${m.priceDate}` : null,
    respread ? `spreads them over today's ${m.sharesAtPriceDate!.toFixed(2)} crore shares` : null,
  ].filter(Boolean).join(" and ");
  return `Per share at the valuation date, ${cc.anchorPeriod.period_end}${onShares}. Beside the price the Verdict ${how}, so its figures differ from these.`;
}
