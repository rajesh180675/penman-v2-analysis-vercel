import { HeaderInfo } from "./types";
import { cleanCell, tryParsePeriod } from "./cells";

/* ══════════════════════════════════════════════════════════════════
   Parse Strategy A: ExcelJS XLSX
══════════════════════════════════════════════════════════════════ */

export async function gridViaXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  let best: string[][] = [];

  try {
    // ExcelJS accepts ArrayBuffer/Uint8Array in browsers, although its public
    // declaration uses Node's Buffer type for the same binary input.
    await workbook.xlsx.load(buffer);
    for (const worksheet of workbook.worksheets) {
      const grid: string[][] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        for (let column = 1; column <= row.cellCount; column += 1) {
          cells.push(cleanCell(row.getCell(column).text));
        }
        if (cells.some((cell) => cell !== "")) grid.push(cells);
      });
      if (grid.length > best.length) best = grid;
    }
  } catch {
    return [];
  }

  return best;
}

/* ══════════════════════════════════════════════════════════════════
   Parse Strategy B: HTML DOMParser
   Best for Capitaline Angular HTML XLS files
══════════════════════════════════════════════════════════════════ */

export function gridViaHtml(text: string): string[][] {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, "text/html");
  } catch {
    return [];
  }
  const tables = Array.from(doc.querySelectorAll("table"));
  if (!tables.length) return [];

  let best: string[][] = [];
  let bestScore = 0;

  for (const table of tables) {
    const trs = Array.from(table.querySelectorAll("tr"));
    const grid: string[][] = [];
    for (const tr of trs) {
      const cells = Array.from(tr.querySelectorAll("td,th")).map((c) => {
        // DOMParser renders Angular—textContent has the final value
        return cleanCell(c.textContent ?? "");
      });
      if (cells.some((c) => c !== "")) grid.push(cells);
    }
    const score = grid.length * (grid[0]?.length ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = grid;
    }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════
   Parse Strategy C: Regex scraper fallback
══════════════════════════════════════════════════════════════════ */

export function gridViaRegex(text: string): string[][] {
  // Streaming rewrite — avoids text.match(/<tr[\s\S]*?<\/tr>/gi) which
  // materialises one giant array of every <tr> substring in the file. On
  // multi-MB Capitaline exports (e.g. TCS 14 MB P&L) that array alone
  // exhausts the worker heap (~2 GB). Walk the string with indexOf instead;
  // peak memory is O(largest single row), not O(file size).
  const grid: string[][] = [];
  const lower = text.toLowerCase();
  const len = text.length;
  let pos = 0;
  while (pos < len) {
    const trStart = lower.indexOf("<tr", pos);
    if (trStart === -1) break;
    // Skip past "<tr" and any attributes to the closing ">" of the open tag.
    const trOpenEnd = lower.indexOf(">", trStart);
    if (trOpenEnd === -1) break;
    const trEnd = lower.indexOf("</tr>", trOpenEnd);
    if (trEnd === -1) break;

    // Slice the row out ONCE and scan only inside it. Searching the whole
    // document for each cell's closing tag is what made the first version of
    // this rewrite quadratic: `indexOf("</th>", …)` is unbounded, and most
    // Capitaline rows contain no <th> at all, so every single cell scanned to
    // end-of-file. On a 14 MB export that is O(cells x filesize) — 20k rows
    // took ~105 s. Bounded to the row, the walk is linear again and peak
    // memory really is O(largest single row) as intended.
    const row = text.slice(trOpenEnd + 1, trEnd);
    const rowLower = lower.slice(trOpenEnd + 1, trEnd);
    const rowLen = row.length;

    const cells: string[] = [];
    let cellPos = 0;
    while (cellPos < rowLen) {
      // Find next <td or <th that is a real tag (delimiter follows).
      let tdStart = -1;
      for (let i = cellPos; i + 3 < rowLen; i++) {
        if (
          rowLower.charCodeAt(i) === 60 /* < */ &&
          (rowLower.charCodeAt(i + 1) === 116 /* t */) &&
          (rowLower.charCodeAt(i + 2) === 100 /* d */ || rowLower.charCodeAt(i + 2) === 104 /* h */)
        ) {
          const next = rowLower.charCodeAt(i + 3);
          // Must be whitespace, '>', or '/' to be a real <td>/<th tag.
          if (next === 62 || next === 47 || next === 32 || next === 9 || next === 10 || next === 13) {
            tdStart = i;
            break;
          }
        }
      }
      if (tdStart === -1) break;
      const tdOpenEnd = rowLower.indexOf(">", tdStart);
      if (tdOpenEnd === -1) break;
      // Find matching close tag — whichever of </td> or </th> comes first.
      let tdEnd = rowLower.indexOf("</td>", tdOpenEnd);
      const thEnd = rowLower.indexOf("</th>", tdOpenEnd);
      if (tdEnd === -1 || (thEnd !== -1 && thEnd < tdEnd)) tdEnd = thEnd;
      if (tdEnd === -1) break;
      cells.push(cleanCell(row.slice(tdOpenEnd + 1, tdEnd)));
      cellPos = tdEnd + 5;
    }
    if (cells.some((c) => c !== "")) grid.push(cells);
    pos = trEnd + 5;
  }
  return grid;
}

export function gridScore(g: string[][]): number {
  if (!g.length) return 0;
  const rows = g.length;
  const cols = Math.max(...g.map((r) => r.length), 0);
  const nonEmpty = g.reduce((s, r) => s + r.filter((c) => c && c.trim() !== "").length, 0);
  const total = Math.max(1, rows * Math.max(1, cols));
  const density = nonEmpty / total;
  const headerBonus = detectHeader(g) ? 250 : 0;
  return headerBonus + rows * cols * density;
}

/* ══════════════════════════════════════════════════════════════════
   Header detection
══════════════════════════════════════════════════════════════════ */

export function detectHeader(grid: string[][]): HeaderInfo | null {
  const limit = Math.min(grid.length, 80);

  // Scan for rows with ≥3 period cols first, then ≥2, then ≥1
  for (const minPeriods of [3, 2, 1]) {
    for (let r = 0; r < limit; r++) {
      const h = tryHeaderRow(grid[r]!, r);
      if (h && h.periodCols.length >= minPeriods) return h;
    }
  }
  return null;
}

export function tryHeaderRow(row: string[], rowIndex: number): HeaderInfo | null {
  if (!row || row.length < 2) return null;
  const periodCols: HeaderInfo["periodCols"] = [];
  for (let c = 0; c < row.length; c++) {
    const pe = tryParsePeriod(row[c]!);
    if (pe) {
      periodCols.push({ col: c, period_end: pe, label: cleanCell(row[c]!) });
    }
  }
  if (!periodCols.length) return null;
  return { rowIndex, metricCol: 0, periodCols };
}

/* ══════════════════════════════════════════════════════════════════
   SpreadsheetML parser (true XML workbooks only)
══════════════════════════════════════════════════════════════════ */

export function gridViaSpreadsheetML(text: string): string[][] {
  let xml: Document;
  try {
    xml = new DOMParser().parseFromString(text, "text/xml");
  } catch {
    return [];
  }
  const byLocal = (el: Element | Document, ln: string): Element[] =>
    Array.from((el as Element).getElementsByTagName("*") ?? []).filter(
      (e) => e.localName === ln
    );
  const worksheets = byLocal(xml.documentElement, "Worksheet");
  if (!worksheets.length) return [];
  let best: string[][] = [];
  for (const ws of worksheets) {
    const tbl = byLocal(ws, "Table")[0];
    if (!tbl) continue;
    const rowEls = byLocal(tbl, "Row");
    const grid: string[][] = [];
    for (const rowEl of rowEls) {
      const cellEls = byLocal(rowEl, "Cell");
      const row: string[] = [];
      let col = 1;
      for (const cellEl of cellEls) {
        const idx = parseInt(
          cellEl.getAttribute("ss:Index") ||
          cellEl.getAttribute("Index") ||
          "0"
        );
        if (idx > col) while (col < idx) { row.push(""); col++; }
        const dataEl = byLocal(cellEl, "Data")[0];
        row.push(cleanCell(dataEl?.textContent ?? ""));
        col++;
      }
      if (row.some((c) => c !== "")) grid.push(row);
    }
    if (grid.length > best.length) best = grid;
  }
  return best;
}
