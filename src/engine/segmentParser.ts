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

/** Sub-section labels that DO have associated data rows (must consume a row when encountered) */
const SUB_SECTION_WITH_DATA = new Set([
  "Revenue from Operations",
  "Less/Add : Inter Segment Revenues",
  "Total Segment Revenue",
  "Net Revenue from Operations",
  "Profit/Loss Before Interest & Tax",
  "Segment Assets",
  "Segment Liabilities",
  "Capital Expenditure",
  "Depreciation/Amortisation",
  "Non Cash Expenditure",
  "Add : Other Unallocable Income/Exp.",
  "Other Income",
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

  // Extract data rows — Capitaline uses TWO formats:
  // 1. ng-binding divs (totals/headers): <div class="ng-binding ng-scope">73,464.55</div>
  // 2. td cells (segment detail): <td class="datarow">4224.04</td> or plain <td>4224.04</td>
  // Strategy: extract label + values from each <tr> as a pair
  interface LabeledRow { label: string; values: (number | null)[]; }
  const labeledRows: LabeledRow[] = [];
  const trBlocks = html.split(/<tr[\s>]/i).slice(1);
  for (const tr of trBlocks) {
    // Extract label from this row
    const labelMatch = tr.match(/<label[^>]*>([^<]+)<\/label>/);
    const label = labelMatch ? labelMatch[1].trim() : "";

    // Extract numeric values — try ng-binding first, then td cells
    let values: (number | null)[] = [];

    const ngCells = Array.from(tr.matchAll(/ng-binding[^>]*>([^<]*)/g))
      .map(m => m[1].trim());
    const ngValues = ngCells.filter(s =>
      /^-?[\d,]+\.?\d*$/.test(s) || /^\(-?[\d,]+\.?\d*\)$/.test(s) ||
      s === "0" || s === "0.00" || s === "-" || s === ""
    );

    if (ngValues.length === years.length) {
      const isYearRow = ngValues.every(c => /^\d{6}$/.test(c.replace(/,/g, "")));
      if (!isYearRow) {
        values = ngValues.map(parseNumber);
      } else {
        continue; // skip year header
      }
    } else {
      // Try td content extraction (skip first td which contains the label)
      const tdContents = Array.from(tr.matchAll(/<td[^>]*>([^<]*)<\/td>/g))
        .map(m => m[1].trim());
      // Filter to value-like cells
      const tdValues = tdContents.filter(s =>
        /^-?[\d,]+\.?\d*$/.test(s) || s === "-" || s === ""
      );
      if (tdValues.length === years.length) {
        values = tdValues.map(parseNumber);
      }
    }

    if (values.length === years.length && label) {
      labeledRows.push({ label, values });
    }
  }

  // Now process labeledRows in order
  const dataRows = labeledRows.map(r => r.values);
  const rowLabels = labeledRows.map(r => r.label);

  // Identify segments (labels that are NOT section headers or sub-section labels)
  const segments: string[] = [];
  const seenSegments = new Set<string>();
  for (const label of labelMatches) {
    if (SECTION_HEADERS.has(label)) continue;
    if (SUB_SECTION_WITH_DATA.has(label)) continue;
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

  // Assign rows to sections based on label order.
  // Pattern: within each section, segment names repeat in cycles.
  // REVENUE: cycle 1 = revenue from ops, cycle 2 = inter-segment, cycle 3 = total segment revenue
  // RESULT: cycle 1 = segment EBIT
  // OTHER INFORMATION: cycle 1 = assets, cycle 2 = liabilities, cycle 3 = capex, cycle 4 = depreciation, cycle 5 = non-cash
  let rowIdx = 0;
  let currentSection = "";
  let cycleInSection = 0; // which cycle of segment names we're in within current section
  let segmentCountInCycle = 0; // how many segment names seen in current cycle

  for (const label of labelMatches) {
    if (SECTION_HEADERS.has(label)) {
      currentSection = label;
      cycleInSection = 0;
      segmentCountInCycle = 0;
      continue;
    }
    if (SUB_SECTION_WITH_DATA.has(label)) {
      // Sub-section labels that have data rows — consume the row but don't assign to segments
      if (rowIdx < dataRows.length) rowIdx++;
      continue;
    }

    // This is a segment name, TOTAL, or unallocated — it should correspond to a data row
    if (rowIdx >= dataRows.length) break;

    if (seenSegments.has(label)) {
      segmentCountInCycle++;
      // When we've seen all segments, we've completed a cycle
      if (segmentCountInCycle > numSegments) {
        cycleInSection++;
        segmentCountInCycle = 1;
      }

      const row = dataRows[rowIdx];
      rowIdx++;

      // Assign based on section + cycle
      for (let yi = 0; yi < years.length && yi < row.length; yi++) {
        const yr = years[yi];
        const val = row[yi];
        if (!data[label]?.[yr]) continue;

        if (currentSection === "REVENUE") {
          if (cycleInSection === 0) {
            data[label][yr].revenue = val;
          } else if (cycleInSection === 1) {
            data[label][yr].interSegmentRevenue = val;
          }
          // cycle 2 = total segment revenue (redundant, skip)
        } else if (currentSection === "RESULT") {
          if (cycleInSection === 0) {
            data[label][yr].result = val;
          }
        } else if (currentSection === "OTHER INFORMATION") {
          if (cycleInSection === 0) {
            data[label][yr].assets = val;
          } else if (cycleInSection === 1) {
            data[label][yr].liabilities = val;
          } else if (cycleInSection === 2) {
            data[label][yr].capex = val;
          } else if (cycleInSection === 3) {
            data[label][yr].depreciation = val;
          } else if (cycleInSection === 4) {
            data[label][yr].nonCashExpenditure = val;
          }
        }
      }
    } else {
      // Non-segment row (TOTAL, unallocated, etc.) — consume the data row but don't store
      rowIdx++;
    }
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
