import { CapitalineStatement, CurrencyUnit } from "./types";

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/* ══════════════════════════════════════════════════════════════════
   Currency unit detection — Phase I7
══════════════════════════════════════════════════════════════════ */

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

    const label = norm(row[0]!).toLowerCase();
    if (!label.includes("curr") && !label.includes("unit") && !label.includes("denomination")) {
      continue;
    }

    // Found a currency label row — read the first non-empty value cell
    for (let c = 1; c < row.length; c++) {
      const cell = norm(row[c]!).toLowerCase();
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

export function norm(s: string): string {
  if (!s) return "";
  return s
    .replace(/ /g, " ")
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
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
export function cleanCell(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw);

  // Check if there's any HTML/Angular residue
  if (s.includes(">") || s.includes("<")) {
    // Phase I10/I11: If content contains ng-binding elements, extract their text first.
    // Vodafone Idea values: <div class="ng-binding">43,571.30</div>
    // Bajaj Finance INDAS metric names: <label class="ng-binding ng-scope font-bold">Net Worth</label>
    //   or breakup labels: <label class="breakup ng-binding ng-scope">Property, Plant and Equipment <span>...</span></label>
    // The old "take text after last >" fails because closing tags come after the value.
    const ngBindingMatch = s.match(/<(?:div|label)[^>]*class="[^"]*ng-binding[^"]*"[^>]*>\s*([^<]+)/);
    if (ngBindingMatch) {
      s = ngBindingMatch[1]!;
    } else {
      // Take everything after the LAST `>`
      const gIdx = s.lastIndexOf(">");
      if (gIdx >= 0) {
        s = s.slice(gIdx + 1);
        // …unless that leaves nothing, which happens when the content is wrapped
        // in a plain tag carrying no ng-binding class:
        //   <label style="padding-left:15px;">Goodwill</label>
        // Here the last `>` closes `</label>`, so the slice above is "" and the
        // metric-name column silently blanked. On TCS's balance sheet that hit
        // 1697 of 1789 rows, and gridToPeriods drops every labelless row (there
        // is no key to file its values under), losing ~89% of the metrics while
        // still reporting a healthy 15-period parse.
        //
        // Falling back only when the slice is empty keeps the Angular
        // attribute-residue case intact — `… 'red'" class="ng-scope">22,403.63`
        // still resolves via the slice, because there the slice is non-empty and
        // stripping tags would leave the residue behind.
        if (!s.trim()) s = raw.replace(/<[^>]*>/g, "");
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

export function parseNum(cell: string | null | undefined): number | null {
  if (cell == null) return null;
  const s = cleanCell(String(cell));
  if (!s) return null;
  // em-dash, en-dash, hyphen alone = null/missing
  if (/^[-–—]+$/.test(s)) return null;
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
export function tryParsePeriod(rawCell: string): string | null {
  const s = cleanCell(rawCell).replace(/\s+/g, "");
  if (!s || s.length < 4) return null;

  // YYYYMM (e.g. 202503) — Capitaline's standard export format
  const ym = s.match(/^(\d{4})(\d{2})$/);
  if (ym) {
    const yr = parseInt(ym[1]!);
    const mo = parseInt(ym[2]!);
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
    const mon = MONTH_MAP[mmy[1]!.slice(0, 3).toLowerCase()];
    if (!mon) return null;
    let yr = parseInt(mmy[2]!);
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
    let yr = parseInt(fy[1]!);
    if (yr < 100) yr += yr < 50 ? 2000 : 1900;
    return `${yr}-03-31`;
  }

  return null;
}

export function stmtFromFilename(name: string): CapitalineStatement {
  const n = name.toLowerCase();
  if (n.includes("balance")) return "BalanceSheet";
  if (
    n.includes("profit") || n.includes("p&l") ||
    n.includes("income") || n.includes("loss") || n.includes("pnl")
  ) return "ProfitLoss";
  if (n.includes("cash")) return "CashFlow";
  if (n.includes("segment")) return "Segment";
  return "Unknown";
}
