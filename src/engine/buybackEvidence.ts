/**
 * Capitaline itemizes no buyback in the cash-flow statement, so a buyback's
 * cash leaves equity looking like dirty surplus. A buyback cancels shares,
 * though: shares outstanding fall in every library buyback year that trips
 * the dirty-surplus check (Infosys FY18/20/22/23/26, TCS FY18/21/22/24).
 * A bonus issue in the same year hides it (TCS FY19: shares +96%).
 */
export function sharesOutstandingFell(
  previous: number | null | undefined,
  current: number | null | undefined,
): boolean {
  return previous != null && current != null && previous > 0 && current > 0
    && current < previous * 0.999;
}
