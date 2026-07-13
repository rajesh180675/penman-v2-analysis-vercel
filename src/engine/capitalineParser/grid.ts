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
  const trMatches = text.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const grid: string[][] = [];
  for (const trBlock of trMatches) {
    const cellMatches =
      trBlock.match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi) ?? [];
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
