export interface CappedList<T> {
  shown: T[];
  /** How many were left out. 0 when everything fits. */
  hidden: number;
}

/**
 * The first `limit` items, plus the number of items that did not fit.
 *
 * Exists because `.slice(0, n)` on its own loses the one fact a reader needs to
 * calibrate what they are looking at. `StatementLineagePanel` rendered
 * `versions.slice(0, 6)` of 15 filings with no total anywhere on the surface, so
 * a nine-filing history looked complete. A capped *number* can look wrong to
 * someone who knows the domain; a capped *list* just looks like a short list,
 * and nothing on screen contradicts it.
 *
 * Takes the list in the order it should be displayed and does not sort. Ordering
 * is a claim about relevance and belongs at the call site, where the reader can
 * see which end was kept — the same `slice(0, 6)` was also taking the *oldest*
 * six, because `buildStatementLineage` preserves the parser's ascending period
 * order and nothing at the call site said so.
 *
 * Reverse a *copy* when the call site needs the other end. Several of these
 * lists arrive from a `useMemo`, so an in-place `reverse()` renders correctly
 * once and then flips on every later render of the same array.
 */
export function capped<T>(items: T[], limit: number): CappedList<T> {
  return {
    shown: items.slice(0, limit),
    hidden: Math.max(0, items.length - limit),
  };
}
