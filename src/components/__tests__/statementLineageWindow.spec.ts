/* ================================================================
   The lineage panel's window sizes.

   `capped` itself moved to ../cappedList once other surfaces needed
   it; its behaviour is pinned in cappedList.spec.ts. What is left
   here is the three limits, which only have to be usable.
================================================================ */

import { describe, expect, it } from "vitest";
import {
  CANDIDATES_SHOWN,
  SEGMENT_HINTS_SHOWN,
  VERSIONS_SHOWN,
} from "../statementLineageWindow";

describe("lineage window sizes", () => {
  it("are positive, so each list renders at least one item", () => {
    expect(VERSIONS_SHOWN).toBeGreaterThan(0);
    expect(CANDIDATES_SHOWN).toBeGreaterThan(0);
    expect(SEGMENT_HINTS_SHOWN).toBeGreaterThan(0);
  });
});
