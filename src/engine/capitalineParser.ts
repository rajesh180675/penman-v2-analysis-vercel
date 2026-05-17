/**
 * Capitaline Ind AS XLS Parser — v5
 *
 * Confirmed from debug output:
 * 1. Year columns: YYYYMM integers like 202503, 202403 (latest first → oldest last)
 * 2. Cell values contain Angular template residue:
 *    `= 0 ? '' : 'red'" class="ng-scope">22,403.63`
 *    → strip everything up to and including the last `>`
 * 3. Files are HTML with <table> tags — SheetJS reads them fine as HTML
 * 4. Row 0 = company header (Finance >> BS >> Company), Row 1 = Year header
 * 5. Metric name is always in column 0
 * 6. Statement-aware composite keys: "Finance Cost__ProfitLoss" etc.
 */

import JSZip from "jszip";
import { RawPeriodData } from "./types";
import {
  AccountingStandard,
  STANDARD_PRECEDENCE,
  buildAliasMap,
  standardFromFilename,
} from "./standardAliases";

const MAX_ZIP_BYTES = 25 * 1024 * 1024; // 25 MB archive upload cap
const MAX_ZIP_ENTRIES = 64;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 20 * 1024 * 1024; // 20 MB per file

/* ══════════════════════════════════════════════════════════════════
   Public types
══════════════════════════════════════════════════════════════════ */

export type CapitalineStatement =
  | "BalanceSheet"
  | "ProfitLoss"
  | "CashFlow"
  | "Unknown";

export interface ParseWarning {
  file?: string;
  message: string;
  detail?: string;
}

/**
 * Phase A — multi-standard ingestion provenance.
 * Per-period record of which accounting-standard files contributed values.
 */
export interface PeriodStandardProvenance {
  period_end: string;
  /** Standard that won precedence (Ind-AS > REV > Standard > Unknown) */
  dominantStandard: AccountingStandard;
  /** All standards that contributed any value to this period */
  contributingStandards: AccountingStandard[];
  /** Number of composite keys whose dominant value came from a non-Ind-AS source */
  filledFromOlderStandard: number;
}

export interface RawGridDebug {
  file: string;
  methods: string[];
  bestMethod: string;
  rowCount: number;
  colCount: number;
  firstRows: string[][];
  headerDetected: boolean;
  headerRowIndex?: number;
  periodLabels?: string[];
  errors: string[];
}

export interface CapitalineParseDebug {
  companyId: string;
  files: Array<{ name: string; statementGuess: CapitalineStatement }>;
  detectedPeriods: string[];
  rawGrids: RawGridDebug[];
  metrics: {
    totalCompositeKeys: number;
    totalBaseKeys: number;
    baseKeyCollisions: Array<{
      metric: string;
      statements: CapitalineStatement[];
      keptStatement: CapitalineStatement;
    }>;
    byStatement: Record<CapitalineStatement, number>;
  };
  warnings: ParseWarning[];
  sample: {
    headerRow?: string[];
    firstRows: Array<{
      metric: string;
      statement: CapitalineStatement;
      values: Array<string | null>;
    }>;
  };
  rawMetricKeys: string[];
}

/* ══════════════════════════════════════════════════════════════════
   Constants
══════════════════════════════════════════════════════════════════ */

// When the same metric appears in multiple statements,
// for base-key lookup we prefer the statement that "owns" it
// But for composite keys we keep ALL of them — engine picks right one
const STMT_PRECEDENCE: Record<CapitalineStatement, number> = {
  BalanceSheet: 3,
  ProfitLoss: 2,
  CashFlow: 1,
  Unknown: 0,
};

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/* ══════════════════════════════════════════════════════════════════
   Currency unit detection — Phase I7
══════════════════════════════════════════════════════════════════ */

export type CurrencyUnit =
  | "Crores"
  | "Lakhs"
  | "Millions"
  | "Thousands"
  | "Absolute"
  | "Unknown";

/**
 * Multiplier to convert a value in the detected unit to ₹ Crores.
 *
 *   Crores   × 1          = Crores  (no-op)
 *   Lakhs    × 0.01       = Crores  (100 lakhs = 1 crore)
 *   Millions × 0.1        = Crores  (10 millions = 1 crore)
 *   Thousands× 0.0001     = Crores  (10,000 thousands = 1 crore)
 *   Absolute × 1e-7       = Crores  (1 crore = 10,000,000 rupees)
 *   Unknown  × 1          = pass-through (warn, don't corrupt)
 */
export const UNIT_TO_CR_MULTIPLIER: Record<CurrencyUnit, number> = {
  Crores:    1,
  Lakhs:     0.01,
  Millions:  0.1,
  Thousands: 0.0001,
  Absolute:  1e-7,
  Unknown:   1,       // pass-through — don't silently corrupt
};

/**
 * Scan the first `scanRows` rows of a parsed grid for a "Curr. in"
 * header row and return the detected unit.
 *
 * Capitaline HTML exports typically have a row like:
 *   ["Curr. in", "Rs. Cr.", "Rs. Cr.", ...]
 * or
 *   ["Currency", "Rs. Lakh", ...]
 *
 * Returns null when no currency row is found (caller should assume Crores).
 */
export function detectCurrencyUnit(
  grid: string[][],
  scanRows = 10,
): CurrencyUnit | null {
  const limit = Math.min(grid.length, scanRows);

  for (let r = 0; r < limit; r++) {
    const row = grid[r];
    if (!row || row.length < 2) continue;

    const label = norm(row[0]).toLowerCase();
    if (!label.includes("curr") && !label.includes("unit") && !label.includes("denomination")) {
      continue;
    }

    // Found a currency label row — read the first non-empty value cell
    for (let c = 1; c < row.length; c++) {
      const cell = norm(row[c]).toLowerCase();
      if (!cell) continue;

      // Match common Capitaline patterns
      if (/\bcr(ore)?s?\b/.test(cell) || cell === "rs. cr." || cell === "inr cr") {
        return "Crores";
      }
      if (/\blakh?s?\b/.test(cell) || /\blac\b/.test(cell)) {
        return "Lakhs";
      }
      if (/\bmn\b/.test(cell) || /\bmillion/.test(cell)) {
        return "Millions";
      }
      if (/\bthousand/.test(cell) || /\b000s\b/.test(cell)) {
        return "Thousands";
      }
      if (/\babs(olute)?\b/.test(cell) || cell === "rs." || cell === "inr") {
        return "Absolute";
      }
      // Row found but value unrecognised
      return "Unknown";
    }
  }

  return null; // no currency row found
}

/* ══════════════════════════════════════════════════════════════════
   Cell cleaning
══════════════════════════════════════════════════════════════════ */

function norm(s: string): string {
  if (!s) return "";
  return s
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019\u0060\u00b4]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clean Angular template residue from cells.
 *
 * Input: `= 0 ? '' : 'red'" class="ng-scope">22,403.63`
 * Output: `22,403.63`
 *
 * Strategy:
 *   1. Find last `>` — text after it is the rendered value
 *   2. If no `>`, strip HTML tags anyway
 *   3. Decode entities
 */
function cleanCell(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw);

  // Check if there's any HTML/Angular residue
  if (s.includes(">") || s.includes("<")) {
    // Phase I10: If content contains ng-binding divs, extract their text first.
    // Vodafone Idea format has values inside <div class="ng-binding">43,571.30</div>
    // nested deep within 8KB of Angular template comments and closing tags.
    // The old "take text after last >" fails because closing tags come after the value.
    const ngBindingMatch = s.match(/<div[^>]*class="[^"]*ng-binding[^"]*"[^>]*>\s*([^<]+)/);
    if (ngBindingMatch) {
      s = ngBindingMatch[1];
    } else {
      // Take everything after the LAST `>`
      const gIdx = s.lastIndexOf(">");
      if (gIdx >= 0) {
        s = s.slice(gIdx + 1);
      } else {
        // Strip HTML tags
        s = s.replace(/<[^>]*>/g, "");
      }
    }
  }

  // Decode HTML entities
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");

  return norm(s);
}

function parseNum(cell: string | null | undefined): number | null {
  if (cell == null) return null;
  const s = cleanCell(String(cell));
  if (!s) return null;
  // em-dash, en-dash, hyphen alone = null/missing
  if (/^[-\u2013\u2014]+$/.test(s)) return null;
  if (/^(n\.?a\.?|#n\/a|#ref!|#value!|nil)$/i.test(s)) return null;

  const neg = s.startsWith("(") && s.endsWith(")");
  const cleaned = s
    .replace(/^\(/, "").replace(/\)$/, "")
    .replace(/,/g, "")
    .replace(/[₹$€£¥\s]/g, "");

  if (!cleaned || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/**
 * Try to parse a cell as a fiscal period → ISO date string.
 * Handles:
 *   "202503"     → 2025-03-31  ← Capitaline YYYYMM format
 *   "Mar/2016"   → 2016-03-31
 *   "Mar 2016"   → 2016-03-31
 *   "Mar-2016"   → 2016-03-31
 *   "Mar '16"    → 2016-03-31
 *   "FY2016"     → 2016-03-31
 *   "2016-03-31" → 2016-03-31
 */
function tryParsePeriod(rawCell: string): string | null {
  const s = cleanCell(rawCell).replace(/\s+/g, "");
  if (!s || s.length < 4) return null;

  // YYYYMM (e.g. 202503) — Capitaline's standard export format
  const ym = s.match(/^(\d{4})(\d{2})$/);
  if (ym) {
    const yr = parseInt(ym[1]);
    const mo = parseInt(ym[2]);
    if (yr >= 1990 && yr <= 2099 && mo >= 1 && mo <= 12) {
      const lastDay = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
      return `${yr}-${String(mo).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    }
  }

  // "Mar/2016", "Mar 2016", "Mar-2016", "Mar'16", "March2016"
  const mmy = s.match(
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*[/\-.']*(\d{2,4})$/i
  );
  if (mmy) {
    const mon = MONTH_MAP[mmy[1].slice(0, 3).toLowerCase()];
    if (!mon) return null;
    let yr = parseInt(mmy[2]);
    if (yr < 100) yr += yr < 50 ? 2000 : 1900;
    if (yr < 1990 || yr > 2099) return null;
    const lastDay = new Date(Date.UTC(yr, mon, 0)).getUTCDate();
    return `${yr}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // FY2016 / FY16
  const fy = s.match(/^fy'?(\d{2,4})$/i);
  if (fy) {
    let yr = parseInt(fy[1]);
    if (yr < 100) yr += yr < 50 ? 2000 : 1900;
    return `${yr}-03-31`;
  }

  return null;
}

function stmtFromFilename(name: string): CapitalineStatement {
  const n = name.toLowerCase();
  if (n.includes("balance")) return "BalanceSheet";
  if (
    n.includes("profit") || n.includes("p&l") ||
    n.includes("income") || n.includes("loss") || n.includes("pnl")
  ) return "ProfitLoss";
  if (n.includes("cash")) return "CashFlow";
  return "Unknown";
}

/* ══════════════════════════════════════════════════════════════════
   Parse Strategy A: SheetJS XLSX
══════════════════════════════════════════════════════════════════ */

async function gridViaXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const { default: XLSX } = await import("xlsx");
  const uint8 = new Uint8Array(buffer);
  let wb: any;
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

function gridViaHtml(text: string): string[][] {
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

function gridViaRegex(text: string): string[][] {
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

function gridScore(g: string[][]): number {
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

interface HeaderInfo {
  rowIndex: number;
  metricCol: number;
  periodCols: Array<{ col: number; period_end: string; label: string }>;
}

function detectHeader(grid: string[][]): HeaderInfo | null {
  const limit = Math.min(grid.length, 80);

  // Scan for rows with ≥3 period cols first, then ≥2, then ≥1
  for (const minPeriods of [3, 2, 1]) {
    for (let r = 0; r < limit; r++) {
      const h = tryHeaderRow(grid[r], r);
      if (h && h.periodCols.length >= minPeriods) return h;
    }
  }
  return null;
}

function tryHeaderRow(row: string[], rowIndex: number): HeaderInfo | null {
  if (!row || row.length < 2) return null;
  const periodCols: HeaderInfo["periodCols"] = [];
  for (let c = 0; c < row.length; c++) {
    const pe = tryParsePeriod(row[c]);
    if (pe) {
      periodCols.push({ col: c, period_end: pe, label: cleanCell(row[c]) });
    }
  }
  if (!periodCols.length) return null;
  return { rowIndex, metricCol: 0, periodCols };
}

/* ══════════════════════════════════════════════════════════════════
   Grid → period maps
══════════════════════════════════════════════════════════════════ */

type PeriodMap = Map<
  string,
  Map<string, { value: number | null; statement: CapitalineStatement; standard: AccountingStandard }>
>;

function gridToPeriods(
  grid: string[][],
  header: HeaderInfo,
  stmt: CapitalineStatement,
  std: AccountingStandard,
  multiplier: number = 1,
): PeriodMap {
  const out: PeriodMap = new Map();
  const aliasMap = buildAliasMap(std);

  for (let r = header.rowIndex + 1; r < grid.length; r++) {
    const row = grid[r];
    const metric = cleanCell(row[header.metricCol] ?? "");
    if (!metric) continue;

    // Skip pure section-heading rows (all value cells blank and metric has no numbers)
    const hasAnyValue = header.periodCols.some((pc) => {
      const raw = pc.col < row.length ? row[pc.col] : "";
      return parseNum(raw) !== null;
    });
    // Allow even zero-value rows — they carry real data (e.g. borrowings = 0)
    // Only skip if no values AND metric is clearly a section label
    if (!hasAnyValue) {
      // Check if it might be a section label by looking for trailing colon or all caps
      const isLabel =
        metric.endsWith(":") ||
        (metric === metric.toUpperCase() && metric.length > 3 && !/\d/.test(metric));
      if (isLabel) continue;
    }

    // Phase A: when parsing a non-Ind-AS file, emit BOTH the original label
    // (preserves traceability) AND the canonical Ind-AS label (so existing
    // mappingSpec lookups find the value transparently). The canonical key
    // is only emitted when the row has at least one non-null value AND the
    // canonical key isn't already present from a higher-precedence source.
    const canonicalLabel = aliasMap.get(metric);

    for (const pc of header.periodCols) {
      const cellText = pc.col < row.length ? row[pc.col] : "";
      const value = parseNum(cellText);

      if (!out.has(pc.period_end)) out.set(pc.period_end, new Map());
      const target = out.get(pc.period_end)!;

      // Original label — always written for traceability
      const originalKey = `${metric}__${stmt}`;
      const scaledValue = value != null && multiplier !== 1 ? value * multiplier : value;
      const existing = target.get(originalKey);
      if (existing === undefined || (existing.value === null && scaledValue !== null)) {
        target.set(originalKey, { value: scaledValue, statement: stmt, standard: std });
      }

      // Aliased canonical label — only when value present
      if (canonicalLabel && canonicalLabel !== metric && scaledValue !== null) {
        const canonicalKey = `${canonicalLabel}__${stmt}`;
        const canonExisting = target.get(canonicalKey);
        // Don't overwrite if a higher-precedence standard already wrote the
        // canonical key (that comparison happens in the main merge loop;
        // here we just write if absent or null).
        if (canonExisting === undefined || canonExisting.value === null) {
          target.set(canonicalKey, { value: scaledValue, statement: stmt, standard: std });
        }
      }
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════
   Main entry: parseCapitalineZip
══════════════════════════════════════════════════════════════════ */

export async function parseCapitalineZip(
  zipFile: File,
  opts?: { companyId?: string }
): Promise<{ periods: RawPeriodData[]; debug: CapitalineParseDebug }> {
  if (zipFile.size > MAX_ZIP_BYTES) {
    throw new Error(`ZIP exceeds size limit (${Math.round(MAX_ZIP_BYTES / (1024 * 1024))} MB).`);
  }

  const companyId = (opts?.companyId ?? "COMPANY").trim() || "COMPANY";
  const warnings: ParseWarning[] = [];

  /* 1. Open ZIP */
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipFile);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to open ZIP: ${msg}`);
  }

  const fileEntries = Object.values(zip.files).filter(
    (f) =>
      !f.dir &&
      /\.(xls|html?|xml|csv)$/i.test(f.name.split("/").pop() ?? "")
  );

  if (fileEntries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`ZIP contains too many candidate files (${fileEntries.length}); max allowed is ${MAX_ZIP_ENTRIES}.`);
  }

  const filesMeta = fileEntries.map((f) => ({
    name: f.name.split("/").pop() || f.name,
    statementGuess: stmtFromFilename(f.name.split("/").pop() || f.name),
  }));

  const rawGrids: RawGridDebug[] = [];
  // allPeriods: period_end → Map<compositeKey, {value, statement}>
  const allPeriods: PeriodMap = new Map();
  const sampleRows: CapitalineParseDebug["sample"]["firstRows"] = [];
  let sampleHeaderRow: string[] | undefined;

  // Phase I7 — track detected currency units across all files in the ZIP.
  // All files in a Capitaline export should share the same unit, but we
  // collect per-file detections and pick the most common non-null result.
  const detectedUnits: CurrencyUnit[] = [];

  /* 2. Parse each file */
  // Phase A: track which standards contribute to which period for provenance.
  const periodStandardCounts = new Map<
    string,
    Map<AccountingStandard, number>
  >();

  for (const entry of fileEntries) {
    const fileName = entry.name.split("/").pop() || entry.name;
    const stmtGuess = stmtFromFilename(fileName);
    // Phase A: pass the FULL entry path, not just the basename. Folders
    // like `revised schd/` and `standard/` are the only standard signal
    // when the filename itself has no INDAS/REV/STD suffix.
    const stdGuess = standardFromFilename(entry.name);

    const entryUncompressedSize = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (entryUncompressedSize != null && entryUncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error(
        `File ${fileName} exceeds per-file size limit (${Math.round(MAX_ENTRY_UNCOMPRESSED_BYTES / (1024 * 1024))} MB).`
      );
    }

    let buffer: ArrayBuffer;
    try {
      buffer = await entry.async("arraybuffer");
    } catch (e) {
      throw new Error(`Could not read '${fileName}': ${e instanceof Error ? e.message : String(e)}`);
    }

    const gd: RawGridDebug = {
      file: fileName,
      methods: [],
      bestMethod: "none",
      rowCount: 0,
      colCount: 0,
      firstRows: [],
      headerDetected: false,
      errors: [],
    };

    // Decode text for HTML strategies
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    const hasHtmlTable = /<table/i.test(text);
    const isSpreadsheetML =
      text.includes("<Workbook") && text.includes("<Worksheet");

    let grid: string[][] = [];
    let bestScore = 0;

    /* Strategy A: HTML DOM */
    if (hasHtmlTable) {
      try {
        const g = gridViaHtml(text);
        gd.methods.push(`html-dom→${g.length}r`);
        const s = gridScore(g);
        if (s > bestScore) {
          grid = g;
          bestScore = s;
          gd.bestMethod = "html-dom";
        }
      } catch (e) {
        gd.errors.push(`html-dom: ${e instanceof Error ? e.message : String(e)}`);
      }

      /* Strategy B: Regex */
      try {
        const g = gridViaRegex(text);
        gd.methods.push(`regex→${g.length}r`);
        const s = gridScore(g);
        if (s > bestScore) {
          grid = g;
          bestScore = s;
          gd.bestMethod = "regex";
        }
      } catch (e) {
        gd.errors.push(`regex: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    /* Strategy C: SpreadsheetML — only for real XML workbooks */
    if (isSpreadsheetML) {
      try {
        const g = gridViaSpreadsheetML(text);
        gd.methods.push(`ssml→${g.length}r`);
        const s = gridScore(g);
        if (s > bestScore) {
          grid = g;
          bestScore = s;
          gd.bestMethod = "ssml";
        }
      } catch (e) {
        gd.errors.push(`ssml: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    /* Strategy D: SheetJS fallback */
    const shouldTryXlsx = !hasHtmlTable && !isSpreadsheetML;
    if (shouldTryXlsx) {
      try {
        const g = await gridViaXlsx(buffer);
        gd.methods.push(`xlsx→${g.length}r`);
        const s = gridScore(g);
        if (s > bestScore) {
          grid = g;
          bestScore = s;
          gd.bestMethod = "xlsx";
        }
      } catch (e) {
        gd.errors.push(`xlsx: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    /* Header detection */
    const header = detectHeader(grid);

    // Phase I7 — detect currency unit from this file's grid.
    // Run detection on the full grid (before header row) so the
    // "Curr. in" row is found even when it sits above the period header.
    const fileUnit = detectCurrencyUnit(grid);
    if (fileUnit !== null) detectedUnits.push(fileUnit);
    const fileMultiplier = fileUnit !== null ? UNIT_TO_CR_MULTIPLIER[fileUnit] : 1;

    if (header) {
      gd.headerDetected = true;
      gd.headerRowIndex = header.rowIndex;
      gd.periodLabels = header.periodCols.map(
        (p) => `${p.label}→${p.period_end}`
      );

      if (!sampleHeaderRow) sampleHeaderRow = grid[header.rowIndex];

      const fp = gridToPeriods(grid, header, stmtGuess, stdGuess, fileMultiplier);
      for (const [pe, mmap] of fp) {
        if (!allPeriods.has(pe)) allPeriods.set(pe, new Map());
        const target = allPeriods.get(pe)!;

        // Phase A: standard precedence resolution.
        // When two files cover the same FY (e.g. INDAS + REV both report
        // FY2017), the higher-precedence standard wins for each composite
        // key. A non-null value from a lower-precedence standard fills
        // gaps where the higher-precedence file had null.
        for (const [k, v] of mmap) {
          const ex = target.get(k);
          if (!ex) {
            target.set(k, v);
          } else {
            const newPrec = STANDARD_PRECEDENCE[v.standard];
            const oldPrec = STANDARD_PRECEDENCE[ex.standard];
            if (newPrec > oldPrec) {
              // Higher-precedence standard always wins, even if its value is null.
              target.set(k, v);
            } else if (newPrec === oldPrec && ex.value === null && v.value !== null) {
              // Same precedence, null gets filled by non-null.
              target.set(k, v);
            } else if (newPrec < oldPrec && ex.value === null && v.value !== null) {
              // Lower-precedence fills null gap from higher-precedence.
              target.set(k, v);
            }
            // Otherwise: keep existing.
          }
        }

        // Track which standard contributed to this period (for provenance).
        if (!periodStandardCounts.has(pe)) {
          periodStandardCounts.set(pe, new Map());
        }
        const counts = periodStandardCounts.get(pe)!;
        counts.set(stdGuess, (counts.get(stdGuess) ?? 0) + mmap.size);
      }

      for (
        let r = header.rowIndex + 1;
        r < Math.min(grid.length, header.rowIndex + 15);
        r++
      ) {
        const row = grid[r];
        const metric = cleanCell(row[header.metricCol] ?? "");
        if (!metric) continue;
        const vals = header.periodCols.map((pc) =>
          pc.col < row.length ? cleanCell(row[pc.col]) || null : null
        );
        if (sampleRows.length < 40) {
          sampleRows.push({ metric, statement: stmtGuess, values: vals });
        }
      }
    } else {
      const dump = gd.firstRows
        .slice(0, 8)
        .map((r) =>
          r
            .slice(0, 8)
            .map((c) => (c.length > 40 ? c.slice(0, 40) + "…" : c || "·"))
            .join(" | ")
        )
        .join("\n");

      warnings.push({
        file: fileName,
        message: `Header not detected (${gd.rowCount} rows, best method: ${gd.bestMethod}).`,
        detail: dump || "Grid is empty",
      });
    }

    rawGrids.push(gd);
  }

  if (!allPeriods.size) {
    throw new Error("No usable Capitaline tables found in ZIP. Ensure filenames contain balance/profit/cash and sheets include fiscal year headers.");
  }

  // Phase I7 — resolve dominant currency unit across all files.
  // Pick the most common non-Unknown detection; fall back to Crores when
  // no currency row was found in any file (the historical default).
  let dominantUnit: CurrencyUnit = "Crores";
  if (detectedUnits.length > 0) {
    const unitCounts = new Map<CurrencyUnit, number>();
    for (const u of detectedUnits) unitCounts.set(u, (unitCounts.get(u) ?? 0) + 1);
    // Prefer the most frequent non-Unknown unit
    let bestCount = 0;
    for (const [u, cnt] of unitCounts) {
      if (u !== "Unknown" && cnt > bestCount) {
        bestCount = cnt;
        dominantUnit = u;
      }
    }
    // If all detections were Unknown, keep Unknown (pass-through, warn below)
    if (bestCount === 0 && unitCounts.has("Unknown")) dominantUnit = "Unknown";
  }

  // Emit a warning when the unit is non-Cr so the debug panel surfaces it.
  if (dominantUnit !== "Crores") {
    const multiplierStr = UNIT_TO_CR_MULTIPLIER[dominantUnit].toExponential();
    warnings.push({
      message: `Currency unit detected: ${dominantUnit}. All values have been scaled to ₹ Crores (multiplier: ${multiplierStr}).`,
      detail: dominantUnit === "Unknown"
        ? "Unit string in 'Curr. in' row was not recognised. Values are passed through unscaled — verify the output."
        : `Source values were in ${dominantUnit}. Engine always works in ₹ Crores.`,
    });
  }

  /* 3. Build RawPeriodData[] */
  const detectedPeriods = Array.from(allPeriods.keys()).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );

  // Build base-key collision map (for debug)
  const globalStmts = new Map<string, Set<CapitalineStatement>>();
  const globalKept = new Map<string, CapitalineStatement>();
  let totalComposite = 0;
  const byStmt: Record<CapitalineStatement, number> = {
    BalanceSheet: 0, ProfitLoss: 0, CashFlow: 0, Unknown: 0,
  };

  const periods: RawPeriodData[] = [];

  for (const period_end of detectedPeriods) {
    const cmap = allPeriods.get(period_end)!;
    const raw: Record<string, number | null> = {};

    // Track best base-key per statement for global winner
    const baseKeyBest = new Map<
      string,
      { stmt: CapitalineStatement; value: number | null }
    >();

    for (const [ck, payload] of cmap) {
      const sep = ck.indexOf("__");
      const metric = sep >= 0 ? ck.slice(0, sep) : ck;
      const stmt: CapitalineStatement =
        (sep >= 0 ? ck.slice(sep + 2) : payload.statement) as CapitalineStatement;

      // Store composite key
      raw[ck] = payload.value;
      totalComposite++;
      byStmt[stmt] = (byStmt[stmt] || 0) + 1;

      // Determine base-key winner (for backward compat with val() without preferStmt)
      const ex = baseKeyBest.get(metric);
      if (!ex || STMT_PRECEDENCE[stmt] > STMT_PRECEDENCE[ex.stmt]) {
        baseKeyBest.set(metric, { stmt, value: payload.value });
      }

      // Track global collisions for debug
      if (!globalStmts.has(metric)) globalStmts.set(metric, new Set());
      globalStmts.get(metric)!.add(stmt);
      const gex = globalKept.get(metric);
      if (!gex || STMT_PRECEDENCE[stmt] > STMT_PRECEDENCE[gex]) {
        globalKept.set(metric, stmt);
      }
    }

    // Write base-key winners (for simple val() lookups)
    for (const [m, o] of baseKeyBest) {
      raw[m] = o.value;
    }

    // Phase A: derive dominant standard for this period.
    const stdCounts = periodStandardCounts.get(period_end);
    let dominantStandard: AccountingStandard = "unknown";
    if (stdCounts) {
      let bestPrec = -1;
      let bestCount = -1;
      for (const [std, cnt] of stdCounts) {
        const p = STANDARD_PRECEDENCE[std];
        // Higher precedence wins, with count as tiebreaker.
        if (p > bestPrec || (p === bestPrec && cnt > bestCount)) {
          bestPrec = p;
          bestCount = cnt;
          dominantStandard = std;
        }
      }
    }

    periods.push({
      company_id: companyId,
      period_end,
      raw_metric_values: raw,
      accounting_standard: dominantStandard,
      currency_unit: dominantUnit,
    });
  }

  // Build collision list for debug
  const collisions: CapitalineParseDebug["metrics"]["baseKeyCollisions"] = [];
  for (const [metric, stmts] of globalStmts) {
    if (stmts.size > 1) {
      collisions.push({
        metric,
        statements: Array.from(stmts),
        keptStatement: globalKept.get(metric) ?? "Unknown",
      });
    }
  }

  const firstPeriodKeys =
    periods.length > 0
      ? Object.keys(periods[0].raw_metric_values).filter(
          (k) => !k.includes("__")
        )
      : [];

  const debug: CapitalineParseDebug = {
    companyId,
    files: filesMeta,
    detectedPeriods,
    rawGrids,
    metrics: {
      totalCompositeKeys: totalComposite,
      totalBaseKeys: firstPeriodKeys.length,
      baseKeyCollisions: collisions,
      byStatement: byStmt,
    },
    warnings,
    sample: { headerRow: sampleHeaderRow, firstRows: sampleRows },
    rawMetricKeys: firstPeriodKeys,
  };

  return { periods, debug };
}

/* ══════════════════════════════════════════════════════════════════
   SpreadsheetML parser (true XML workbooks only)
══════════════════════════════════════════════════════════════════ */

function gridViaSpreadsheetML(text: string): string[][] {
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
