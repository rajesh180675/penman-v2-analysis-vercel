/* ================================================================
   The display window helper behind StatementLineagePanel.

   `capped` exists because `.slice(0, n)` on its own discards the
   number a reader needs to know they are looking at a subset. These
   pin the two halves it returns and the one thing it deliberately
   does not do, which is reorder.
================================================================ */

import { describe, expect, it } from "vitest";
import {
  capped,
  CANDIDATES_SHOWN,
  SEGMENT_HINTS_SHOWN,
  VERSIONS_SHOWN,
} from "../statementLineageWindow";

describe("capped", () => {
  it("keeps the head of the list and counts what it dropped", () => {
    const result = capped(["a", "b", "c", "d", "e"], 3);
    expect(result.shown).toEqual(["a", "b", "c"]);
    expect(result.hidden).toBe(2);
  });

  it("reports nothing hidden when everything fits", () => {
    expect(capped(["a", "b"], 6).hidden).toBe(0);
  });

  it("reports nothing hidden when the list is exactly the limit", () => {
    // The off-by-one that would make a complete list claim "+0 more".
    const result = capped(["a", "b", "c"], 3);
    expect(result.shown).toHaveLength(3);
    expect(result.hidden).toBe(0);
  });

  it("never reports a negative hidden count", () => {
    // `items.length - limit` unclamped would render "+-4 more".
    expect(capped(["a", "b"], 6).hidden).toBe(0);
  });

  it("handles an empty list", () => {
    expect(capped([], 6)).toEqual({ shown: [], hidden: 0 });
  });

  it("does not reorder, so the caller's ordering decision is the one displayed", () => {
    // The defect this helper was extracted for was an ordering one: the panel
    // sliced the head of an ascending-by-period list and showed the oldest six
    // filings of fifteen. Reversal has to stay visible at the call site, where a
    // reader can see which end was kept, so `capped` must not sort.
    expect(capped(["2026", "2025", "2024"], 2).shown).toEqual(["2026", "2025"]);
    expect(capped(["2024", "2025", "2026"], 2).shown).toEqual(["2024", "2025"]);
  });

  it("does not mutate the list it was given", () => {
    const items = ["a", "b", "c"];
    capped(items, 1);
    expect(items).toEqual(["a", "b", "c"]);
  });
});

describe("window sizes", () => {
  it("are positive, so each list renders at least one item", () => {
    expect(VERSIONS_SHOWN).toBeGreaterThan(0);
    expect(CANDIDATES_SHOWN).toBeGreaterThan(0);
    expect(SEGMENT_HINTS_SHOWN).toBeGreaterThan(0);
  });
});
