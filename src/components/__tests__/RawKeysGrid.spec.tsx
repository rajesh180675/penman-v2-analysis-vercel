/* ================================================================
   RawKeysGrid: sorting for display must not reorder the source.

   `debugInfo.rawMetricKeys.sort()` sorted IN PLACE. That array is the
   parser's own, held in app state, and `auditSnapshotTransport.ts:66`
   head-slices the same `debug.rawMetricKeys` into the persisted audit
   snapshot. So whether a reviewer happened to expand "Show all keys"
   before the snapshot was written decided whether the artifact
   captured the alphabetically-first keys or the parse-order-first
   ones — a UI expansion changing the content of a defensibility
   artifact.

   Two things these tests have to get right:

   - The sort runs only inside the `showAllKeys &&` branch, so a
     collapsed render cannot catch it. Every mutation test here
     renders expanded.
   - The expected order is a LITERAL. Comparing against the fixture
     factory would pass a mutant that sorts in place, because both
     sides would come out sorted.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RawKeysGrid } from "../debug/RawKeysGrid";
import type { CapitalineParseDebug } from "../../engine/capitalineParser";

/** Deliberately not in alphabetical order, or the sort would be invisible. */
const PARSE_ORDER = ["Sales", "Basic EPS", "Total Assets", "Advances"];

function mkDebug(overrides: Partial<CapitalineParseDebug> = {}): CapitalineParseDebug {
  return {
    companyId: "TEST",
    files: [],
    // Ascending, as `capitalineParser` emits it.
    detectedPeriods: ["2012-03-31", "2013-03-31", "2014-03-31"],
    sourceArtifactHashes: [],
    rawGrids: [],
    metrics: {
      totalCompositeKeys: 0,
      totalBaseKeys: PARSE_ORDER.length,
      baseKeyCollisions: [],
      byStatement: { BalanceSheet: 0, ProfitLoss: 0, CashFlow: 0, Segment: 0, Unknown: 0 },
    },
    warnings: [],
    sample: { firstRows: [] },
    rawMetricKeys: [...PARSE_ORDER],
    ...overrides,
  };
}

function render(debugInfo: CapitalineParseDebug, showAllKeys = true) {
  return renderToStaticMarkup(
    <RawKeysGrid
      debugInfo={debugInfo}
      showAllKeys={showAllKeys}
      setShowAllKeys={() => {}}
      setMetricSearch={() => {}}
    />,
  );
}

/** Key cells in render order. Only the key divs carry a `title`. */
function renderedKeys(html: string) {
  return [...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
}

describe("RawKeysGrid does not mutate the parser's array", () => {
  it("leaves the caller's array in parse order after an expanded render", () => {
    const debugInfo = mkDebug();
    render(debugInfo);
    expect(debugInfo.rawMetricKeys).toEqual([
      "Sales",
      "Basic EPS",
      "Total Assets",
      "Advances",
    ]);
  });

  it("survives repeated renders without drifting", () => {
    // An odd count on purpose: two in-place sorts of an already-sorted array
    // are indistinguishable from none, so a single re-render can hide the bug.
    const debugInfo = mkDebug();
    render(debugInfo);
    render(debugInfo);
    render(debugInfo);
    expect(debugInfo.rawMetricKeys[0]).toBe("Sales");
  });

  it("still displays the keys alphabetically", () => {
    // The copy has to be sorted, not merely copied — dropping the sort would
    // leave the grid in parse order and this is what notices.
    expect(renderedKeys(render(mkDebug()))).toEqual([
      "Advances",
      "Basic EPS",
      "Sales",
      "Total Assets",
    ]);
  });

  it("lists nothing while collapsed", () => {
    expect(renderedKeys(render(mkDebug(), false))).toEqual([]);
  });
});

describe("RawKeysGrid scope label", () => {
  it("names the period instead of calling it Period 1", () => {
    // Periods are date-ascending, so index 0 is the OLDEST year. Every other
    // surface here is newest-first, so "Period 1" read as the latest year.
    const html = render(mkDebug());
    expect(html).toContain("2012-03, oldest of 3 periods");
    expect(html).not.toContain("Period 1");
  });

  it("still reports the key count", () => {
    expect(render(mkDebug())).toContain("(4 keys)");
  });

  it("words a single period in the singular", () => {
    const html = render(mkDebug({ detectedPeriods: ["2014-03-31"] }));
    expect(html).toContain("2014-03, oldest of 1 period");
    expect(html).not.toContain("1 periods");
  });

  it("falls back to a wording that claims no date when none was detected", () => {
    // A failed parse still renders this card. Interpolating an absent period
    // would print "undefined, oldest of 0 periods".
    const html = render(mkDebug({ detectedPeriods: [] }));
    expect(html).toContain("the earliest period");
    expect(html).not.toContain("undefined");
  });
});
