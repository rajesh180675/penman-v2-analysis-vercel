/* ================================================================
   searchableBaseKeys: what the metric search can find.

   The search filtered `debugInfo.rawMetricKeys`, built from
   `periods[0]` alone — the OLDEST year, since periods are
   date-ascending. A key that first appeared later was unfindable and
   the box answered "No metric keys match" for data present in
   `rawData`. Measured on Bajaj Finance: 75 of 1048 base keys, 7%.

   Fixtures here carry periods with DIFFERENT key sets. A fixture
   whose periods all share one key set cannot distinguish a union
   from a single-period read, so it would pin nothing.
================================================================ */

import { describe, expect, it } from "vitest";
import { searchableBaseKeys } from "../searchableKeys";
import type { CapitalineParseDebug } from "../../../engine/capitalineParser";
import type { RawPeriodData } from "../../../engine/types";

function period(period_end: string, values: Record<string, number | null>): RawPeriodData {
  return { company_id: "TEST", period_end, raw_metric_values: values };
}

function mkDebug(rawMetricKeys: string[]): CapitalineParseDebug {
  return {
    companyId: "TEST",
    files: [],
    detectedPeriods: [],
    sourceArtifactHashes: [],
    rawGrids: [],
    metrics: {
      totalCompositeKeys: 0,
      totalBaseKeys: rawMetricKeys.length,
      baseKeyCollisions: [],
      byStatement: { BalanceSheet: 0, ProfitLoss: 0, CashFlow: 0, Segment: 0, Unknown: 0 },
    },
    warnings: [],
    sample: { firstRows: [] },
    rawMetricKeys,
  };
}

describe("searchableBaseKeys unions across periods", () => {
  it("finds a key that only exists in a later period", () => {
    // The defect in one assertion: "Gold Loans" appears in 2025 and not in
    // 2014, and the old code could only see the 2014 key set.
    const keys = searchableBaseKeys(
      [
        period("2014-03-31", { Sales: 100 }),
        period("2025-03-31", { Sales: 200, "Gold Loans": 50 }),
      ],
      mkDebug(["Sales"]),
    );
    expect(keys).toContain("Gold Loans");
  });

  it("finds a key that only exists in a middle period", () => {
    // Measured on Reliance: 1105 base keys in the oldest year, 1105 in the
    // newest, 1114 across all. Nine live only in middle years, so switching
    // to "the latest period" would not have been a fix either.
    const keys = searchableBaseKeys(
      [
        period("2014-03-31", { Sales: 1 }),
        period("2019-03-31", { Sales: 2, "Exceptional Item": 9 }),
        period("2025-03-31", { Sales: 3 }),
      ],
      mkDebug(["Sales"]),
    );
    expect(keys).toEqual(["Exceptional Item", "Sales"]);
  });

  it("counts each key once across periods", () => {
    const keys = searchableBaseKeys(
      [period("2024-03-31", { Sales: 1 }), period("2025-03-31", { Sales: 2 })],
      mkDebug([]),
    );
    expect(keys).toEqual(["Sales"]);
  });

  it("excludes the __-suffixed composite keys", () => {
    // Same quantity `rawMetricKeys` named: base keys. Composites are about half
    // of all keys (Bajaj Finance: 1065 composite, 1048 base), so including them
    // would double the reported match counts against the label.
    const keys = searchableBaseKeys(
      [period("2025-03-31", { Sales: 1, "Sales__ProfitLoss": 1, "Total Assets": 2 })],
      mkDebug([]),
    );
    expect(keys).toEqual(["Sales", "Total Assets"]);
  });

  it("keeps a key whose value parsed as null", () => {
    // Presence is what makes a key searchable; the panel renders null distinctly.
    const keys = searchableBaseKeys([period("2025-03-31", { Sales: null })], mkDebug([]));
    expect(keys).toEqual(["Sales"]);
  });
});

describe("searchableBaseKeys ordering", () => {
  it("sorts, so the row window does not favour the oldest period", () => {
    // The panel head-slices this list. Insertion order would put the oldest
    // period's keys first — exactly the ones already findable — so a query with
    // more matches than the window would still hide the recent-only key.
    const keys = searchableBaseKeys(
      [
        period("2014-03-31", { Zeta: 1, Alpha: 1 }),
        period("2025-03-31", { Beta: 1 }),
      ],
      mkDebug([]),
    );
    expect(keys).toEqual(["Alpha", "Beta", "Zeta"]);
  });

  it("does not reorder the parser's own array when falling back", () => {
    // `debugInfo.rawMetricKeys` is head-sliced into the persisted audit
    // snapshot, so sorting it in place would rewrite that artifact.
    const debug = mkDebug(["Sales", "Advances"]);
    const keys = searchableBaseKeys(null, debug);
    expect(keys).toEqual(["Advances", "Sales"]);
    expect(debug.rawMetricKeys).toEqual(["Sales", "Advances"]);
  });
});

describe("searchableBaseKeys fallback", () => {
  it("uses the parser's keys when no periods were passed", () => {
    expect(searchableBaseKeys(null, mkDebug(["Deposits"]))).toEqual(["Deposits"]);
  });

  it("uses the parser's keys when the periods hold only composites", () => {
    // Not merely "when rawData is absent". A dataset can carry only
    // `__`-suffixed keys, and then the filter empties the union while
    // `rawData.length` is still truthy — the search would find zero of
    // everything. Guarding on the union's size covers both.
    const keys = searchableBaseKeys(
      [period("2025-03-31", { "Deposits__BalanceSheet": 1000 })],
      mkDebug(["Deposits"]),
    );
    expect(keys).toEqual(["Deposits"]);
  });

  it("returns nothing when there is nothing anywhere", () => {
    expect(searchableBaseKeys(null, null)).toEqual([]);
    expect(searchableBaseKeys([], mkDebug([]))).toEqual([]);
  });
});
