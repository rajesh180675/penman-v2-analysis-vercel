/**
 * Strategy selection when the runtime has no DOM.
 *
 * Deliberately NOT pinned to jsdom — the whole point is to observe what the
 * parser records under bare Node, which is what the CI audit shards,
 * `refresh-expectations` and `batchRunner` all run under. A `@vitest-environment
 * jsdom` docblock here would silently invert the assertions below.
 *
 * Before this, `gridViaHtml` was called unconditionally and its internal
 * `catch { return [] }` swallowed the ReferenceError, so the debug trail read
 * `html-dom→0r` — identical to what a genuinely table-less file produces. That
 * ambiguity is what let a silent 89% metric loss sit unnoticed.
 */
import { describe, expect, it } from "vitest";
import { parseCapitalineZip } from "../capitalineParser";
import { hasDomParser } from "../capitalineParser/grid";

const BALANCE_SHEET_HTML = `
  <table>
    <tr><td>Particulars</td><td>202403</td><td>202503</td></tr>
    <tr><td><label style="padding-left:15px;">Total Assets</label></td><td>1000</td><td>1200</td></tr>
    <tr><td><label style="padding-left:15px;">Total Shareholders Funds</label></td><td>400</td><td>480</td></tr>
  </table>`;

/** A SpreadsheetML workbook — deliberately contains no <table>. */
const SSML_WORKBOOK = `<?xml version="1.0"?>
  <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
            xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    <Worksheet ss:Name="Sheet1">
      <Table>
        <Row><Cell><Data ss:Type="String">Particulars</Data></Cell><Cell><Data ss:Type="String">202503</Data></Cell></Row>
        <Row><Cell><Data ss:Type="String">Total Assets</Data></Cell><Cell><Data ss:Type="Number">1200</Data></Cell></Row>
      </Table>
    </Worksheet>
  </Workbook>`;

async function zipOf(members: Record<string, string>): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const [name, content] of Object.entries(members)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
}

describe("Capitaline DOM strategy reporting under a DOM-less runtime", () => {
  it("this suite is running without a DOM (guards the assertions below)", () => {
    // If a future config change gives this file a DOM, the expectations in this
    // suite become vacuous rather than wrong. Fail loudly instead.
    expect(hasDomParser()).toBe(false);
  });

  it("records html-dom as skipped, not as a zero-row parse", async () => {
    const buf = await zipOf({ "BalanceSheet_.xls": BALANCE_SHEET_HTML });
    const parsed = await parseCapitalineZip(buf, { companyId: "TEST", filename: "TEST.zip" });
    const grid = parsed.debug!.rawGrids[0]!;

    expect(grid.methods).toContain("html-dom→skipped(no-DOMParser)");
    // The old, ambiguous marker must not appear.
    expect(grid.methods).not.toContain("html-dom→0r");
    // Not charged as a parse error: parserFidelity sums grid.errors into
    // parserErrorCount, which costs 8 points of the score gating
    // syntactically-valid at 80. An absent DOM is a runtime property, not a
    // defect in the file.
    expect(grid.errors).toEqual([]);
  });

  it("still parses the file via the regex strategy", async () => {
    const buf = await zipOf({ "BalanceSheet_.xls": BALANCE_SHEET_HTML });
    const parsed = await parseCapitalineZip(buf, { companyId: "TEST", filename: "TEST.zip" });
    const grid = parsed.debug!.rawGrids[0]!;

    // Skipping the DOM strategy must not skip the file. Regex takes it, and
    // because the DOM never produced a grid there is no "dom-strong" shortcut.
    expect(grid.bestMethod).toBe("regex");
    expect(grid.methods.some((m) => m.startsWith("regex→") && m !== "regex→skipped(dom-strong)")).toBe(true);
    expect(grid.rowCount).toBeGreaterThan(0);
    expect(parsed.periods.length).toBeGreaterThan(0);
  });

  it("reports a real error for SpreadsheetML, which no other strategy can read", async () => {
    // Paired with a readable HTML member: parseCapitalineZip throws outright if
    // NO file in the archive yields periods, and this test is about what gets
    // recorded for the unreadable one, not about that top-level throw.
    const buf = await zipOf({
      "BalanceSheet_.xls": BALANCE_SHEET_HTML,
      "ProfitLoss_.xml": SSML_WORKBOOK,
    });
    const parsed = await parseCapitalineZip(buf, { companyId: "TEST", filename: "TEST.zip" });
    const ssml = parsed.debug!.rawGrids.find((g) => g.file.endsWith(".xml"))!;

    // Strategy D never runs (gated on `!hasHtmlTable && !isSpreadsheetML`), and
    // the regex strategy does run but finds nothing, because SpreadsheetML
    // spells rows and cells `<Row>`/`<Cell>` rather than `<tr>`/`<td>`. So
    // unlike the HTML branch, failing parser fidelity is the right outcome here.
    expect(ssml.methods).toContain("ssml→skipped(no-DOMParser)");
    expect(ssml.errors.some((e) => e.includes("no DOMParser"))).toBe(true);
    expect(ssml.rowCount).toBe(0);
  });

  it("records the grid shape it actually parsed, not zeros", async () => {
    // rowCount/colCount/firstRows were initialised and never written, so every
    // consumer saw zeros: the debug panel rendered "0r × 0c" and "Grid is EMPTY"
    // for a healthy parse, and the audit snapshot transported zeros.
    const buf = await zipOf({ "BalanceSheet_.xls": BALANCE_SHEET_HTML });
    const parsed = await parseCapitalineZip(buf, { companyId: "TEST", filename: "TEST.zip" });
    const grid = parsed.debug!.rawGrids[0]!;

    expect(grid.rowCount).toBe(3);
    expect(grid.colCount).toBe(3);
    expect(grid.firstRows.length).toBe(3);
    expect(grid.firstRows[0]).toEqual(["Particulars", "202403", "202503"]);
    expect(grid.firstRows[1]).toEqual(["Total Assets", "1000", "1200"]);
  });
});
