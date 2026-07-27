/**
 * gridViaRegex — streaming HTML table scraper.
 *
 * The implementation was rewritten from `text.match(/<tr[\s\S]*?<\/tr>/gi)`
 * to an indexOf walk, because materialising every <tr> substring of a
 * multi-MB Capitaline export (TCS P&L is ~14 MB) exhausted the worker heap.
 * These tests pin the rewrite's output against the original regex as an
 * oracle, so the memory fix cannot silently change what gets parsed.
 */
import { describe, expect, it } from "vitest";
import { gridViaRegex } from "../capitalineParser/grid";
import { cleanCell } from "../capitalineParser/cells";

/** The pre-rewrite implementation, kept here purely as a differential oracle. */
function gridViaRegexLegacy(text: string): string[][] {
  const trMatches = text.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const grid: string[][] = [];
  for (const trBlock of trMatches) {
    const cellMatches = trBlock.match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi) ?? [];
    const cells = cellMatches.map((cm) => {
      const inner = cm
        .replace(/^<(?:td|th)[^>]*>/, "")
        .replace(/<\/(?:td|th)>$/, "");
      return cleanCell(inner);
    });
    if (cells.some((c) => c !== "")) grid.push(cells);
  }
  return grid;
}

const CASES: Record<string, string> = {
  "simple table": `
    <table>
      <tr><th>Particulars</th><th>202303</th><th>202403</th></tr>
      <tr><td>Sales</td><td>1,234.50</td><td>2,345.60</td></tr>
      <tr><td>PAT</td><td>100</td><td>200</td></tr>
    </table>`,

  "attributes on tags": `
    <table border="1">
      <tr class="hdr" id="r1"><th colspan="2" scope="col">Head</th><th>V</th></tr>
      <tr style="color:red"><td align="right">Sales</td><td>10</td><td>20</td></tr>
    </table>`,

  "rows with all-empty cells are dropped": `
    <table>
      <tr><td></td><td>  </td></tr>
      <tr><td>Real</td><td>1</td></tr>
    </table>`,

  "whitespace and newlines inside cells": `
    <table>
      <tr><td>
            Revenue From
            Operations
         </td><td>  42  </td></tr>
    </table>`,

  "nested markup inside cells": `
    <table>
      <tr><td><span class="x">Sales</span></td><td><b>10</b></td></tr>
    </table>`,

  "multiple tables in one document": `
    <table><tr><td>A</td><td>1</td></tr></table>
    <p>filler</p>
    <table><tr><td>B</td><td>2</td></tr></table>`,

  "unterminated trailing row": `
    <table>
      <tr><td>Good</td><td>1</td></tr>
      <tr><td>Truncated</td>`,

  "th and td mixed in one row": `
    <table>
      <tr><th>Label</th><td>1</td><th>Other</th><td>2</td></tr>
    </table>`,

  "no table at all": `<html><body><p>nothing here</p></body></html>`,

  "empty string": ``,
};

describe("gridViaRegex", () => {
  for (const [name, html] of Object.entries(CASES)) {
    it(`matches the legacy regex implementation — ${name}`, () => {
      expect(gridViaRegex(html)).toEqual(gridViaRegexLegacy(html));
    });
  }

  it("parses uppercase <TD>/<TH> tags", () => {
    // The streaming walk matches <td>/<th> case-insensitively, so uppercase
    // files parse. Cell *contents* keep their original case.
    //
    // This used to assert the oracle returned [] here, because legacy strips the
    // open tag with /^<(?:td|th)[^>]*>/ — no `i` flag — leaving "<TD>…</TD>" in
    // the cell, which `cleanCell` then reduced to "". That legacy bug is still
    // there, but it is no longer observable: cleanCell now falls back to
    // stripping tags when "text after the last >" comes out empty, so the
    // oracle recovers the same text. Both agree, and the divergence this case
    // was written to pin has closed rather than been worked around.
    const html = `
      <TABLE>
        <TR><TD>Sales Of Products</TD><TD>10</TD></TR>
      </TABLE>`;
    expect(gridViaRegex(html)).toEqual([["Sales Of Products", "10"]]);
    expect(gridViaRegexLegacy(html)).toEqual([["Sales Of Products", "10"]]);
  });

  it("extracts the expected grid for a Capitaline-shaped table", () => {
    expect(gridViaRegex(CASES["simple table"]!)).toEqual([
      ["Particulars", "202303", "202403"],
      ["Sales", "1,234.50", "2,345.60"],
      ["PAT", "100", "200"],
    ]);
  });

  // Guards against the quadratic regression: with an unbounded per-cell
  // indexOf this same input took ~105 s. Linear, it is well under a second, so
  // a 20 s ceiling fails loudly if the row-bounded scan is ever undone.
  it("scales to a large table in linear time", { timeout: 20_000 }, () => {
    // 20k rows — the shape that OOM'd the old implementation on real exports.
    const rows = Array.from(
      { length: 20_000 },
      (_, i) => `<tr><td>Row ${i}</td><td>${i * 10}</td><td>${i * 20}</td></tr>`,
    ).join("");
    const grid = gridViaRegex(`<table>${rows}</table>`);
    expect(grid).toHaveLength(20_000);
    expect(grid[0]).toEqual(["Row 0", "0", "0"]);
    expect(grid[19_999]).toEqual(["Row 19999", "199990", "399980"]);
  });
});
