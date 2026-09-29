/**
 * RE and ReOI value the same forecast: one discounts residual earnings at ke,
 * the other residual operating income at kw. On a recast that closes and a kw
 * consistent with ke they agree, so beyond a few percent the gap is a recast
 * or discount-rate inconsistency, not a matter of opinion. One measure and one
 * pair of thresholds, shared by PVRE's per-draw gate and the rigor ladder.
 */
export const RE_REOI_GUARD_GAP = 0.10;
export const RE_REOI_BLOCK_GAP = 0.25;

/** |RE − ReOI| over the mean of their magnitudes; null when both are zero. */
export function reReoiGap(re: number, reoi: number): number | null {
  const scale = (Math.abs(re) + Math.abs(reoi)) / 2;
  return scale > 0 ? Math.abs(re - reoi) / scale : null;
}
