/**
 * A demerger distributes a business to owners, so the equity it takes leaves
 * outside earnings and payout and reads as dirty surplus, as an un-itemized
 * buyback does. The year files the business as a discontinued operation, and
 * the restated prior year files it again as its comparative. That comparative
 * is the business's share of the group's operating income: when it is small,
 * the history a forecast reads is the continuing business's, and the closing
 * book is already the post-demerger one, so the year can anchor.
 *
 * ITC FY25 (ITC Hotels): equity fell ₹21,614 Cr short of earnings less
 * payout, beside ₹15,016 Cr of discontinued profit; the FY24 comparative's
 * ₹561 Cr is 2.5% of that year's operating income. No other library year
 * pairs a critical negative dirty surplus with a discontinued operation.
 */
export const DEMERGED_SHARE_OF_OI_MAX = 0.10;

export interface DemergerEvidence {
  /** The demerged business's prior-year result as a share of the group's operating income. */
  readonly priorShareOfOI: number;
}

export function immaterialDemerger(params: {
  readonly dirtySurplus: number;
  readonly discontinuedAfterTax: number | null | undefined;
  readonly previousDiscontinuedAfterTax: number | null | undefined;
  readonly previousOI: number | null | undefined;
}): DemergerEvidence | null {
  const { dirtySurplus, discontinuedAfterTax, previousDiscontinuedAfterTax, previousOI } = params;
  if (!(dirtySurplus < 0)) return null;
  if (discontinuedAfterTax == null || !Number.isFinite(discontinuedAfterTax) || discontinuedAfterTax === 0) return null;
  // Without the restated comparative nothing shows how much of the history
  // left with the business, so the year stays a structural event.
  if (previousDiscontinuedAfterTax == null || !Number.isFinite(previousDiscontinuedAfterTax) || previousDiscontinuedAfterTax === 0) return null;
  if (previousOI == null || !Number.isFinite(previousOI) || previousOI <= 0) return null;
  const priorShareOfOI = Math.abs(previousDiscontinuedAfterTax) / previousOI;
  return priorShareOfOI <= DEMERGED_SHARE_OF_OI_MAX ? { priorShareOfOI } : null;
}
