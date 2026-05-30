import { HeaderInfo } from "./types";
import { cleanCell, tryParsePeriod } from "./cells";

/* ══════════════════════════════════════════════════════════════════
   Parse Strategy A: SheetJS XLSX
══════════════════════════════════════════════════════════════════ */

export async function gridViaXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  // SECURITY NOTE: SheetJS 0.18.x has known prototype-pollution and ReDoS
  // CVEs (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9). They are unfixed on
  // npm — fixed builds live only on the SheetJS CDN. Accepted risk because:
  //   (a) parsing runs client-side in the user's browser on files THEY
  //       uploaded; no public endpoint routes untrusted XLS through here
  //   (b) this is one of several fallback parse strategies — failures fall
  //       through to JSZip/regex paths
  // If the threat model expands to public XLS uploads, replace this strategy
  // with exceljs or a CDN-pinned SheetJS build.
  const { default: XLSX } = await import("xlsx");
  const uint8 = new Uint8Array(buffer);
  let wb: import("xlsx").WorkBook;
  try {
    wb = XLSX.read(uint8, {
      type: "array",
      cellDates: false,
      cellFormula: false,
      raw: false,
      dense: false,
      codepage: 65001,
    });
  } catch {
    return [];
  }
  if (!wb.SheetNames.length) return [];

  let best: string[][] = [];
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false,
      defval: "",
    }) as unknown[][];

    const grid = rows
      .map((r) =>
        (Array.isArray(r) ? r : [r]).map((c) => cleanCell(String(c ?? "")))
      )
      .filter((r) => r.some((c) => c !== ""));

    if (grid.length > best.length) best = grid;
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
