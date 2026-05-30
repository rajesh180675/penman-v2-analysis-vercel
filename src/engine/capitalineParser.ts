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
import { AllSegmentData } from "./segmentParser";
import { trace } from "../lib/traceLogger";
import {
  AccountingStandard,
  STANDARD_PRECEDENCE,
  standardFromFilename,
} from "./standardAliases";
import {
  CapitalineStatement,
  ParseWarning,
  RawGridDebug,
  CapitalineParseDebug,
  CurrencyUnit,
  PeriodMap,
} from "./capitalineParser/types";
import {
  UNIT_TO_CR_MULTIPLIER,
  detectCurrencyUnit,
  cleanCell,
  stmtFromFilename,
} from "./capitalineParser/cells";
import {
  gridViaXlsx,
  gridViaHtml,
  gridViaRegex,
  gridScore,
  detectHeader,
  gridViaSpreadsheetML,
} from "./capitalineParser/grid";
import { gridToPeriods } from "./capitalineParser/gridToPeriods";
import { parseSegmentFilesFromZip } from "./capitalineParser/segments";

/* ══════════════════════════════════════════════════════════════════
   Public types — re-exported from ./capitalineParser/types
══════════════════════════════════════════════════════════════════ */

export type {
  CapitalineStatement,
  ParseWarning,
  PeriodStandardProvenance,
  RawGridDebug,
  CapitalineParseDebug,
  CurrencyUnit,
} from "./capitalineParser/types";

/* ══════════════════════════════════════════════════════════════════
   Currency unit detection — re-exported from ./capitalineParser/cells
══════════════════════════════════════════════════════════════════ */

export { UNIT_TO_CR_MULTIPLIER, detectCurrencyUnit } from "./capitalineParser/cells";

const MAX_ZIP_BYTES = 25 * 1024 * 1024; // 25 MB archive upload cap
const MAX_ZIP_ENTRIES = 64;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 20 * 1024 * 1024; // 20 MB per file

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
  Segment: 0,
  Unknown: 0,
};

/* ══════════════════════════════════════════════════════════════════
   Main entry: parseCapitalineZip
══════════════════════════════════════════════════════════════════ */

export async function parseCapitalineZip(
  zipFile: File | Blob | ArrayBuffer | Uint8Array,
  opts?: { companyId?: string; filename?: string }
): Promise<{ periods: RawPeriodData[]; debug: CapitalineParseDebug; segmentData: AllSegmentData | null }> {
  // Normalize input — Node 24 native File doesn't expose a Blob shape JSZip can
  // read, so we always pass JSZip a Uint8Array.
  let zipBytes: Uint8Array;
  let zipName: string;
  let zipSize: number;
  if (zipFile instanceof Uint8Array) {
    zipBytes = zipFile;
    zipName = opts?.filename ?? "input.zip";
    zipSize = zipFile.byteLength;
  } else if (zipFile instanceof ArrayBuffer) {
    zipBytes = new Uint8Array(zipFile);
    zipName = opts?.filename ?? "input.zip";
    zipSize = zipFile.byteLength;
  } else {
    // File or Blob — has .arrayBuffer().
    zipBytes = new Uint8Array(await zipFile.arrayBuffer());
    zipName = ("name" in zipFile && typeof zipFile.name === "string") ? zipFile.name : (opts?.filename ?? "input.zip");
    zipSize = zipFile.size;
  }

  if (zipSize > MAX_ZIP_BYTES) {
    throw new Error(`ZIP exceeds size limit (${Math.round(MAX_ZIP_BYTES / (1024 * 1024))} MB).`);
  }

  const companyId = (opts?.companyId ?? "COMPANY").trim() || "COMPANY";
  const warnings: ParseWarning[] = [];

  /* 1. Open ZIP */
  trace("parse", "zipLoad:start", { filename: zipName, sizeBytes: zipSize, companyId });
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    trace("parse", "zipLoad:error", { error: msg }, null, { level: "error" });
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

    // Phase C5: skip segment files from normal grid processing — they use a
    // completely different parser (parseSegmentFinanceHTML).
    if (stmtGuess === "Segment") continue;

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
        const row = grid[r]!;
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
    BalanceSheet: 0, ProfitLoss: 0, CashFlow: 0, Segment: 0, Unknown: 0,
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
      ? Object.keys(periods[0]!.raw_metric_values).filter(
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

  trace("parse", "zipLoad:complete", { periods: periods.length, companyId });

  return { periods, debug, segmentData: await parseSegmentFilesFromZip(fileEntries as unknown as Parameters<typeof parseSegmentFilesFromZip>[0]) };
}
