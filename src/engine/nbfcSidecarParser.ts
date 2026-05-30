import { trace } from "../lib/traceLogger";
/**
 * Phase D4 — LGD (Loss Given Default) and RBI NHB sidecar XLS parsers.
 *
 * These Capitaline exports are HTML-table XLS files (same format as the main
 * financial statements). Each LGD file is one fiscal year's stage migration
 * matrix. The RBI NHB file is a multi-period time-series of regulatory metrics.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StageValues {
  stage1: number | null;
  stage2: number | null;
  stage3: number | null;
  total: number | null;
}

export interface LgdMigrationMatrix {
  fiscal_label: string;
  gross_carrying: {
    opening: StageValues | null;
    new_business: StageValues | null;
    credit_worthiness_transfer: StageValues | null;
    derecognised: StageValues | null;
    writeoff: StageValues | null;
    transfer_to_s1: StageValues | null;
    transfer_to_s2: StageValues | null;
    transfer_to_s3: StageValues | null;
    closing: StageValues | null;
  };
  ecl: {
    opening: StageValues | null;
    new_business: StageValues | null;
    credit_worthiness_transfer: StageValues | null;
    derecognised: StageValues | null;
    writeoff: StageValues | null;
    transfer_to_s1: StageValues | null;
    transfer_to_s2: StageValues | null;
    transfer_to_s3: StageValues | null;
    closing: StageValues | null;
  };
}

export interface RbiNhbPeriod {
  fiscal_label: string;
  period_code: string; // e.g. "202503"
  gnpa_cr: number | null;
  nnpa_cr: number | null;
  nnpa_pct: number | null;
  crar_pct: number | null;
  tier1_pct: number | null;
  tier2_pct: number | null;
  advance_capital_market_cr: number | null;
  advance_real_estate_cr: number | null;
  gnpa_opening_cr: number | null;
  gnpa_additions_cr: number | null;
  gnpa_closing_cr: number | null;
  nnpa_opening_cr: number | null;
  nnpa_additions_cr: number | null;
  nnpa_closing_cr: number | null;
  provisions_opening_cr: number | null;
  provisions_made_cr: number | null;
  provisions_closing_cr: number | null;
}

export interface NbfcSidecarData {
  lgd: LgdMigrationMatrix[];
  rbiNhb: RbiNhbPeriod[];
}

// ─── Parsing helpers ────────────────────────────────────────────────────────

function parseNumeric(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toStageValues(vals: (number | null)[]): StageValues | null {
  if (!vals || vals.length < 3) return null;
  return {
    stage1: vals[0]!,
    stage2: vals[1]!,
    stage3: vals[2]!,
    total: vals.length > 3 ? vals[3]! : null,
  };
}

// ─── LGD Parser ─────────────────────────────────────────────────────────────

interface LgdRow {
  label: string;
  values: (number | null)[];
}

function parseLgdHtml(html: string): LgdRow[] {
  const rows: LgdRow[] = [];
  const trParts = html.split(/<tr[^>]*>/i);
  for (const part of trParts) {
    const labelMatch = part.match(/<td[^>]*>([^<]+)<\/td>/);
    if (!labelMatch) continue;
    const label = labelMatch[1]!.trim();
    if (!label) continue;

    const valMatches = [...part.matchAll(/class="ng-binding"[^>]*>([^<]*)</g)];
    const values = valMatches.map(m => parseNumeric(m[1]!));
    if (values.length > 0) {
      rows.push({ label, values });
    }
  }
  return rows;
}

export function parseLgdFile(html: string): Omit<LgdMigrationMatrix, "fiscal_label"> {
  const rows = parseLgdHtml(html);

  // Split into gross (first section) and ECL (second section)
  let closingSeen = false;
  const gross: Record<string, (number | null)[]> = {};
  const ecl: Record<string, (number | null)[]> = {};
  let section: "gross" | "ecl" = "gross";

  for (const { label, values } of rows) {
    if (label === "Closing Balance" && !closingSeen) {
      gross[label] = values;
      closingSeen = true;
      continue;
    }
    if (label === "EIR Impact Of Service Charges Received") {
      section = "ecl";
      continue;
    }
    if (closingSeen && label === "Opening Balance") {
      section = "ecl";
    }
    const target = section === "gross" ? gross : ecl;
    target[label] = values;
  }

  const mapSection = (src: Record<string, (number | null)[]>) => ({
    opening: toStageValues(src["Opening Balance"] ?? []),
    new_business: toStageValues(src["New Business-Net of Recovery"] ?? []),
    credit_worthiness_transfer: toStageValues(src["Transfer due to change in Credit worthiness"] ?? []),
    derecognised: toStageValues(src["Financial assets that have been derecognised"] ?? []),
    writeoff: toStageValues(src["Write off during the Year"] ?? []),
    transfer_to_s1: toStageValues(src["Transfers To Stage 1"] ?? []),
    transfer_to_s2: toStageValues(src["Transfers To Stage 2"] ?? []),
    transfer_to_s3: toStageValues(src["Transfers To Stage 3"] ?? []),
    closing: toStageValues(src["Closing Balance"] ?? []),
  });

  return {
    gross_carrying: mapSection(gross),
    ecl: mapSection(ecl),
  };
}

// ─── RBI NHB Parser ─────────────────────────────────────────────────────────

export function parseRbiNhbFile(html: string): RbiNhbPeriod[] {
  // Extract period codes from header
  const periodCodes = [...html.matchAll(/<th[^>]*>(\d{6})<\/th>/g)].map(m => m[1]);
  if (periodCodes.length === 0) return [];

  // Parse data rows
  const trParts = html.split(/<tr /);
  const dataMap: Record<string, (number | null)[]> = {};
  for (const part of trParts) {
    const labelMatch = part.match(/<label[^>]*>([^<]+)<\/label>/);
    if (!labelMatch) continue;
    const label = labelMatch[1]!.trim();
    const valMatches = [...part.matchAll(/class="ng-binding ng-scope">\s*([^<]*?)\s*<\/div>/g)];
    const values = valMatches.map(m => parseNumeric(m[1]!));
    if (values.length > 0) {
      // Keep first occurrence only — duplicate labels exist across Basel I/II/III sections
      if (!(label in dataMap)) {
        dataMap[label] = values;
      }
    }
  }

  // Build per-period records
  const periods: RbiNhbPeriod[] = [];
  for (let i = 0; i < periodCodes.length; i++) {
    const code = periodCodes[i]!;
    const fy = `FY${code.slice(0, 4)}`;
    const val = (label: string) => dataMap[label]?.[i] ?? null;

    periods.push({
      fiscal_label: fy,
      period_code: code,
      gnpa_cr: val("Gross Non-Performing Assets"),
      nnpa_cr: val("Net Non Performing Assets"),
      nnpa_pct: val("% of Net Non-Performing Assets to Net Advance"),
      crar_pct: val("Capital Adequacy Ratio (%) - Basel I"),
      tier1_pct: val("Tier I Capital (%)"),
      tier2_pct: val("Tier II Capital (%)"),
      advance_capital_market_cr: val("Advance to Capital Market Sector"),
      advance_real_estate_cr: val("Advance to Real Estate Sector"),
      gnpa_opening_cr: val("Opening Balance of Gross NPAs"),
      gnpa_additions_cr: val("Additions of Gross NPAs"),
      gnpa_closing_cr: val("Closing Balance of Gross NPAs"),
      nnpa_opening_cr: val("Opening Balance of Net NPAs"),
      nnpa_additions_cr: val("Additions of Net NPAs"),
      nnpa_closing_cr: val("Closing Balance of Net NPAs"),
      provisions_opening_cr: val("Opening Balance"),
      provisions_made_cr: val("Provisions made during the Year"),
      provisions_closing_cr: val("Closing Balance"),
    });
  }

  trace("sidecar", "rbiNhbParsed", {
    periods: periods.length,
    periodsWithData: periods.filter(p => (p.gnpa_cr ?? 0) > 0 || (p.crar_pct ?? 0) > 0).length,
    latestFY: periods.length > 0 ? periods[0]!.fiscal_label : null,
  });
  return periods;
}

// ─── Multi-file LGD orchestrator ────────────────────────────────────────────

/**
 * Extract fiscal year from year-named filename: LossGivenDefault_202503.xls → "FY2025"
 */
function fiscalLabelFromFilename(filename: string): string | null {
  const m = filename.match(/LossGivenDefault_(\d{4})(\d{2})\.xls/);
  if (!m) return null;
  const year = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  // Indian FY ends March: 202503 = FY2025
  if (month <= 3) return `FY${year}`;
  return `FY${year + 1}`;
}

/**
 * Parse multiple LGD files and assign fiscal years.
 * Prefers filename-based year (LossGivenDefault_YYYYMM.xls → FY{YYYY}).
 * Falls back to sorting by opening total and counting backwards from current year.
 */
export function parseLgdFiles(htmlContents: { filename: string; html: string }[]): LgdMigrationMatrix[] {
  const parsed = htmlContents.map(({ filename, html }) => {
    const data = parseLgdFile(html);
    const openingTotal = data.gross_carrying.opening?.total ?? 0;
    const closingTotal = data.gross_carrying.closing?.total ?? 0;
    const fiscalFromName = fiscalLabelFromFilename(filename);
    return { filename, openingTotal, closingTotal, data, fiscalFromName };
  });

  // If all files have year in filename, use that directly
  const allHaveNames = parsed.every(p => p.fiscalFromName !== null);

  if (allHaveNames) {
    // Sort by fiscal year (ascending)
    parsed.sort((a, b) => a.fiscalFromName!.localeCompare(b.fiscalFromName!));
    const result = parsed.map((item) => ({
      fiscal_label: item.fiscalFromName!,
      ...item.data,
    }));
    trace("sidecar", "lgdFilesParsed", {
      fileCount: result.length,
      method: "filename",
      fiscalYears: result.map(r => r.fiscal_label),
      latestClosingTotal: result.length > 0 ? result[result.length - 1]!.gross_carrying.closing?.total : null,
    });
    return result;
  }

  // Fallback: sort by opening total (ascending = oldest first), assign by counting
  parsed.sort((a, b) => a.openingTotal - b.openingTotal);

  const now = new Date();
  const latestPublishedFY = now.getMonth() >= 6
    ? now.getFullYear()
    : now.getFullYear() - 1;
  const baseYear = latestPublishedFY - parsed.length + 1;

  const result = parsed.map((item, i) => ({
    fiscal_label: `FY${baseYear + i}`,
    ...item.data,
  }));
  trace("sidecar", "lgdFilesParsed", {
    fileCount: result.length,
    method: "heuristic",
    fiscalYears: result.map(r => r.fiscal_label),
    latestClosingTotal: result.length > 0 ? result[result.length - 1]!.gross_carrying.closing?.total : null,
  });
  return result;
}
