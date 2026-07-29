/**
 * How many of each lineage list `StatementLineagePanel` has room for.
 *
 * Named rather than inline because each one is half of a claim: the panel must
 * also say how many it left out, and the two numbers have to come from the same
 * place or the note can drift from the list it describes.
 */
export const VERSIONS_SHOWN = 6;
export const CANDIDATES_SHOWN = 4;
export const SEGMENT_HINTS_SHOWN = 12;

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
 * a nine-filing history looked complete.
 *
 * Takes the list in the order it should be displayed and does not sort. Ordering
 * is a claim about relevance and belongs at the call site, where the reader can
 * see which end was kept — the same `slice(0, 6)` was also taking the *oldest*
 * six, because `buildStatementLineage` preserves the parser's ascending period
 * order and nothing at the call site said so.
 */
export function capped<T>(items: T[], limit: number): CappedList<T> {
  return {
    shown: items.slice(0, limit),
    hidden: Math.max(0, items.length - limit),
  };
}
