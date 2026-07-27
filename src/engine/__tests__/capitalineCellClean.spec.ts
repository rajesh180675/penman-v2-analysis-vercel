/**
 * cleanCell — Capitaline cell text extraction.
 *
 * These pin the fix for the silent metric-name loss on the regex grid path.
 * `cleanCell`'s primary strategy is "take everything after the last `>`", which
 * is correct for the Angular attribute residue Capitaline emits inside value
 * cells but wrong for content wrapped in a plain tag: in
 * `<label style="...">Goodwill</label>` the last `>` closes `</label>`, so the
 * result was the empty string.
 *
 * That blanked column 0 on 1697 of 1789 rows of TCS's balance sheet. Because
 * `gridToPeriods` drops any row without a metric label (it has no key to file
 * the values under), ~89% of metrics vanished while the parse still reported a
 * healthy 15 periods. Only the regex path was affected — `gridViaHtml` passes
 * `textContent`, which carries no tags — so the browser was always correct and
 * every DOM-less runtime (CI audit shards, refresh-expectations, batchRunner)
 * was not.
 *
 * The two groups below matter equally: the first is the bug, the second is what
 * the fix must not break.
 */
import { describe, expect, it } from "vitest";
import { cleanCell } from "../capitalineParser/cells";

describe("cleanCell — plain-tag wrapped content", () => {
  it("recovers a label wrapped in a tag with no ng-binding class", () => {
    // The exact markup that caused the loss, from BalanceSheetINDAS_.xls.
    expect(cleanCell('<label style="padding-left:15px;">Goodwill</label>')).toBe("Goodwill");
    expect(cleanCell('<label style="padding-left:15px;">Deferred Tax Assets</label>')).toBe(
      "Deferred Tax Assets",
    );
  });

  it("recovers content from other plain wrappers", () => {
    expect(cleanCell("<td>9108.00</td>")).toBe("9108.00");
    expect(cleanCell("<span>Total Assets</span>")).toBe("Total Assets");
    expect(cleanCell('<div class="x">Trade Payables</div>')).toBe("Trade Payables");
  });

  it("decodes entities inside a plain wrapper", () => {
    expect(cleanCell("<label>A &amp; B</label>")).toBe("A & B");
  });

  it("keeps nested-element text rather than dropping the row", () => {
    expect(cleanCell('<label class="breakup">Property, Plant <span>x</span></label>')).toBe(
      "Property, Plant x",
    );
  });
});

describe("cleanCell — cases the fix must not regress", () => {
  it("still takes text after the last > for Angular attribute residue", () => {
    // Value cells arrive with a truncated ng-class expression ahead of the
    // number. Stripping tags here would leave the residue behind, so the
    // last-`>` slice must still win: it is non-empty, so the fallback is
    // never consulted.
    expect(cleanCell(`= 0 ? '' : 'red'" class="ng-scope">22,403.63`)).toBe("22,403.63");
  });

  it("still prefers an ng-binding wrapper's text", () => {
    expect(cleanCell('<label class="breakup ng-binding ng-scope font-bold">Trade Payables</label>'))
      .toBe("Trade Payables");
    expect(cleanCell('<div class="ng-binding">43,571.30</div>')).toBe("43,571.30");
  });

  it("passes through bare text and normalises whitespace", () => {
    expect(cleanCell("Goodwill")).toBe("Goodwill");
    expect(cleanCell("  Total   Assets \n")).toBe("Total Assets");
  });

  it("returns empty for nullish and genuinely empty input", () => {
    expect(cleanCell(null)).toBe("");
    expect(cleanCell(undefined)).toBe("");
    expect(cleanCell("")).toBe("");
    expect(cleanCell("<label></label>")).toBe("");
  });
});
