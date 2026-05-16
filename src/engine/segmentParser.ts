/**
 * Segment Finance Parser
 *
 * Parses Capitaline SegmentFinance HTML exports into typed segment data.
 * Handles both business segments (FMCG, Hotels, etc.) and geographic
 * segments (Within India, Outside India).
 *
 * Structure of Capitaline segment files:
 * - Labels appear in order: section header → segment names (repeated per section)
 * - Data rows: 15 cells per row (one per year), 32 rows total for ITC
 * - Sections: REVENUE, RESULT, OTHER INFORMATION (Assets, Liabilities, Capex, Depreciation, Non-Cash)
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

/** Known section headers in Capitaline segment files */
const SECTION_HEADERS = new Set([
  "REVENUE", "RESULT", "OTHER INFORMATION",
]);

/** Known sub-section labels */
const SUB_SECTION_LABELS = new Set([
  "Revenue from Operations",
  "Less/Add : Inter Segment Revenues",
  "Total Segment Revenue",
  "Profit/Loss Before Interest & Tax",
  "Segment Assets",
  "Segment Liabilities",
  "Capital Expenditure",
  "Depreciation/Amortisation",
  "Non Cash Expenditure",
  "Add : Other Unallocable Income/Exp.",
  "Other Income",
  "Net Revenue from Operations",
  "Less : Interest Expense",
  "Other Un-allocable Expenditure",
  "Add : Other Income",
  "Extra-Ordinary Income/Expense",
  "Net Profit/Loss Before Tax",
  "Income Tax",
  "Fringe Benefit Tax",
  "Deferred Tax",
  "Net Profit",
  "Unallocated Corporate Assets",
  "Total Assets",
  "Unallocated Corporate Liabilities",
  "Total Liabilities",
  "Net Assets",
  "TOTAL",
  "Unallocated Capital Expenditure",
  "Total Capital Expenditure",
  "Unallocated Depn/Amortn.",
  "Total Depreciation/Amortisation",
  "Unallocated Non-Cash Exp.",
  "Total Non Cash Expenditure",
]);

function parseNumber(s: string): number | null {
  if (!s || s.trim() === "" || s.trim() === "-") return null;
  // Remove commas, handle negative in parentheses
  let cleaned = s.replace(/,/g, "").trim();
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    cleaned = "-" + cleaned.slice(1, -1);
  }
  const val = parseFloat(cleaned);
  return Number.isFinite(val) ? val : null;
}

function yearFromYYYYMM(yyyymm: string): string {
  // "202503" → "FY2025"
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10);
  // Indian FY: March ending → FY is the year of March
  return month <= 3 ? `FY${year}` : `FY${year + 1}`;
}

interface ParsedRow {
  label: string;
  section: string;
  subSection: string;
  values: (number | null)[];
}

/**
 * Parse a Capitaline SegmentFinance HTML file into structured segment data.
 */
export function parseSegmentFinanceHTML(html: string): SegmentData | null {
  // Extract years from header (YYYYMM format)
  const yearMatch = html.match(/(\d{6}(?:\s+\d{6})*)/);
  if (!yearMatch) return null;

  // Also try ng-binding pattern for years
  const yearMatches = Array.from(html.matchAll(/ng-binding[^>]*>(\d{6})/g)).map(m => m[1]);
  const years = yearMatches.length > 0
    ? yearMatches.map(yearFromYYYYMM)
    : yearMatch[1].split(/\s+/).map(yearFromYYYYMM);

  if (years.length === 0) return null;

  // Extract labels in order
  const labelMatches = Array.from(html.matchAll(/<label[^>]*>([^<]+)<\/label>/g)).map(m => m[1].trim());
  if (labelMatches.length === 0) return null;

  // Extract data rows (div with ng-binding containing numbers)
  const dataRows: (number | null)[][] = [];
  // Find all <tr> blocks and extract numeric cells
  const trBlocks = html.split(/<tr[\s>]/i).slice(1); // skip before first <tr>
  for (const tr of trBlocks) {
    // Extract all numeric values from divs in this row
    const cellMatches = Array.from(tr.matchAll(/ng-binding[^>]*>([^<]*)/g))
      .map(m => m[1].trim())
      .filter(s => /^-?[\d,]+\.?\d*$/.test(s) || /^\(-?[\d,]+\.?\d*\)$/.test(s) || s === "0" || s === "0.00");

    if (cellMatches.length === years.length) {
      dataRows.push(cellMatches.map(parseNumber));
    }
  }

  // Identify segments (labels that are NOT section headers or sub-section labels)
  const segments: string[] = [];
  const seenSegments = new Set<string>();
  for (const label of labelMatches) {
    if (SECTION_HEADERS.has(label)) continue;
    if (SUB_SECTION_LABELS.has(label)) continue;
    if (label.toUpperCase() === label && !seenSegments.has(label) && label !== "TOTAL") {
      segments.push(label);
      seenSegments.add(label);
    }
  }

  if (segments.length === 0) return null;

  // Determine segmentation type
  const segLower = segments.map(s => s.toLowerCase());
  const isGeographic = segLower.some(s =>
    s.includes("india") || s.includes("domestic") || s.includes("international") ||
    s.includes("outside") || s.includes("within")
  );
  const segmentationType: SegmentData["segmentationType"] =
    segments.length <= 1 ? "total" : isGeographic ? "geographic" : "business";

  // Map data rows to segments and sections
  // The pattern is: each section has one row per segment (in segment order)
  const numSegments = segments.length;
  const data: SegmentData["data"] = {};
  const unallocated: SegmentData["unallocated"] = {};
  const totals: SegmentData["totals"] = {};

  // Initialize
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

  // Assign rows to sections based on expected pattern:
  // Revenue: segments × 1 (revenue from ops) + segments × 1 (inter-segment) + segments × 1 (total)
  // Result: segments × 1 (profit)
  // Other Info: segments × 1 (assets) + segments × 1 (liabilities) + segments × 1 (capex) + segments × 1 (depreciation) + segments × 1 (non-cash)
  // Total expected segment rows: numSegments × 8 sections
  // Plus unallocated/total rows

  // Simpler approach: assign rows sequentially based on label order
  // Each segment-name label corresponds to one data row
  let rowIdx = 0;
  let currentSection = "";
  let currentSubSection = "";

  for (const label of labelMatches) {
    if (SECTION_HEADERS.has(label)) {
      currentSection = label;
      continue;
    }
    if (SUB_SECTION_LABELS.has(label)) {
      currentSubSection = label;
      continue;
    }

    // This is a segment name or TOTAL — it should correspond to a data row
    if (rowIdx >= dataRows.length) break;

    const row = dataRows[rowIdx];
    rowIdx++;

    if (seenSegments.has(label)) {
      // Assign to segment data based on current sub-section
      for (let yi = 0; yi < years.length && yi < row.length; yi++) {
        const yr = years[yi];
        const val = row[yi];
        if (!data[label]?.[yr]) continue;

        if (currentSubSection === "Revenue from Operations" || (currentSection === "REVENUE" && currentSubSection === "")) {
          data[label][yr].revenue = val;
        } else if (currentSubSection === "Less/Add : Inter Segment Revenues") {
          data[label][yr].interSegmentRevenue = val;
        } else if (currentSubSection === "Total Segment Revenue") {
          data[label][yr].revenue = val; // override with total if available
        } else if (currentSection === "RESULT" && (currentSubSection === "Profit/Loss Before Interest & Tax" || currentSubSection === "")) {
          data[label][yr].result = val;
        } else if (currentSubSection === "Segment Assets") {
          data[label][yr].assets = val;
        } else if (currentSubSection === "Segment Liabilities") {
          data[label][yr].liabilities = val;
        } else if (currentSubSection === "Capital Expenditure" || currentSubSection === "TOTAL") {
          data[label][yr].capex = val;
        } else if (currentSubSection === "Depreciation/Amortisation") {
          data[label][yr].depreciation = val;
        } else if (currentSubSection === "Non Cash Expenditure") {
          data[label][yr].nonCashExpenditure = val;
        }
      }
    }
    // Skip TOTAL and unallocated rows (they consume a data row but we don't store them yet)
  }

  return {
    segmentationType,
    segments,
    years,
    data,
    unallocated,
    totals,
  };
}

/**
 * Detect segment file type from filename.
 * Capitaline exports: SegmentFinance_.xls (business), SegmentFinance_ (1).xls (geographic), SegmentFinance_ (2).xls (total)
 */
export function classifySegmentFile(filename: string, segments: string[]): SegmentData["segmentationType"] {
  const segLower = segments.map(s => s.toLowerCase());
  if (segLower.some(s => s.includes("india") || s.includes("domestic") || s.includes("international"))) {
    return "geographic";
  }
  if (segments.length <= 1) return "total";
  return "business";
}
