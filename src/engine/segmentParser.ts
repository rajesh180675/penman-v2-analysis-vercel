/**
 * Segment Finance Parser — Generic / Frequency-Based
 *
 * Parses Capitaline SegmentFinance HTML exports into typed segment data.
 * 
 * DESIGN: No dependency on specific Capitaline sub-section labels.
 * Segments are identified by structural properties:
 *   - ALL CAPS labels that repeat 2+ times across the file = segment names
 *   - Everything else = structural labels (sub-section headers, totals, etc.)
 *
 * The only hard-coded knowledge:
 *   1. Three top-level section headers: REVENUE, RESULT, OTHER INFORMATION
 *   2. Metric sequence within each section (Capitaline's fixed ordering)
 *   3. HTML structure (labels in <label>, data in <td>/<div>, rows in <tr>)
 */

export interface SegmentPeriodData {
  revenue: number | null;
  interSegmentRevenue: number | null;
  result: number | null;  // Segment profit/loss before interest & tax
  assets: number | null;
  liabilities: number | null;
  capex: number | null;
  depreciation: number | null;
  nonCashExpenditure: number | null;
}

export interface SegmentData {
  segmentationType: "business" | "geographic" | "total";
  segments: string[];
  years: string[];  // FY labels like "FY2025", "FY2024", ...
  data: Record<string, Record<string, SegmentPeriodData>>;  // segment → year → metrics
  unallocated: Record<string, {
    assets: number | null;
    liabilities: number | null;
    capex: number | null;
    depreciation: number | null;
    nonCashExpenditure: number | null;
    otherIncome: number | null;
    interestExpense: number | null;
  }>;
  totals: Record<string, {
    revenue: number | null;
    pbt: number | null;
    pat: number | null;
    assets: number | null;
    liabilities: number | null;
    capex: number | null;
    depreciation: number | null;
  }>;
}

/** All segment dimensions parsed from a company's ZIP — business, geographic, and mixed. */
export interface AllSegmentData {
  business: SegmentData | null;
  geographic: SegmentData | null;
  mixed: SegmentData | null;
}

// ─── Only 3 hard-coded values: the top-level section headers ───────────────
const SECTION_HEADERS = new Set(["REVENUE", "RESULT", "OTHER INFORMATION"]);

// ─── Metric sequence per section (Capitaline's fixed ordering) ─────────────
type MetricSlot = "revenue" | "interSegmentRevenue" | "totalRev" | "result" |
  "assets" | "liabilities" | "capex" | "depreciation" | "nonCashExpenditure" | null;

const REVENUE_METRICS: MetricSlot[] = ["revenue", "interSegmentRevenue", "totalRev"];
const RESULT_METRICS: MetricSlot[] = ["result"];
const OTHER_INFO_METRICS: MetricSlot[] = ["assets", "liabilities", "capex", "depreciation", "nonCashExpenditure"];

// ─── Utility functions ─────────────────────────────────────────────────────

/** Decode common HTML entities (&amp; &lt; &gt; &quot; &#NNN; &#xHH;) */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseNumber(s: string): number | null {
  if (!s || s.trim() === "" || s.trim() === "-") return null;
  let cleaned = s.replace(/,/g, "").trim();
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    cleaned = "-" + cleaned.slice(1, -1);
  }
  const val = parseFloat(cleaned);
  return Number.isFinite(val) ? val : null;
}

function yearFromYYYYMM(yyyymm: string): string {
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10);
  return month <= 3 ? `FY${year}` : `FY${year + 1}`;
}

/** Structural exclusion: labels matching these patterns are never segments */
function isStructuralPattern(label: string): boolean {
  const l = label.toLowerCase();
  return l === "total" || l.startsWith("total ") ||
    l.includes("unallocated") || l.includes("un-allocable") ||
    l.includes("unallocable");
}

/**
 * Parse a Capitaline SegmentFinance HTML file into structured segment data.
 */
export function parseSegmentFinanceHTML(html: string): SegmentData | null {
  // ─── Step 1: Extract years ────────────────────────────────────────────
  const yearMatch = html.match(/(\d{6}(?:\s+\d{6})*)/);
  if (!yearMatch) return null;

  const yearMatches = Array.from(html.matchAll(/ng-binding[^>]*>(\d{6})/g)).map(m => m[1]!);
  const years = yearMatches.length > 0
    ? yearMatches.map(yearFromYYYYMM)
    : yearMatch[1]!.split(/\s+/).map(yearFromYYYYMM);

  if (years.length === 0) return null;

  // ─── Step 2: Extract all labels (decoded) ─────────────────────────────
  const labelMatches = Array.from(html.matchAll(/<label[^>]*>([^<]+)<\/label>/g))
    .map(m => decodeHtmlEntities(m[1]!.trim()));
  if (labelMatches.length === 0) return null;

  // ─── Step 3: Extract labeled data rows ────────────────────────────────
  interface LabeledRow { label: string; values: (number | null)[]; }
  const labeledRows: LabeledRow[] = [];
  const trBlocks = html.split(/<tr[\s>]/i).slice(1);
  for (const tr of trBlocks) {
    const labelMatch = tr.match(/<label[^>]*>([^<]+)<\/label>/);
    const label = labelMatch ? decodeHtmlEntities(labelMatch[1]!.trim()) : "";

    let values: (number | null)[] = [];

    // Try ng-binding first (totals/header-level rows)
    const ngCells = Array.from(tr.matchAll(/ng-binding[^>]*>([^<]*)/g))
      .map(m => m[1]!.trim());
    const ngValues = ngCells.filter(s =>
      /^-?[\d,]+\.?\d*$/.test(s) || /^\(-?[\d,]+\.?\d*\)$/.test(s) ||
      s === "0" || s === "0.00" || s === "-" || s === ""
    );

    if (ngValues.length === years.length) {
      const isYearRow = ngValues.every(c => /^\d{6}$/.test(c.replace(/,/g, "")));
      if (!isYearRow) {
        values = ngValues.map(parseNumber);
      } else {
        continue;
      }
    } else {
      // Try td cells
      const tdContents = Array.from(tr.matchAll(/<td[^>]*>([^<]*)<\/td>/g))
        .map(m => m[1]!.trim());
      const tdValues = tdContents.filter(s =>
        /^-?[\d,]+\.?\d*$/.test(s) || s === "-"
      );
      if (tdValues.length === years.length) {
        values = tdValues.map(parseNumber);
      } else if (tdValues.length > years.length) {
        // Some Capitaline SegmentFinance exports (TCS) render historical
        // breakup rows wider than the visible Angular year header. Columns are
        // newest-first, so keep the values that align with the reported years
        // and drop older hidden tail columns instead of dropping the row.
        values = tdValues.slice(0, years.length).map(parseNumber);
      } else if (tdValues.length > 0 && tdValues.length < years.length &&
                 tdValues.length >= Math.max(2, Math.floor(years.length / 3))) {
        // Variable-length rows: segments not present in all years have fewer columns
        values = tdValues.map(parseNumber);
        while (values.length < years.length) values.push(null);
      }
    }

    if (values.length === years.length && label) {
      labeledRows.push({ label, values });
    }
  }

  const dataRows = labeledRows.map(r => r.values);

  // ─── Step 4: Identify segments by FREQUENCY + CASE ────────────────────
  // Key insight: segment names repeat many times (once per metric cycle across
  // all sections). Structural labels appear 1-2 times at most.
  // A label is a segment if: ALL CAPS + appears 2+ times + not a section header
  // + not a structural pattern (Total/Unallocated).

  const labelCounts = new Map<string, number>();
  for (const label of labelMatches) {
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  }

  const segments: string[] = [];
  const seenSegments = new Set<string>();
  for (const label of labelMatches) {
    if (seenSegments.has(label)) continue;
    if (SECTION_HEADERS.has(label)) continue;
    if (isStructuralPattern(label)) continue;

    // Segment detection: ALL CAPS + repeats 2+ times
    const count = labelCounts.get(label) || 0;
    if (label.toUpperCase() === label && count >= 2) {
      segments.push(label);
      seenSegments.add(label);
    }
  }

  if (segments.length === 0) return null;

  // ─── Step 5: Determine segmentation type ──────────────────────────────
  const segLower = segments.map(s => s.toLowerCase());
  const isGeographic = segLower.some(s =>
    s.includes("india") || s.includes("domestic") || s.includes("international") ||
    s.includes("outside") || s.includes("within") || s.includes("overseas") ||
    s.includes("foreign")
  );
  const segmentationType: SegmentData["segmentationType"] =
    segments.length <= 1 ? "total" : isGeographic ? "geographic" : "business";

  // ─── Step 6: Initialize data structures ───────────────────────────────
  const data: SegmentData["data"] = {};
  const unallocated: SegmentData["unallocated"] = {};
  const totals: SegmentData["totals"] = {};

  for (const seg of segments) {
    data[seg] = {};
    for (const yr of years) {
      data[seg][yr] = {
        revenue: null, interSegmentRevenue: null, result: null,
        assets: null, liabilities: null, capex: null,
        depreciation: null, nonCashExpenditure: null,
      };
    }
  }
  for (const yr of years) {
    unallocated[yr] = {
      assets: null, liabilities: null, capex: null,
      depreciation: null, nonCashExpenditure: null,
      otherIncome: null, interestExpense: null,
    };
    totals[yr] = {
      revenue: null, pbt: null, pat: null,
      assets: null, liabilities: null, capex: null, depreciation: null,
    };
  }

  // ─── Step 7: Assign data rows to segments and metrics ─────────────────
  // Strategy: purely structural, no keyword matching needed.
  //
  // Rules:
  //   - Section header → reset metric to first in section's sequence
  //   - Segment label (in seenSegments) → assign current row to current metric
  //   - Segment repeats (already seen in this cycle) → advance metric index
  //   - Any other label with a data row → structural; consume row, don't assign
  //
  // This works because:
  //   - Metric sequences are fixed per section (Capitaline convention)
  //   - Cycle boundaries are detectable by segment repetition
  //   - Structural labels (sub-section headers, totals) naturally fall into "other"

  let rowIdx = 0;
  let currentMetric: MetricSlot = null;
  let sectionMetrics: MetricSlot[] = [];
  let metricIndex = 0;
  const seenInCycle = new Set<string>();

  for (const label of labelMatches) {
    if (SECTION_HEADERS.has(label)) {
      if (label === "REVENUE") { sectionMetrics = REVENUE_METRICS; metricIndex = 0; }
      else if (label === "RESULT") { sectionMetrics = RESULT_METRICS; metricIndex = 0; }
      else { sectionMetrics = OTHER_INFO_METRICS; metricIndex = 0; }
      currentMetric = sectionMetrics[0]!;
      seenInCycle.clear();
      continue;
    }

    // Any label with a data row that's NOT a segment → structural; consume row
    if (!seenSegments.has(label)) {
      if (rowIdx < dataRows.length) rowIdx++;
      continue;
    }

    // ── Segment label handling ──
    if (rowIdx >= dataRows.length) break;

    // Cycle boundary: segment already seen → advance metric
    if (seenInCycle.has(label)) {
      metricIndex++;
      if (metricIndex < sectionMetrics.length) {
        currentMetric = sectionMetrics[metricIndex]!;
      } else {
        currentMetric = null;
      }
      seenInCycle.clear();
    }
    seenInCycle.add(label);

    const row = dataRows[rowIdx]!;
    rowIdx++;

    if (!currentMetric || currentMetric === "totalRev") continue;

    // Assign values
    for (let yi = 0; yi < years.length && yi < row.length; yi++) {
      const yr = years[yi]!;
      const val = row[yi] ?? null;
      if (!data[label]?.[yr]) continue;
      data[label][yr][currentMetric] = val;
    }
  }

  return { segmentationType, segments, years, data, unallocated, totals };
}

/**
 * Detect segment file type from filename.
 * Capitaline exports: SegmentFinance_.xls (business), SegmentFinance_ (1).xls (geographic), SegmentFinance_ (2).xls (total)
 */
export function classifySegmentFile(_filename: string, segments: string[]): SegmentData["segmentationType"] {
  const segLower = segments.map(s => s.toLowerCase());
  if (segLower.some(s => s.includes("india") || s.includes("domestic") || s.includes("international"))) {
    return "geographic";
  }
  if (segments.length <= 1) return "total";
  return "business";
}
