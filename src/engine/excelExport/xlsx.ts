/**
 * Excel workbook primitives + styling layer (extracted verbatim from excelExport.ts).
 * Hand-rolled cell/sheet model written through an ExcelJS-backed writer.
 */
import ExcelJS from "exceljs";

export type CellObject = {
  v: string | number;
  t: "n" | "s";
  s?: CellStyle | undefined;
};

export type WorkSheet = Record<string, CellObject | Array<{ wch: number }> | string>;

export type WorkBook = {
  Sheets: Record<string, WorkSheet>;
  SheetNames: string[];
};

function encodeColumn(col: number) {
  let n = col + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function encodeCellAddr(row: number, col: number) {
  return `${encodeColumn(col)}${row + 1}`;
}

function decodeCellAddr(addr: string) {
  const match = addr.match(/^([A-Z]+)(\d+)$/);
  if (!match) return { r: 0, c: 0 };
  const [, letters, digits] = match;
  let c = 0;
  for (const ch of letters!) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(digits) - 1, c: c - 1 };
}

function encodeRangeAddr(args: { s: { r: number; c: number }; e: { r: number; c: number } }) {
  return `${encodeCellAddr(args.s.r, args.s.c)}:${encodeCellAddr(args.e.r, args.e.c)}`;
}

function bookNew(): WorkBook {
  return { Sheets: {}, SheetNames: [] };
}

function bookAppendSheet(wb: WorkBook, ws: WorkSheet, name: string) {
  wb.Sheets[name] = ws;
  wb.SheetNames.push(name);
}

function jsonToSheet(rows: Array<Record<string, unknown> | object>): WorkSheet {
  const ws: WorkSheet = {};
  if (!rows.length) return ws;
  const headers = Object.keys(rows[0]!);
  headers.forEach((header, col) => {
    ws[encodeCellAddr(0, col)] = { v: header, t: "s" };
  });
  rows.forEach((row, rowIndex) => {
    const record = row as Record<string, unknown>;
    headers.forEach((header, col) => {
      const value = record[header];
      ws[encodeCellAddr(rowIndex + 1, col)] = {
        v: typeof value === "number" ? value : String(value ?? ""),
        t: typeof value === "number" ? "n" : "s",
      };
    });
  });
  return ws;
}

export async function writeWorkbookArray(wb: WorkBook) {
  const workbook = new ExcelJS.Workbook();
  for (const name of wb.SheetNames) {
    const source = wb.Sheets[name]!;
    const sheet = workbook.addWorksheet(name);
    const entries = Object.entries(source).filter(([key]) => !key.startsWith("!"));
    for (const [addr, cell] of entries) {
      const excelCell = sheet.getCell(addr);
      excelCell.value = (cell as CellObject).v as string | number;
    }
    const cols = source["!cols"] as Array<{ wch: number }> | undefined;
    if (cols) {
      cols.forEach((col, index) => {
        const width = Math.max(8, Math.round(col.wch));
        sheet.getColumn(index + 1).width = width;
      });
    }
  }
  return await workbook.xlsx.writeBuffer();
}

export const utils = {
  encode_cell: ({ r, c }: { r: number; c: number }) => encodeCellAddr(r, c),
  decode_cell: (addr: string) => decodeCellAddr(addr),
  encode_range: (args: { s: { r: number; c: number }; e: { r: number; c: number } }) => encodeRangeAddr(args),
  book_new: bookNew,
  book_append_sheet: bookAppendSheet,
  json_to_sheet: jsonToSheet,
};

// ── Style helpers ──────────────────────────────────────────────────────────────
type Fill = { fgColor: { rgb: string } };
type Font = { bold?: boolean | undefined; color?: { rgb: string }; sz?: number | undefined; name?: string };
type Alignment = { horizontal?: string | undefined; vertical?: string | undefined; wrapText?: boolean };
type CellStyle = { fill?: Fill | undefined; font?: Font | undefined; alignment?: Alignment | undefined; numFmt?: string | undefined; border?: object };

export function cell(v: string | number | null, s?: CellStyle): CellObject {
  const t = typeof v === "number" ? "n" : typeof v === "string" ? "s" : "s";
  return { v: v ?? "", t, s } as CellObject;
}

export const HEADER_BLUE: CellStyle = {
  fill: { fgColor: { rgb: "1F3864" } },
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  alignment: { horizontal: "center" },
};
export const SUBHEADER: CellStyle = {
  fill: { fgColor: { rgb: "4472C4" } },
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 9 },
  alignment: { horizontal: "center" },
};
export const LABEL: CellStyle = {
  font: { bold: false, sz: 9 },
  alignment: { horizontal: "left" },
};
export const LABEL_BOLD: CellStyle = {
  font: { bold: true, sz: 9 },
  alignment: { horizontal: "left" },
};
export const NUM_INR: CellStyle = {
  numFmt: "#,##0",
  font: { sz: 9 },
  alignment: { horizontal: "right" },
};
export const NUM_PCT: CellStyle = {
  numFmt: "0.0%",
  font: { sz: 9 },
  alignment: { horizontal: "right" },
};
export const NUM_2DP: CellStyle = {
  numFmt: "0.00",
  font: { sz: 9 },
  alignment: { horizontal: "right" },
};
export const RED_NUM: CellStyle = {
  numFmt: "#,##0",
  font: { sz: 9, color: { rgb: "C00000" } },
  alignment: { horizontal: "right" },
};
export const GREEN_FILL: CellStyle = {
  fill: { fgColor: { rgb: "E2EFDA" } },
  numFmt: "#,##0",
  font: { sz: 9 },
  alignment: { horizontal: "right" },
};
export const AMBER_FILL: CellStyle = {
  fill: { fgColor: { rgb: "FFF2CC" } },
  numFmt: "0.0%",
  font: { sz: 9 },
  alignment: { horizontal: "right" },
};

// ── Sheet utilities ────────────────────────────────────────────────────────────
export function setCell(ws: WorkSheet, row: number, col: number, c: CellObject) {
  const addr = utils.encode_cell({ r: row, c: col });
  ws[addr] = c;
}
export function setRange(ws: WorkSheet, rows: CellObject[][], startRow = 0, startCol = 0) {
  rows.forEach((row, r) => row.forEach((c, col) => setCell(ws, startRow + r, startCol + col, c)));
}
export function updateRef(ws: WorkSheet) {
  const cells = Object.keys(ws).filter(k => !k.startsWith("!"));
  if (!cells.length) return;
  let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
  for (const k of cells) {
    const d = utils.decode_cell(k);
    minR = Math.min(minR, d.r); minC = Math.min(minC, d.c);
    maxR = Math.max(maxR, d.r); maxC = Math.max(maxC, d.c);
  }
  ws["!ref"] = utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
}
