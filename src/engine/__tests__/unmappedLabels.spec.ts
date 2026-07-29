/* ================================================================
   What `summarizeUnmappedLabels` counts, and the two ways the
   function it replaces got the number wrong.

   `rankUnmappedLabels(rawData, 8).length` was the whole of the
   workspace tile's value. It could not exceed 8, because 8 was the
   limit it was called with — so the tile printed 8 for every company
   in the bundled registry while the real figure ranged from 221
   (Infosys, NTPC) to 1,698 (HDFC Bank). Underneath that,
   `listRawBaseKeys` returns one entry per `<label>__<statement>`
   composite key and does not dedupe, so even an uncapped `.length`
   would have counted a label reported on two statements twice.
================================================================ */

import { describe, expect, it } from "vitest";
import { summarizeConceptCoverage, summarizeUnmappedLabels } from "../conceptOntology";
import type { RawPeriodData } from "../types";

/** "Inventory" is an ontology alias; the rest are not claimed by any concept. */
function mkPeriod(period_end: string, raw: Record<string, number | null>): RawPeriodData {
  return { company_id: "TESTCO", period_end, raw_metric_values: raw };
}

describe("summarizeUnmappedLabels", () => {
  it("counts every unmapped label, with no ceiling on the answer", () => {
    // Twelve labels, more than the limit of 8 the old call site passed. The
    // number that used to reach the tile was 8 for any input this long.
    const raw: Record<string, number> = {};
    for (let i = 0; i < 12; i++) raw[`Unclaimed Label ${i}__BalanceSheet`] = i;

    expect(summarizeUnmappedLabels([mkPeriod("2025-03-31", raw)])).toEqual({
      unmapped: 12,
      distinct: 12,
    });
  });

  it("counts a label reported on two statements once", () => {
    // `listRawBaseKeys` maps composite keys through `baseKey`, so this period
    // yields four base keys from two labels. Real exports do this heavily:
    // Infosys parses 475 base keys from 235 distinct labels.
    const summary = summarizeUnmappedLabels([
      mkPeriod("2025-03-31", {
        "Lease Adjustment__BalanceSheet": 10,
        "Lease Adjustment__ProfitLoss": 10,
        "Biological Assets__BalanceSheet": 5,
        "Biological Assets__CashFlow": 5,
      }),
    ]);

    expect(summary).toEqual({ unmapped: 2, distinct: 2 });
  });

  it("does not count labels the ontology claims", () => {
    const summary = summarizeUnmappedLabels([
      mkPeriod("2025-03-31", { Inventory__BalanceSheet: 40, "Lease Adjustment__BalanceSheet": 10 }),
    ]);

    // Both are distinct labels the file supplied; only one of them is unmapped.
    expect(summary).toEqual({ unmapped: 1, distinct: 2 });
  });

  it("treats an alias that differs only in case as claimed", () => {
    // Capitaline's own capitalisation varies between exports, and
    // `findRawMetric` — which decides the Coverage tile beside this one — folds
    // case before comparing. Counting a case variant as unmapped here would have
    // the two tiles disagree about the same label.
    const summary = summarizeUnmappedLabels([
      mkPeriod("2025-03-31", { INVENTORY__BalanceSheet: 40 }),
    ]);

    expect(summary).toEqual({ unmapped: 0, distinct: 1 });
  });

  it("reads the latest period, not the first", () => {
    // The tile describes the statements a reviewer is looking at. An older period
    // with a different chart of accounts is not the answer to that question.
    const summary = summarizeUnmappedLabels([
      mkPeriod("2024-03-31", { "Old Label A__BalanceSheet": 1, "Old Label B__BalanceSheet": 2 }),
      mkPeriod("2025-03-31", { "New Label__BalanceSheet": 3 }),
    ]);

    expect(summary).toEqual({ unmapped: 1, distinct: 1 });
  });

  it("ignores labels the parser kept but found no figure in", () => {
    // The parser writes a kept row's key whether or not the cell held a number,
    // and on the bank exports those dominate — 1,228 of HDFC Bank's 1,721 distinct
    // labels are null on every statement. Counting them would make the tile a
    // measure of how sparse the file is rather than of how much of it maps.
    const summary = summarizeUnmappedLabels([
      mkPeriod("2025-03-31", {
        "Real Label__BalanceSheet": 10,
        "Empty Label__BalanceSheet": null,
        "Also Empty__ProfitLoss": null,
      }),
    ]);

    expect(summary).toEqual({ unmapped: 1, distinct: 1 });
  });

  it("counts a label whose figure is zero", () => {
    // Zero is a figure. The parser keeps these rows deliberately — `gridToPeriods`
    // notes "borrowings = 0" as real data — so a falsy check in place of the null
    // check would silently drop them from both the count and the denominator.
    const summary = summarizeUnmappedLabels([
      mkPeriod("2025-03-31", { "Zero Label__BalanceSheet": 0, "Real Label__BalanceSheet": 5 }),
    ]);

    expect(summary).toEqual({ unmapped: 2, distinct: 2 });
  });

  it("counts a label that has a figure on one statement and not the other", () => {
    // Null on the balance sheet, real on the P&L. The label is in play, so it
    // counts — once.
    const summary = summarizeUnmappedLabels([
      mkPeriod("2025-03-31", {
        "Half Empty__BalanceSheet": null,
        "Half Empty__ProfitLoss": 7,
      }),
    ]);

    expect(summary).toEqual({ unmapped: 1, distinct: 1 });
  });

  it("agrees with the coverage matcher about a null-valued alias", () => {
    // The reason the predicate is shared rather than merely similar. Seven of HDFC
    // Bank's null-everywhere labels are ontology aliases, and `findRawMetric`
    // skips non-finite values — so `summarizeConceptCoverage` reports those
    // concepts unmatched. Treating the label as claimed here would have one grid
    // block give two answers about the same label.
    const periods = [
      mkPeriod("2025-03-31", { Inventory__BalanceSheet: null, "Some Other Label__BalanceSheet": 3 }),
    ];

    expect(summarizeConceptCoverage(periods).rows.find((r) => r.conceptId === "inventory")?.matched).toBe(false);
    // "Inventory" is not counted as claimed, and not counted at all — it has no
    // figure, so it is not among the labels in play either.
    expect(summarizeUnmappedLabels(periods)).toEqual({ unmapped: 1, distinct: 1 });
  });

  it("reports nothing to count for absent or empty input", () => {
    // Zero of zero, which the display helper renders as an em dash rather than as
    // a company whose every label mapped.
    const empty = { unmapped: 0, distinct: 0 };
    expect(summarizeUnmappedLabels(null)).toEqual(empty);
    expect(summarizeUnmappedLabels(undefined)).toEqual(empty);
    expect(summarizeUnmappedLabels([])).toEqual(empty);
    expect(summarizeUnmappedLabels([mkPeriod("2025-03-31", {})])).toEqual(empty);
  });
});
