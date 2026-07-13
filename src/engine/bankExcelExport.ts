/**
 * Bank Excel Workbook Generator (H5 audit fix)
 *
 * Industrial companies have a 7-sheet workbook (excelExport.ts).
 * Banks/NBFCs/insurers had nothing — this fixes that gap.
 *
 * Sheets:
 *   1. Cover         — config, periods, valuation summary
 *   2. Bank Metrics  — per-period BS + P&L raw values
 *   3. Bank Ratios   — NIM, ROA, ROE, credit cost, cost-to-income, CASA, leverage
 *   4. Insurance     — claims/expense/combined ratio, premium growth, float, yield (insurers only)
 *   5. Asset Quality — joined sidecar data (GNPA, NNPA, PCR, CRAR) when available
 *   6. Valuation     — 3-4 model results (Justified P/B, Equity RI, Sustainable DDM, EV-based)
 *   7. NBFC Funding  — debt mix, leverage, cost of borrowings (NBFC subtype only)
 *
 * Design: minimal local helpers; no shared state with industrial export.
 */

import ExcelJS from "exceljs";
import type { BankPeriodMetrics } from "./bankPipeline";
import type { BankValuationBundle, BankValuationModelResult } from "./bankValuation";
import type { FinancialInstitutionAnalysisResult, FinancialInstitutionSubtype } from "./analysisFamily";
import type { EngineConfig } from "./types";
import { resolveCostOfCapitalFromConfig } from "./costOfCapital";

// ─── Style + workbook helpers ─────────────────────────────────────────────────

type CellValue = string | number | null;

interface SheetSpec {
  name: string;
  rows: CellValue[][];
  /** Optional column widths in characters (default: 14 each). */
  colWidths?: number[] | undefined;
  /** Row indices (0-based) whose first column should be bold (section headers). */
  boldRows?: number[] | undefined;
  /** Row indices to render with the dark-blue header fill. */
  headerRows?: number[] | undefined;
}

const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1F3864" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
const SECTION_FONT = { bold: true, size: 11, color: { argb: "FF1F3864" } };
const NUM_INR_FMT = "#,##0";
const NUM_PCT_FMT = "0.0%";
const NUM_2DP_FMT = "0.00";

async function buildWorkbookFromSpecs(specs: SheetSpec[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  for (const spec of specs) {
    const sheet = wb.addWorksheet(spec.name);
    spec.rows.forEach((row, r) => {
      row.forEach((value, c) => {
        const excelCell = sheet.getCell(r + 1, c + 1);
        excelCell.value = value;
        // Number formatting based on heuristics
        if (typeof value === "number") {
          if (Math.abs(value) < 5 && Math.abs(value) >= 0.0001) {
            excelCell.numFmt = NUM_PCT_FMT;
          } else if (Number.isInteger(value)) {
            excelCell.numFmt = NUM_INR_FMT;
          } else {
            excelCell.numFmt = NUM_2DP_FMT;
          }
        }
        if (spec.boldRows?.includes(r) && c === 0) {
          excelCell.font = SECTION_FONT;
        }
        if (spec.headerRows?.includes(r)) {
          excelCell.fill = HEADER_FILL;
          excelCell.font = HEADER_FONT;
          excelCell.alignment = { horizontal: "center" };
        }
      });
    });
    // Column widths
    const widths = spec.colWidths ?? spec.rows[0]?.map(() => 14) ?? [];
    widths.forEach((w, i) => {
      sheet.getColumn(i + 1).width = w;
    });
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// ─── Sheet builders ───────────────────────────────────────────────────────────

function buildCoverSheet(
  bankResult: FinancialInstitutionAnalysisResult,
  config: EngineConfig,
  metadata: BankWorkbookMetadata,
): SheetSpec {
  const v = bankResult.valuation;
  const ke = resolveCostOfCapitalFromConfig({ config }).ke;
  const subtypeLabel = subtypeDisplayLabel(bankResult.subtype);

  const rows: CellValue[][] = [
    ["PENMAN-NISSIM BANK / NBFC / INSURANCE WORKBOOK", null],
    [`${subtypeLabel} Valuation Summary`, null],
    [null, null],
    ["Company", metadata.companyLabel ?? config.ticker ?? "—"],
    ["Subtype", subtypeLabel],
    ["Periods Analysed", bankResult.periods.length],
    ["Audit Run ID", metadata.auditRunId ?? "—"],
    [null, null],
    ["Cost of Equity (ke)", ke],
    ["Risk-Free Rate", config.risk_free_rate],
    ["Equity Risk Premium", config.equity_risk_premium],
    ["Statutory Tax Rate", config.statutory_tax_rate],
    ["Terminal Growth (g)", v?.terminalGrowth ?? null],
    [null, null],
  ];

  if (v) {
    rows.push(
      ["Sustainable ROE", v.sustainableROE],
      ["Latest Book Value (Cr)", v.latestBookValue],
      ["Usable History (years)", v.usableHistory],
      [null, null],
      ["Triangulated Intrinsic Value (Cr)", v.triangulatedValue],
      ["Models Contributing", v.modelsContributing.join(", ")],
    );
    if (metadata.marketCapCr != null) {
      rows.push(
        ["Market Cap (Cr)", metadata.marketCapCr],
        [
          "Premium / (Discount) vs Market",
          v.triangulatedValue != null && metadata.marketCapCr > 0
            ? v.triangulatedValue / metadata.marketCapCr - 1
            : null,
        ],
      );
    }
  } else {
    rows.push(["Valuation", "Not computed (insufficient data)"]);
  }

  rows.push([null, null], ["Sheets in this workbook:", null]);
  rows.push(["1. Cover", "This sheet — config and valuation summary"]);
  rows.push(["2. Bank Metrics", "Per-period balance sheet and P&L raw values"]);
  rows.push(["3. Bank Ratios", "NIM, ROA, ROE, credit cost, cost-to-income, CASA"]);
  if (bankResult.subtype === "insurance") {
    rows.push(["4. Insurance Metrics", "Claims, combined ratio, premium growth, float leverage"]);
  }
  if (bankResult.assetQuality?.coverage && bankResult.assetQuality.coverage.periodsWithQuality > 0) {
    rows.push(["5. Asset Quality", "GNPA, NNPA, PCR, CRAR (sidecar data)"]);
  }
  if (v) rows.push(["6. Valuation Models", "Per-model intrinsic value + skip reasons"]);
  if (bankResult.subtype === "nbfc" || bankResult.subtype === "generic-financial") {
    rows.push(["7. NBFC Funding", "Borrowings mix, leverage, spread"]);
  }
  rows.push([null, null], [`Generated: ${new Date().toISOString().slice(0, 10)}`, null]);

  return {
    name: "Cover",
    rows,
    colWidths: [36, 50],
    boldRows: [0, 1],
  };
}

function buildBankMetricsSheet(metrics: BankPeriodMetrics[]): SheetSpec {
  if (metrics.length === 0) {
    return { name: "Bank Metrics", rows: [["No bank metrics available"]] };
  }
  const periodCols = metrics.map((m) => m.period_end.slice(0, 10));
  const rows: CellValue[][] = [];
  rows.push(["Bank Metrics — Raw Values (₹ Cr)", ...periodCols.map(() => null)]);
  rows.push(["Metric", ...periodCols]);

  // Balance Sheet
  rows.push(["Balance Sheet", ...periodCols.map(() => null)]);
  rows.push(["  Total Assets", ...metrics.map((m) => m.totalAssets)]);
  rows.push(["  Total Equity", ...metrics.map((m) => m.totalEquity)]);
  rows.push(["  Advances (Loan Book)", ...metrics.map((m) => m.advances)]);
  rows.push(["  Deposits", ...metrics.map((m) => m.deposits)]);
  rows.push(["  Investments", ...metrics.map((m) => m.investments)]);
  rows.push(["  Borrowings", ...metrics.map((m) => m.borrowings)]);
  rows.push(["  Cash & RBI Balance", ...metrics.map((m) => m.cashAndBalanceWithRBI)]);

  // P&L
  rows.push(["Profit & Loss", ...periodCols.map(() => null)]);
  rows.push(["  Interest Earned", ...metrics.map((m) => m.interestEarned)]);
  rows.push(["  Interest Expended", ...metrics.map((m) => m.interestExpended)]);
  rows.push(["  Net Interest Income (NII)", ...metrics.map((m) => m.nii)]);
  rows.push(["  Other Income", ...metrics.map((m) => m.otherIncome)]);
  rows.push(["  Operating Expenses", ...metrics.map((m) => m.operatingExpenses)]);
  rows.push(["  Provisions", ...metrics.map((m) => m.provisions)]);
  rows.push(["  Profit Before Tax", ...metrics.map((m) => m.pbt)]);
  rows.push(["  Profit After Tax", ...metrics.map((m) => m.pat)]);
  rows.push(["  Dividend Paid", ...metrics.map((m) => m.dividendPaid)]);

  return {
    name: "Bank Metrics",
    rows,
    colWidths: [32, ...periodCols.map(() => 14)],
    headerRows: [1],
    boldRows: [0, 2, 11],
  };
}

function buildBankRatiosSheet(metrics: BankPeriodMetrics[]): SheetSpec {
  if (metrics.length === 0) {
    return { name: "Bank Ratios", rows: [["No bank ratios available"]] };
  }
  const periodCols = metrics.map((m) => m.period_end.slice(0, 10));
  const rows: CellValue[][] = [];
  rows.push(["Bank / NBFC Ratios", ...periodCols.map(() => null)]);
  rows.push(["Ratio", ...periodCols]);

  rows.push(["Profitability", ...periodCols.map(() => null)]);
  rows.push(["  NIM (Net Interest Margin)", ...metrics.map((m) => m.nim)]);
  rows.push(["  ROA (Return on Assets)", ...metrics.map((m) => m.roa)]);
  rows.push(["  ROE (Return on Equity)", ...metrics.map((m) => m.roe)]);

  rows.push(["Risk & Cost", ...periodCols.map(() => null)]);
  rows.push(["  Credit Cost (Provisions / Avg Advances)", ...metrics.map((m) => m.creditCost)]);
  rows.push(["  Cost-to-Income (OpEx / Total Income)", ...metrics.map((m) => m.costToIncome)]);

  rows.push(["Funding Mix", ...periodCols.map(() => null)]);
  rows.push(["  CASA Ratio", ...metrics.map((m) => m.casaRatio)]);
  rows.push(["  Leverage (Borrowings / Equity)", ...metrics.map((m) => m.leverage)]);

  rows.push(["NBFC-Specific (when applicable)", ...periodCols.map(() => null)]);
  rows.push(["  Yield on Advances", ...metrics.map((m) => m.yieldOnAdvances)]);
  rows.push(["  Cost of Borrowings", ...metrics.map((m) => m.costOfBorrowings)]);
  rows.push(["  Spread (Yield − Cost)", ...metrics.map((m) => m.spread)]);

  return {
    name: "Bank Ratios",
    rows,
    colWidths: [40, ...periodCols.map(() => 14)],
    headerRows: [1],
    boldRows: [0, 2, 6, 9, 12],
  };
}

function buildInsuranceSheet(metrics: BankPeriodMetrics[]): SheetSpec {
  if (metrics.length === 0) {
    return { name: "Insurance Metrics", rows: [["No insurance metrics available"]] };
  }
  const periodCols = metrics.map((m) => m.period_end.slice(0, 10));
  const rows: CellValue[][] = [];
  rows.push(["Insurance Metrics", ...periodCols.map(() => null)]);
  rows.push(["Metric", ...periodCols]);

  rows.push(["Underwriting", ...periodCols.map(() => null)]);
  rows.push(["  Premium Earned (₹ Cr)", ...metrics.map((m) => m.premiumEarned ?? null)]);
  rows.push(["  Claims Expense (₹ Cr)", ...metrics.map((m) => (m.claimsExpense != null ? Math.abs(m.claimsExpense) : null))]);
  rows.push(["  Premium Growth YoY", ...metrics.map((m) => m.premiumGrowth ?? null)]);

  rows.push(["Combined Ratio", ...periodCols.map(() => null)]);
  rows.push(["  Claims Ratio", ...metrics.map((m) => m.claimsRatio ?? null)]);
  rows.push(["  Expense Ratio", ...metrics.map((m) => m.expenseRatio ?? null)]);
  rows.push(["  Combined Ratio (sum)", ...metrics.map((m) => m.combinedRatio ?? null)]);

  rows.push(["Float & Returns", ...periodCols.map(() => null)]);
  rows.push(["  Float-to-Equity", ...metrics.map((m) => m.floatToEquity ?? null)]);
  rows.push(["  Investment Yield", ...metrics.map((m) => m.investmentYield ?? null)]);
  rows.push(["  ROE", ...metrics.map((m) => m.roe)]);

  return {
    name: "Insurance Metrics",
    rows,
    colWidths: [32, ...periodCols.map(() => 14)],
    headerRows: [1],
    boldRows: [0, 2, 6, 10],
  };
}

function buildValuationSheet(v: BankValuationBundle, marketCapCr: number | null): SheetSpec {
  const rows: CellValue[][] = [];
  rows.push(["Valuation Models", null, null, null]);
  rows.push(["Anchor Inputs", null, null, null]);
  rows.push(["  Sustainable ROE", v.sustainableROE, null, null]);
  rows.push(["  Cost of Equity (ke)", v.ke, null, null]);
  rows.push(["  Terminal Growth (g)", v.terminalGrowth, null, null]);
  rows.push(["  Latest Book Value (Cr)", v.latestBookValue, null, null]);
  rows.push(["  Usable History (years)", v.usableHistory, null, null]);
  rows.push(["  Payout Ratio Used", v.payoutRatio, null, null]);
  rows.push([null, null, null, null]);

  rows.push(["Model", "Status", "Intrinsic Value (Cr)", "vs Market %"]);
  const addModel = (name: string, m: BankValuationModelResult) => {
    rows.push([
      name,
      m.status,
      m.intrinsicValue,
      m.premiumOverMarket,
    ]);
    rows.push(["  Reason", m.reason, null, null]);
  };
  addModel("Justified P/B (Gordon)", v.justifiedPB);
  addModel("Equity Residual Income", v.equityResidualIncome);
  addModel("Sustainable DDM", v.sustainableDDM);
  if (v.evBased) addModel("EV-Based (Embedded Value)", v.evBased);

  rows.push([null, null, null, null]);
  rows.push(["Triangulation", null, null, null]);
  rows.push(["  Triangulated Value (Cr)", v.triangulatedValue, null, null]);
  rows.push(["  Models Contributing", v.modelsContributing.join(", "), null, null]);
  if (marketCapCr != null) {
    rows.push(["  Market Cap (Cr)", marketCapCr, null, null]);
    if (v.triangulatedValue != null && marketCapCr > 0) {
      rows.push(["  Premium / (Discount)", v.triangulatedValue / marketCapCr - 1, null, null]);
    }
  }

  return {
    name: "Valuation Models",
    rows,
    colWidths: [40, 20, 20, 20],
    headerRows: [9],
    boldRows: [0, 1, 8],
  };
}

function buildAssetQualitySheet(bankResult: FinancialInstitutionAnalysisResult): SheetSpec | null {
  const aq = bankResult.assetQuality;
  if (!aq || !aq.coverage || aq.coverage.periodsWithQuality === 0) return null;
  // Pull joined sidecar records from bankMetrics (m.quality is set during the join)
  const records = (bankResult.bankMetrics ?? [])
    .filter((m): m is typeof m & { quality: NonNullable<typeof m.quality> } => m.quality != null);
  if (records.length === 0) return null;

  const periodCols = records.map((m) => m.period_end.slice(0, 10));
  const rows: CellValue[][] = [];
  rows.push(["Asset Quality (Sidecar Data)", ...periodCols.map(() => null)]);
  rows.push(["Metric", ...periodCols]);
  rows.push(["  Gross NPA %", ...records.map((m) => m.quality.gnpa_pct ?? null)]);
  rows.push(["  Net NPA %", ...records.map((m) => m.quality.nnpa_pct ?? null)]);
  rows.push(["  Provision Coverage Ratio", ...records.map((m) => m.quality.pcr_pct ?? null)]);
  rows.push(["  CRAR / Tier 1", ...records.map((m) => m.quality.crar_pct ?? null)]);
  rows.push(["  CASA %", ...records.map((m) => m.quality.casa_pct ?? null)]);
  rows.push(["  Slippage Ratio", ...records.map((m) => m.quality.slippage_pct ?? null)]);

  return {
    name: "Asset Quality",
    rows,
    colWidths: [28, ...periodCols.map(() => 14)],
    headerRows: [1],
    boldRows: [0],
  };
}

function buildNbfcFundingSheet(metrics: BankPeriodMetrics[]): SheetSpec {
  const periodCols = metrics.map((m) => m.period_end.slice(0, 10));
  const rows: CellValue[][] = [];
  rows.push(["NBFC Funding Mix", ...periodCols.map(() => null)]);
  rows.push(["Metric", ...periodCols]);
  rows.push(["Borrowings Composition (₹ Cr)", ...periodCols.map(() => null)]);
  rows.push(["  Non-Convertible Debentures", ...metrics.map((m) => m.nonConvertibleDebentures)]);
  rows.push(["  Term Loans (Banks)", ...metrics.map((m) => m.termLoansFromBanks)]);
  rows.push(["  Term Loans (Institutions)", ...metrics.map((m) => m.termLoansFromInstitutions)]);
  rows.push(["  Term Loans (Others)", ...metrics.map((m) => m.termLoansFromOthers)]);
  rows.push(["Debt Mix Shares (% of Borrowings)", ...periodCols.map(() => null)]);
  rows.push(["  NCD Share", ...metrics.map((m) => m.debtMix?.ncdShare ?? null)]);
  rows.push(["  Bank Loan Share", ...metrics.map((m) => m.debtMix?.bankLoanShare ?? null)]);
  rows.push(["  Institution Loan Share", ...metrics.map((m) => m.debtMix?.institutionLoanShare ?? null)]);
  rows.push(["  Other Loan Share", ...metrics.map((m) => m.debtMix?.otherLoanShare ?? null)]);

  return {
    name: "NBFC Funding",
    rows,
    colWidths: [36, ...periodCols.map(() => 14)],
    headerRows: [1],
    boldRows: [0, 2, 7],
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface BankWorkbookMetadata {
  companyLabel?: string | undefined;
  auditRunId?: string | null | undefined;
  marketCapCr?: number | null | undefined;
}

/**
 * Generate a bank/NBFC/insurance Excel workbook from a FinancialInstitutionAnalysisResult.
 * Sheets included depend on subtype: insurance gets the Insurance Metrics sheet,
 * NBFC/generic-financial gets the NBFC Funding sheet, all subtypes get
 * Cover/Metrics/Ratios/Valuation/AssetQuality (when available).
 */
export async function generateBankWorkbook(
  bankResult: FinancialInstitutionAnalysisResult,
  config: EngineConfig,
  metadata: BankWorkbookMetadata = {},
): Promise<ArrayBuffer> {
  const metrics = bankResult.bankMetrics ?? [];
  const specs: SheetSpec[] = [];

  specs.push(buildCoverSheet(bankResult, config, metadata));
  specs.push(buildBankMetricsSheet(metrics));
  specs.push(buildBankRatiosSheet(metrics));

  if (bankResult.subtype === "insurance") {
    specs.push(buildInsuranceSheet(metrics));
  }

  const aqSheet = buildAssetQualitySheet(bankResult);
  if (aqSheet) specs.push(aqSheet);

  if (bankResult.valuation) {
    specs.push(buildValuationSheet(bankResult.valuation, metadata.marketCapCr ?? null));
  }

  if (bankResult.subtype === "nbfc" || bankResult.subtype === "generic-financial") {
    specs.push(buildNbfcFundingSheet(metrics));
  }

  return await buildWorkbookFromSpecs(specs);
}

function subtypeDisplayLabel(subtype: FinancialInstitutionSubtype): string {
  switch (subtype) {
    case "bank": return "Bank";
    case "nbfc": return "NBFC";
    case "insurance": return "Insurance";
    case "generic-financial": return "Generic Financial";
    default: return subtype;
  }
}
