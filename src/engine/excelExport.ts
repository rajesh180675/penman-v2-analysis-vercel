/**
 * Excel Workbook Generator — Institutional Grade (G-02)
 * 7-sheet workbook: Cover + Raw Data + Reformulated Statements +
 * N&P Ratio Decomposition + Forecast Model + Valuation Summary + Quality Scores.
 *
 * Runtime export now uses an ExcelJS-backed writer behind an internal workbook adapter.
 * This module is part of the publication/export architecture and should evolve toward
 * a canonical publication snapshot input instead of independently assembling report context.
 * Spec: Module G, Feature G-02
 */
import ExcelJS from "exceljs";

type CellObject = {
  v: string | number;
  t: "n" | "s";
  s?: CellStyle;
};

type WorkSheet = Record<string, CellObject | Array<{ wch: number }> | string>;

type WorkBook = {
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
  for (const ch of letters) c = c * 26 + (ch.charCodeAt(0) - 64);
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
  const headers = Object.keys(rows[0]);
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

async function writeWorkbookArray(wb: WorkBook) {
  const workbook = new ExcelJS.Workbook();
  for (const name of wb.SheetNames) {
    const source = wb.Sheets[name];
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

const utils = {
  encode_cell: ({ r, c }: { r: number; c: number }) => encodeCellAddr(r, c),
  decode_cell: (addr: string) => decodeCellAddr(addr),
  encode_range: (args: { s: { r: number; c: number }; e: { r: number; c: number } }) => encodeRangeAddr(args),
  book_new: bookNew,
  book_append_sheet: bookAppendSheet,
  json_to_sheet: jsonToSheet,
};

import { EngineConfig, ForecastScenario, RecastPeriod, ValuationResult, NP_BENCHMARKS, ke_from_config } from "./types";
import { AnalysisTraceabilityEnvelope } from "./analysisTraceability";
import { buildMappingDiscrepancyRows, buildProvenanceAuditRows } from "./provenanceAudit";
import { AnalysisPolicyVersions } from "./policyVersions";

export interface WorkbookExportMetadata {
  companyLabel?: string;
  auditRunId?: string | null;
  valuationStatus?: "production-ready" | "warning" | "guarded";
  valuationReasons?: string[];
  valuationAnchorPeriod?: string | null;
  valuationSourcePeriod?: string | null;
  policyVersions?: AnalysisPolicyVersions;
  traceability?: AnalysisTraceabilityEnvelope;
}

export function workbookMetadataFromPublicationSnapshot(snapshot: {
  companyId: string | null;
  valuationReadiness: {
    status: "production-ready" | "warning" | "guarded";
    reasons: string[];
    anchorPeriod: string | null;
    latestPeriod: string | null;
  };
  policyVersions: AnalysisPolicyVersions;
  traceability: AnalysisTraceabilityEnvelope;
  auditMeta?: { runId?: string | null } | null;
}): WorkbookExportMetadata {
  return {
    companyLabel: snapshot.companyId ?? undefined,
    auditRunId: snapshot.auditMeta?.runId ?? undefined,
    valuationStatus: snapshot.valuationReadiness.status,
    valuationReasons: snapshot.valuationReadiness.reasons,
    valuationAnchorPeriod: snapshot.valuationReadiness.anchorPeriod,
    valuationSourcePeriod: snapshot.valuationReadiness.latestPeriod,
    policyVersions: snapshot.policyVersions,
    traceability: snapshot.traceability,
  };
}
// ── Style helpers ──────────────────────────────────────────────────────────────
type Fill = { fgColor: { rgb: string } };
type Font = { bold?: boolean; color?: { rgb: string }; sz?: number; name?: string };
type Alignment = { horizontal?: string; vertical?: string; wrapText?: boolean };
type CellStyle = { fill?: Fill; font?: Font; alignment?: Alignment; numFmt?: string; border?: object };

function cell(v: string | number | null, s?: CellStyle): CellObject {
  const t = typeof v === "number" ? "n" : typeof v === "string" ? "s" : "s";
  return { v: v ?? "", t, s } as CellObject;
}

const HEADER_BLUE: CellStyle = {
  fill: { fgColor: { rgb: "1F3864" } },
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  alignment: { horizontal: "center" },
};
const SUBHEADER: CellStyle = {
  fill: { fgColor: { rgb: "4472C4" } },
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 9 },
  alignment: { horizontal: "center" },
};
const LABEL: CellStyle = {
  font: { bold: false, sz: 9 },
  alignment: { horizontal: "left" },
};
const LABEL_BOLD: CellStyle = {
  font: { bold: true, sz: 9 },
  alignment: { horizontal: "left" },
};
const NUM_INR: CellStyle = {
  numFmt: "#,##0",
  font: { sz: 9 },
  alignment: { horizontal: "right" },
};
const NUM_PCT: CellStyle = {
  numFmt: "0.0%",
  font: { sz: 9 },
  alignment: { horizontal: "right" },
};
const NUM_2DP: CellStyle = {
  numFmt: "0.00",
  font: { sz: 9 },
  alignment: { horizontal: "right" },
};
const RED_NUM: CellStyle = {
  numFmt: "#,##0",
  font: { sz: 9, color: { rgb: "C00000" } },
  alignment: { horizontal: "right" },
};
const GREEN_FILL: CellStyle = {
  fill: { fgColor: { rgb: "E2EFDA" } },
  numFmt: "#,##0",
  font: { sz: 9 },
  alignment: { horizontal: "right" },
};
const AMBER_FILL: CellStyle = {
  fill: { fgColor: { rgb: "FFF2CC" } },
  numFmt: "0.0%",
  font: { sz: 9 },
  alignment: { horizontal: "right" },
};

// ── Sheet utilities ────────────────────────────────────────────────────────────
function setCell(ws: WorkSheet, row: number, col: number, c: CellObject) {
  const addr = utils.encode_cell({ r: row, c: col });
  ws[addr] = c;
}
function setRange(ws: WorkSheet, rows: CellObject[][], startRow = 0, startCol = 0) {
  rows.forEach((row, r) => row.forEach((c, col) => setCell(ws, startRow + r, startCol + col, c)));
}
function updateRef(ws: WorkSheet) {
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

// ── Sheet 1: Cover ─────────────────────────────────────────────────────────────
function buildCoverSheet(config: EngineConfig, periodCount: number, metadata?: WorkbookExportMetadata): WorkSheet {
  const ws: WorkSheet = {};
  const ke = ke_from_config(config);
  const valuationReason = metadata?.valuationReasons?.[0] ?? "—";
  const versions = metadata?.policyVersions;
  const traceability = metadata?.traceability;
  const rows: CellObject[][] = [
    [cell("PENMAN–NISSIM VALUATION ENGINE v2", { font: { bold: true, sz: 14, color: { rgb: "1F3864" } } })],
    [cell("Institutional Equity Valuation Workbook", { font: { sz: 11, color: { rgb: "4472C4" } } })],
    [cell("")],
    [cell("Nissim & Penman (2001) — Review of Accounting Studies, Vol. 6", { font: { sz: 9 } })],
    [cell("")],
    [cell("Company", LABEL_BOLD), cell(metadata?.companyLabel ?? config.ticker ?? "—", LABEL)],
    [cell("Audit Run ID", LABEL_BOLD), cell(metadata?.auditRunId ?? "—", LABEL)],
    [cell("Valuation Status", LABEL_BOLD), cell(metadata?.valuationStatus ?? "production-ready", LABEL)],
    [cell("Valuation Anchor Period", LABEL_BOLD), cell(metadata?.valuationAnchorPeriod ?? "—", LABEL)],
    [cell("Latest Source Period", LABEL_BOLD), cell(metadata?.valuationSourcePeriod ?? "—", LABEL)],
    [cell("Valuation Note", LABEL_BOLD), cell(valuationReason, { font: { sz: 8 }, alignment: { wrapText: true } })],
    [cell("Engine Version", LABEL_BOLD), cell(versions?.engineVersion ?? "—", LABEL)],
    [cell("Mapping Spec Version", LABEL_BOLD), cell(versions?.mappingSpecVersion ?? "—", LABEL)],
    [cell("Mapping Policy Version", LABEL_BOLD), cell(versions?.mappingPolicyVersion ?? "—", LABEL)],
    [cell("Anomaly Policy Version", LABEL_BOLD), cell(versions?.anomalyPolicyVersion ?? "—", LABEL)],
    [cell("Valuation Policy Version", LABEL_BOLD), cell(versions?.valuationPolicyVersion ?? "—", LABEL)],
    [cell("Scope Policy Version", LABEL_BOLD), cell(versions?.scopePolicyVersion ?? "—", LABEL)],
    [cell("Traceability Schema", LABEL_BOLD), cell(traceability?.schemaVersion ?? versions?.traceabilitySchemaVersion ?? "—", LABEL)],
    [cell("Rigor Level", LABEL_BOLD), cell(traceability?.rigor?.currentLabel ?? "—", LABEL)],
    [cell("Parser Fidelity", LABEL_BOLD), cell(traceability?.parserFidelity?.status ?? "—", LABEL)],
    [cell("Reconciliation Status", LABEL_BOLD), cell(traceability?.reconciliation?.status ?? "—", LABEL)],
    [cell("Scope Classification", LABEL_BOLD), cell(traceability?.qualityGate?.scopeClassification ?? "supported-industrial", LABEL)],
    [cell("Periods Analysed", LABEL_BOLD), cell(periodCount, NUM_INR)],
    [cell("Cost of Equity (ke)", LABEL_BOLD), cell(ke, NUM_PCT)],
    [cell("Risk-Free Rate", LABEL_BOLD), cell(config.risk_free_rate, NUM_PCT)],
    [cell("Equity Risk Premium", LABEL_BOLD), cell(config.equity_risk_premium, NUM_PCT)],
    [cell("Statutory Tax Rate", LABEL_BOLD), cell(config.statutory_tax_rate, NUM_PCT)],
    [cell("")],
    [cell("Sheets in this workbook:", LABEL_BOLD)],
    [cell("1. Cover"), cell("This sheet — parameters and navigation")],
    [cell("2. Recast Statements"), cell("Reformulated B/S, I/S, C/F per N&P §2–3")],
    [cell("3. N&P Ratios"), cell("Full ratio decomposition — Eq.1–16")],
    [cell("4. Forecast Model"), cell("Bull / Base / Bear scenario pro forma")],
    [cell("5. Valuation"), cell("RE, ReOI, FCFF, FCFE, DDM, AEG triangulation")],
    [cell("6. Quality Scores"), cell("Piotroski, Beneish, Altman, Zmijewski, Ohlson")],
    [cell("7. Provenance Audit"), cell("Data mapping trace for each canonical variable")],
    [cell("")],
    [cell(`Generated: ${new Date().toISOString().slice(0, 10)}`, { font: { sz: 8, color: { rgb: "888888" } } })],
  ];
  setRange(ws, rows);
  ws["!cols"] = [{ wch: 30 }, { wch: 50 }];
  updateRef(ws);
  return ws;
}

function buildTraceabilitySheet(metadata?: WorkbookExportMetadata): WorkSheet {
  const ws: WorkSheet = {};
  const traceability = metadata?.traceability;
  const rows: CellObject[][] = [
    [cell("TRACEABILITY", { font: { bold: true, sz: 14, color: { rgb: "1F3864" } } })],
    [cell("")],
    [cell("Schema Version", LABEL_BOLD), cell(traceability?.schemaVersion ?? "—", LABEL)],
    [cell("Generated At", LABEL_BOLD), cell(traceability?.generatedAt ?? "—", LABEL)],
    [cell("Run ID", LABEL_BOLD), cell(traceability?.runContext?.runId ?? metadata?.auditRunId ?? "—", LABEL)],
    [cell("Company ID", LABEL_BOLD), cell(traceability?.runContext?.companyId ?? metadata?.companyLabel ?? "—", LABEL)],
    [cell("Source Mode", LABEL_BOLD), cell(traceability?.runContext?.sourceMode ?? "—", LABEL)],
    [cell("Latest Period", LABEL_BOLD), cell(traceability?.runContext?.latestPeriod ?? metadata?.valuationSourcePeriod ?? "—", LABEL)],
    [cell("Raw Period Count", LABEL_BOLD), cell(traceability?.analysisContext?.rawPeriodCount ?? 0, NUM_INR)],
    [cell("Recast Period Count", LABEL_BOLD), cell(traceability?.analysisContext?.recastPeriodCount ?? 0, NUM_INR)],
    [cell("Debug Files", LABEL_BOLD), cell(traceability?.analysisContext?.debugFiles ?? 0, NUM_INR)],
    [cell("Raw Metric Keys", LABEL_BOLD), cell(traceability?.analysisContext?.rawMetricKeyCount ?? 0, NUM_INR)],
    [cell("Engine Error", LABEL_BOLD), cell(traceability?.analysisContext?.engineError ?? "—", { font: { sz: 8 }, alignment: { wrapText: true } })],
    [cell("Quality Gate Tier", LABEL_BOLD), cell(traceability?.qualityGate?.tier ?? "—", LABEL)],
    [cell("Rigor Level", LABEL_BOLD), cell(traceability?.rigor?.currentLabel ?? "—", LABEL)],
    [cell("Rigor Summary", LABEL_BOLD), cell(traceability?.rigor?.summary ?? "—", { font: { sz: 8 }, alignment: { wrapText: true } })],
    [cell("Parser Fidelity Status", LABEL_BOLD), cell(traceability?.parserFidelity?.status ?? "—", LABEL)],
    [cell("Parser Fidelity Score", LABEL_BOLD), cell(traceability?.parserFidelity?.score ?? 0, NUM_INR)],
    [cell("Parser Fidelity Summary", LABEL_BOLD), cell(traceability?.parserFidelity?.summary ?? "—", { font: { sz: 8 }, alignment: { wrapText: true } })],
    [cell("Reconciliation Status", LABEL_BOLD), cell(traceability?.reconciliation?.status ?? "—", LABEL)],
    [cell("Max Reconciliation Residual", LABEL_BOLD), cell(traceability?.reconciliation?.maxResidualRatio ?? 0, NUM_PCT)],
    [cell("Reconciliation Summary", LABEL_BOLD), cell(traceability?.reconciliation?.summary ?? "—", { font: { sz: 8 }, alignment: { wrapText: true } })],
    [cell("Valuation Blocked", LABEL_BOLD), cell(traceability?.qualityGate?.valuationBlocked ? "yes" : "no", LABEL)],
    [cell("Scope Classification", LABEL_BOLD), cell(traceability?.qualityGate?.scopeClassification ?? "—", LABEL)],
    [cell("Confidence Blocking Issues", LABEL_BOLD), cell(traceability?.confidence?.blockingCount ?? 0, NUM_INR)],
    [cell("Confidence Diagnostic Issues", LABEL_BOLD), cell(traceability?.confidence?.diagnosticCount ?? 0, NUM_INR)],
    [cell("Confidence Optional Issues", LABEL_BOLD), cell(traceability?.confidence?.optionalCount ?? 0, NUM_INR)],
    [cell("Mapping Blocking Issues", LABEL_BOLD), cell(traceability?.mappingCoverage?.unresolvedBySeverity?.critical ?? 0, NUM_INR)],
    [cell("Mapping Diagnostic Issues", LABEL_BOLD), cell(traceability?.mappingCoverage?.unresolvedBySeverity?.warning ?? 0, NUM_INR)],
    [cell("Mapping Optional Issues", LABEL_BOLD), cell(traceability?.mappingCoverage?.unresolvedBySeverity?.info ?? 0, NUM_INR)],
    [cell("Out-of-spec Labels", LABEL_BOLD), cell(traceability?.mappingCoverage?.outOfSpecLabelCount ?? 0, NUM_INR)],
    [cell("Actionable Out-of-spec", LABEL_BOLD), cell(traceability?.mappingCoverage?.actionableOutOfSpecLabelCount ?? 0, NUM_INR)],
    [cell("Achieved Levels", LABEL_BOLD), cell(traceability?.rigor?.achievedLevels?.join(" | ") || "—", { font: { sz: 8 }, alignment: { wrapText: true } })],
    [cell("Pending Levels", LABEL_BOLD), cell(traceability?.rigor?.pendingLevels?.join(" | ") || "—", { font: { sz: 8 }, alignment: { wrapText: true } })],
    [cell("Backlog Preview", LABEL_BOLD), cell(traceability?.backlogPreview?.map((entry) => `${entry.statement}:${entry.key} [${entry.action}/${entry.priority}]`).join(" | ") || "—", { font: { sz: 8 }, alignment: { wrapText: true } })],
    [cell("")],
    [cell("Blocking Reasons", LABEL_BOLD), cell(traceability?.qualityGate?.blockingReasons?.join(" | ") || "—", { font: { sz: 8 }, alignment: { wrapText: true } })],
  ];
  setRange(ws, rows);
  ws["!cols"] = [{ wch: 28 }, { wch: 80 }];
  updateRef(ws);
  return ws;
}

// ── Sheet 2: Recast Statements ─────────────────────────────────────────────────
function buildRecastSheet(recastData: RecastPeriod[]): WorkSheet {
  const ws: WorkSheet = {};
  const periods = recastData.map(p => p.period_end.slice(0, 7));
  let row = 0;

  // Balance Sheet header
  setCell(ws, row, 0, cell("REFORMULATED BALANCE SHEET (₹ Cr)", HEADER_BLUE));
  periods.forEach((p, c) => setCell(ws, row, c + 1, cell(p, SUBHEADER)));
  row++;

  const bsRows: [string, (p: RecastPeriod) => number | null][] = [
    ["Operating Assets (OA)", p => p.bs.OA],
    ["  — of which: PPE", p => p.bs.PPE],
    ["  — of which: Trade Receivables", p => p.bs.TradeReceivables],
    ["  — of which: Inventories", p => p.bs.Inventory],
    ["Financial Assets (FA)", p => p.bs.FA],
    ["Total Assets (TA)", p => p.bs.TA],
    ["", () => null],
    ["Operating Liabilities (OL)", p => p.bs.OL],
    ["  — of which: Trade Payables", p => p.bs.TradePayables],
    ["Financial Obligations (FO)", p => p.bs.FO],
    ["Common Stockholders' Equity (CSE)", p => p.bs.CSE],
    ["Minority Interest (MI)", p => p.bs.MI],
    ["", () => null],
    ["NET OPERATING ASSETS (NOA) = OA − OL", p => p.bs.NOA],
    ["NET FINANCIAL OBLIGATIONS (NFO) = FO − FA", p => p.bs.NFO],
    ["Check: NOA − NFO − CSE − MI", p => p.bs.NOA - p.bs.NFO - p.bs.CSE - p.bs.MI],
  ];

  for (const [label, fn] of bsRows) {
    const isBold = ["NET OPERATING ASSETS", "NET FINANCIAL OBLIGATIONS", "Total Assets", "Common Stockholders"].some(s => label.includes(s));
    setCell(ws, row, 0, cell(label, isBold ? LABEL_BOLD : LABEL));
    recastData.forEach((p, c) => {
      const v = fn(p);
      setCell(ws, row, c + 1, cell(v ?? "", v != null ? NUM_INR : LABEL));
    });
    row++;
  }

  row++;
  // Income Statement
  setCell(ws, row, 0, cell("REFORMULATED INCOME STATEMENT (₹ Cr)", HEADER_BLUE));
  periods.forEach((p, c) => setCell(ws, row, c + 1, cell(p, SUBHEADER)));
  row++;

  const isRows: [string, (p: RecastPeriod) => number | null][] = [
    ["Sales", p => p.is.Sales],
    ["Operating Income (OI)", p => p.is.OI],
    ["  — Core OI", p => p.cu.CoreOI],
    ["  — Unusual OI (UOI)", p => p.cu.UOI],
    ["  — Exceptional Items (after tax)", p => p.cu.ExceptionalOperatingItemsAfterTax ?? p.cu.ExceptionalItemsAfterTax],
    ["  — Discontinued Operations (after tax)", p => p.cu.DiscontinuedOperationsAfterTax ?? null],
    ["  — OCI treated as unusual", p => p.cu.OCITotal],
    ["Net Financial Expense (NFE)", p => p.is.NFE],
    ["  — Core NFE", p => p.cu.CoreNFE],
    ["  — Unusual financing items", p => p.cu.UFE],
    ["Material Cost", p => p.is.operatingCostBridge?.materialCost ?? null],
    ["Employee Cost", p => p.is.operatingCostBridge?.employeeCost ?? null],
    ["Depreciation", p => p.is.operatingCostBridge?.depreciation ?? null],
    ["SG&A", p => p.is.operatingCostBridge?.sgaTotal ?? null],
    ["Other Operating Expense", p => p.is.operatingCostBridge?.otherOperatingExpense ?? null],
    ["Other Operating Income", p => p.is.operatingCostBridge?.otherOperatingIncome ?? null],
    ["Bridge Core OI", p => p.is.operatingCostBridge?.bridgeCoreOI ?? null],
    ["Minority Interest Income (MII)", p => p.is.MII],
    ["COMPREHENSIVE NET INCOME (CNI)", p => p.is.CNI],
    ["Tax Rate (effective)", p => p.is.taxRate],
  ];

  for (const [label, fn] of isRows) {
    const isBold = label === "COMPREHENSIVE NET INCOME (CNI)" || label === "Sales" || label === "Operating Income (OI)";
    setCell(ws, row, 0, cell(label, isBold ? LABEL_BOLD : LABEL));
    recastData.forEach((p, c) => {
      const v = fn(p);
      const style = label.includes("Tax Rate") ? NUM_PCT : (isBold ? GREEN_FILL : NUM_INR);
      setCell(ws, row, c + 1, cell(v ?? "", style));
    });
    row++;
  }

  row++;
  // Cash Flow
  setCell(ws, row, 0, cell("CASH FLOW SUMMARY (₹ Cr)", HEADER_BLUE));
  periods.forEach((p, c) => setCell(ws, row, c + 1, cell(p, SUBHEADER)));
  row++;
  const cfRows: [string, (p: RecastPeriod) => number][] = [
    ["CFO (Net Cash from Operations)", p => p.cf.CFO],
    ["Capex", p => -p.cf.Capex],
    ["Free Cash Flow (CFO − Capex)", p => p.cf.FCF_cash],
    ["Accounting FCF (OI − ΔNOA)", p => p.cf.FCF_accounting],
    ["EBITDA (derived)", p => p.cf.EBITDA],
    ["Dividend Paid", p => -p.cf.DividendPaid],
  ];
  for (const [label, fn] of cfRows) {
    setCell(ws, row, 0, cell(label, LABEL));
    recastData.forEach((p, c) => setCell(ws, row, c + 1, cell(fn(p), NUM_INR)));
    row++;
  }

  ws["!cols"] = [{ wch: 38 }, ...recastData.map(() => ({ wch: 14 }))];
  updateRef(ws);
  return ws;
}

// ── Sheet 3: Ratios ─────────────────────────────────────────────────────────────
function buildRatioSheet(recastData: RecastPeriod[]): WorkSheet {
  const ws: WorkSheet = {};
  const periods = recastData.map(p => p.period_end.slice(0, 7));
  let row = 0;

  setCell(ws, row, 0, cell("N&P RATIO DECOMPOSITION — Nissim & Penman (2001), Eq.1–16", HEADER_BLUE));
  periods.forEach((p, c) => setCell(ws, row, c + 1, cell(p, SUBHEADER)));
  setCell(ws, row, periods.length + 1, cell("N&P Benchmark (p25)", SUBHEADER));
  setCell(ws, row, periods.length + 2, cell("N&P Median", SUBHEADER));
  setCell(ws, row, periods.length + 3, cell("N&P p75", SUBHEADER));
  row++;

  const ratioRows: [string, (p: RecastPeriod) => number | null, string | undefined, boolean][] = [
    ["§5.1 PROFITABILITY", () => null, undefined, true],
    ["ROCE = CNI / avg(CSE)  [Eq.1]", p => p.ratios?.ROCE ?? null, "ROCE", false],
    ["RNOA = OI / avg(NOA)  [Eq.2]", p => p.ratios?.RNOA ?? null, "RNOA", false],
    ["NBC = NFE / avg(NFO)", p => p.ratios?.NBC ?? null, "NBC", false],
    ["SPREAD = RNOA − NBC  [Eq.3]", p => p.ratios?.SPREAD ?? null, "SPREAD", false],
    ["", () => null, undefined, true],
    ["§5.2 LEVERAGE", () => null, undefined, true],
    ["FLEV = NFO / CSE  [Eq.4]", p => p.ratios?.FLEV ?? null, "FLEV", false],
    ["OLLEV = OL / avg(NOA)  [Eq.5]", p => p.ratios?.OLLEV ?? null, "OLLEV", false],
    ["OLSPREAD = ROOA − io  [Eq.6]", p => p.ratios?.OLSPREAD ?? null, "OLSPREAD", false],
    ["", () => null, undefined, true],
    ["§5.3 OPERATING EFFICIENCY", () => null, undefined, true],
    ["PM = OI / Sales  [Eq.7]", p => p.ratios?.PM ?? null, "PM", false],
    ["ATO = Sales / avg(NOA)  [Eq.8]", p => p.ratios?.ATO ?? null, "ATO", false],
    ["Core Sales PM = Core OI / Sales", p => p.ratios?.CoreSalesPM ?? null, "PM", false],
    ["Sales Growth", p => p.ratios?.Sales_growth ?? null, "Sales_growth", false],
    ["NOA Growth", p => p.ratios?.NOA_growth ?? null, "NOA_growth", false],
    ["", () => null, undefined, true],
    ["§5.4 WORKING CAPITAL", () => null, undefined, true],
    ["Days Receivable (DSO)", p => p.ratios?.days_receivable ?? null, undefined, false],
    ["Days Payable (DPO)", p => p.ratios?.days_payable ?? null, undefined, false],
    ["Days Inventory (DIO)", p => p.ratios?.days_inventory ?? null, undefined, false],
    ["Cash Conversion Cycle (CCC)", p => p.ratios?.cash_conversion_cycle ?? null, undefined, false],
    ["Current Ratio", p => p.ratios?.current_ratio ?? null, undefined, false],
    ["", () => null, undefined, true],
    ["§5.5 ACCOUNTING QUALITY", () => null, undefined, true],
    ["Accrual Ratio (B/S method)", p => p.ratios?.accrual_ratio_bs ?? null, undefined, false],
    ["Accrual Ratio (C/F method)", p => p.ratios?.accrual_ratio_cf ?? null, undefined, false],
    ["Cash Conversion Ratio (CFO/OI)", p => p.ratios?.cash_conversion_ratio ?? null, undefined, false],
    ["Interest Coverage", p => p.ratios?.interest_coverage ?? null, undefined, false],
    ["ROCE Bridge Residual (Eq.16 error)", p => p.ratios?.ROCE_eq16_error ?? null, undefined, false],
  ];

  const pctKeys = new Set(["ROCE", "RNOA", "NBC", "SPREAD", "PM", "OLLEV", "OLSPREAD", "Sales_growth", "NOA_growth",
    "accrual_ratio_bs", "accrual_ratio_cf", "cash_conversion_ratio", "CoreSalesPM", "ROCE_eq16_error",
    "FLEV", "ATO"]);

  for (const [label, fn, benchKey, isSectionHeader] of ratioRows) {
    if (isSectionHeader) {
      setCell(ws, row, 0, cell(label, { font: { bold: true, sz: 10, color: { rgb: "4472C4" } } }));
      row++;
      continue;
    }
    setCell(ws, row, 0, cell(label, LABEL));
    const isPct = benchKey && pctKeys.has(benchKey);
    const isDays = label.includes("Days") || label.includes("CCC") || label.includes("Coverage");
    recastData.forEach((p, c) => {
      const v = fn(p);
      const style = isPct ? NUM_PCT : isDays ? NUM_2DP : NUM_2DP;
      setCell(ws, row, c + 1, cell(v, style));
    });
    if (benchKey && NP_BENCHMARKS[benchKey]) {
      const bm = NP_BENCHMARKS[benchKey];
      const s = isPct ? NUM_PCT : NUM_2DP;
      setCell(ws, row, periods.length + 1, cell(bm.p25, s));
      setCell(ws, row, periods.length + 2, cell(bm.median, { ...s, fill: { fgColor: { rgb: "FFF2CC" } } }));
      setCell(ws, row, periods.length + 3, cell(bm.p75, s));
    }
    row++;
  }

  ws["!cols"] = [{ wch: 42 }, ...recastData.map(() => ({ wch: 13 })), { wch: 16 }, { wch: 16 }, { wch: 16 }];
  updateRef(ws);
  return ws;
}

// ── Sheet 4: Forecast ──────────────────────────────────────────────────────────
function buildForecastSheet(scenarios: ForecastScenario[]): WorkSheet {
  const ws: WorkSheet = {};
  let row = 0;

  setCell(ws, row, 0, cell("FORECAST MODEL — Fade-Based Pro Forma (N&P 2001, §4)", HEADER_BLUE));
  row++;

  for (const sc of scenarios) {
    if (!sc.periods?.length) continue;
    row++;
    setCell(ws, row, 0, cell(`SCENARIO: ${sc.name.toUpperCase()} (P = ${(sc.probability * 100).toFixed(0)}%)`,
      { fill: { fgColor: { rgb: sc.name === "bull" ? "E2EFDA" : sc.name === "bear" ? "FCE4D6" : "DDEEFF" } }, font: { bold: true, sz: 10 } }));
    row++;

    const headers = ["Driver / Period", ...sc.periods.map(p => p.period_label)];
    headers.forEach((h, c) => setCell(ws, row, c, cell(h, SUBHEADER)));
    row++;

    const fRows: [string, (p: NonNullable<ForecastScenario["periods"]>[number]) => number][] = [
      ["Sales Growth Assumption", p => p.sales_growth_assumption],
      ["Core Sales PM", p => p.core_sales_pm_assumption],
      ["Asset Turnover (ATO)", p => p.ato_assumption],
      ["Material / Sales", p => p.material_cost_ratio_assumption ?? 0],
      ["Employee / Sales", p => p.employee_cost_ratio_assumption ?? 0],
      ["Depreciation / Sales", p => p.depreciation_ratio_assumption ?? 0],
      ["SG&A / Sales", p => p.sga_ratio_assumption ?? 0],
      ["Other Opex / Sales", p => p.other_opex_ratio_assumption ?? 0],
      ["Other Op Income / Sales", p => p.other_operating_income_ratio_assumption ?? 0],
      ["Forecast Sales (₹ Cr)", p => p.Sales_f],
      ["Forecast Gross Profit (₹ Cr)", p => p.GrossProfit_f ?? 0],
      ["Forecast Material Cost (₹ Cr)", p => p.MaterialCost_f ?? 0],
      ["Forecast Employee Cost (₹ Cr)", p => p.EmployeeCost_f ?? 0],
      ["Forecast Depreciation (₹ Cr)", p => p.Depreciation_f ?? 0],
      ["Forecast SG&A (₹ Cr)", p => p.SGA_f ?? 0],
      ["Forecast Other Opex (₹ Cr)", p => p.OtherOperatingExpense_f ?? 0],
      ["Forecast Other Op Income (₹ Cr)", p => p.OtherOperatingIncome_f ?? 0],
      ["Forecast Core OI Bridge (₹ Cr)", p => p.CoreOI_bridge_f ?? p.OI_f],
      ["Forecast NOA (₹ Cr)", p => p.NOA_f],
      ["Forecast OI (₹ Cr)", p => p.OI_f],
      ["Forecast CNI (₹ Cr)", p => p.CNI_f],
      ["Forecast ΔNOA (₹ Cr)", p => p.ΔNOA_f],
      ["Free Cash Flow (₹ Cr)", p => p.FCF_f],
      ["Residual Earnings RE (₹ Cr)", p => p.RE_f],
      ["Residual Op. Income ReOI (₹ Cr)", p => p.ReOI_f],
    ];
    const pctRowLabels = new Set([
      "Sales Growth Assumption",
      "Core Sales PM",
      "Asset Turnover (ATO)",
      "Material / Sales",
      "Employee / Sales",
      "Depreciation / Sales",
      "SG&A / Sales",
      "Other Opex / Sales",
      "Other Op Income / Sales",
    ]);

    for (const [label, fn] of fRows) {
      setCell(ws, row, 0, cell(label, LABEL));
      sc.periods.forEach((p, c) => {
        const v = fn(p);
        const style = pctRowLabels.has(label) ? NUM_PCT : (label.includes("RE") || label.includes("ReOI") ? (v >= 0 ? GREEN_FILL : { ...RED_NUM, numFmt: "#,##0" }) : NUM_INR);
        setCell(ws, row, c + 1, cell(v, style));
      });
      row++;
    }

    if (sc.valuationResult) {
      const vr = sc.valuationResult;
      row++;
      setCell(ws, row, 0, cell(`Valuation (${sc.name}) — ke=${(sc.drivers.ke * 100).toFixed(1)}%, kw=${(sc.drivers.kw * 100).toFixed(1)}%, g=${(sc.drivers.g_terminal * 100).toFixed(1)}%`, LABEL_BOLD));
      row++;
      [
        ["V_RE_CV3 (Equity Value)", vr.V_RE_CV3],
        ["V_ReOI_CV03 (Equity Value)", vr.V_ReOI_CV03],
      ].forEach(([label, v]) => {
        setCell(ws, row, 0, cell(label as string, LABEL));
        setCell(ws, row, 1, cell(v as number, GREEN_FILL));
        row++;
      });
    }
  }

  ws["!cols"] = [{ wch: 36 }, ...Array(10).fill({ wch: 14 })];
  updateRef(ws);
  return ws;
}

// ── Sheet 5: Valuation Summary ─────────────────────────────────────────────────
function buildValuationSheet(valuation: ValuationResult, config: EngineConfig, metadata?: WorkbookExportMetadata): WorkSheet {
  const valuationBlocked = metadata?.valuationStatus === "guarded";
  const ws: WorkSheet = {};
  let row = 0;
  const versions = metadata?.policyVersions;

  setCell(ws, row, 0, cell("VALUATION SUMMARY — Model Triangulation", HEADER_BLUE));
  row++;
  setCell(ws, row, 0, cell("Audit Run ID", LABEL_BOLD));
  setCell(ws, row, 1, cell(metadata?.auditRunId ?? "—", LABEL));
  row++;
  setCell(ws, row, 0, cell("Valuation Status", LABEL_BOLD));
  setCell(ws, row, 1, cell(metadata?.valuationStatus ?? "production-ready", LABEL));
  row++;
  setCell(ws, row, 0, cell("Anchor Period", LABEL_BOLD));
  setCell(ws, row, 1, cell(metadata?.valuationAnchorPeriod ?? "—", LABEL));
  row++;
  setCell(ws, row, 0, cell("Latest Source Period", LABEL_BOLD));
  setCell(ws, row, 1, cell(metadata?.valuationSourcePeriod ?? "—", LABEL));
  row++;
  setCell(ws, row, 0, cell("Status Note", LABEL_BOLD));
  setCell(ws, row, 1, cell(metadata?.valuationReasons?.[0] ?? "—", { font: { sz: 8 }, alignment: { wrapText: true } }));
  row++;
  setCell(ws, row, 0, cell("Policy Versions", LABEL_BOLD));
  setCell(
    ws,
    row,
    1,
    cell(
      versions
        ? `engine=${versions.engineVersion}; mapping-spec=${versions.mappingSpecVersion}; mapping-policy=${versions.mappingPolicyVersion}; anomaly=${versions.anomalyPolicyVersion}; valuation=${versions.valuationPolicyVersion}`
        : "—",
      { font: { sz: 8 }, alignment: { wrapText: true } },
    ),
  );
  row += 2;

  setCell(ws, row, 0, cell("Assumptions", LABEL_BOLD));
  row++;
  [
    ["Cost of Equity (ke)", valuation.ke, true],
    ["WACC (kw)", valuation.kw, true],
    ["Terminal Growth (g)", valuation.g, true],
  ].forEach(([l, v, isPct]) => {
    setCell(ws, row, 0, cell(l as string, LABEL));
    setCell(ws, row, 1, cell(v as number, isPct ? NUM_PCT : NUM_2DP));
    row++;
  });

  row++;
  setCell(ws, row, 0, cell("MODEL OUTPUTS (₹ Crores)", HEADER_BLUE));
  row++;
  setCell(ws, row, 0, cell("Model", SUBHEADER));
  setCell(ws, row, 1, cell("Equity Value (₹ Cr)", SUBHEADER));
  setCell(ws, row, 2, cell("Per Share", SUBHEADER));
  setCell(ws, row, 3, cell("Notes", SUBHEADER));
  row++;

  const models: [string, number | null | undefined, number | null | undefined, string][] = valuationBlocked
    ? [
        ["RE (CV3 — Gordon Growth)", null, null, "Suppressed because valuation is guarded; latest period is not safe for full-confidence terminal valuation."],
        ["ReOI (CV03 — Gordon Growth)", null, null, "Suppressed because valuation is guarded; latest period is not safe for full-confidence terminal valuation."],
        ["FCFF", null, null, "Suppressed because valuation is guarded; latest period is not safe for full-confidence terminal valuation."],
        ["FCFE", null, null, "Suppressed because valuation is guarded; latest period is not safe for full-confidence terminal valuation."],
        ["DDM", null, null, "Suppressed because valuation is guarded; latest period is not safe for full-confidence terminal valuation."],
        ["AEG (Ohlson-Juettner)", null, null, "Suppressed because valuation is guarded; latest period is not safe for full-confidence terminal valuation."],
      ]
    : [
        ["RE (CV3 — Gordon Growth)", valuation.V_RE_CV3, valuation.perShare?.intrinsic_re_per_share, "N&P Eq.(1a) — Clean surplus accounting"],
        ["ReOI (CV03 — Gordon Growth)", valuation.V_ReOI_CV03, valuation.perShare?.intrinsic_reoi_per_share, "N&P Eq.(9) — Operating focus; EV − NFO"],
        ["FCFF", valuation.fcf?.EV_FCFF != null ? valuation.fcf.EV_FCFF - valuation.NFO_latest : null, valuation.perShare?.intrinsic_fcff_per_share, "FCFF = NOPAT − ΔNOA; EV at WACC; less NFO"],
        ["FCFE", valuation.fcf?.V_FCFE, valuation.perShare?.intrinsic_fcfe_per_share, "FCFE = CNI − ΔCSE; discounted at ke"],
        ["DDM", valuation.perShare?.intrinsic_ddm_per_share != null && config.shares_outstanding ? valuation.perShare.intrinsic_ddm_per_share * config.shares_outstanding : null, valuation.perShare?.intrinsic_ddm_per_share, "Gordon DDM; requires stable dividend payout"],
        ["AEG (Ohlson-Juettner)", valuation.aeg?.V_AEG, valuation.perShare?.intrinsic_aeg_per_share, "OJ (2005) abnormal earnings growth model"],
      ];

  models.forEach(([name, equity, perShare, note]) => {
    setCell(ws, row, 0, cell(name, LABEL_BOLD));
    setCell(ws, row, 1, cell(equity ?? null, equity != null ? GREEN_FILL : LABEL));
    setCell(ws, row, 2, cell(perShare ?? null, perShare != null ? NUM_2DP : LABEL));
    setCell(ws, row, 3, cell(note, { font: { sz: 8 } }));
    row++;
  });

  row++;
  row++;
  if (valuationBlocked) {
    setCell(ws, row, 0, cell("VALUATION SENSITIVITY AND REVERSE DCF", HEADER_BLUE));
    row++;
    setCell(ws, row, 0, cell("Guarded mode", LABEL_BOLD));
    setCell(ws, row, 1, cell("Sensitivity grids and reverse DCF are suppressed until the valuation anchor is clean enough for terminal-value work.", { font: { sz: 8 }, alignment: { wrapText: true } }));
  } else {
    setCell(ws, row, 0, cell("SENSITIVITY TABLE — V_RE_CV3 vs ke × g", HEADER_BLUE));
    row++;

    const kes = [0.08, 0.10, 0.12, 0.14];
    const gs = [0.02, 0.03, 0.04, 0.05, 0.06];
    setCell(ws, row, 0, cell("ke \\ g →", SUBHEADER));
    gs.forEach((g, c) => setCell(ws, row, c + 1, cell(`${(g * 100).toFixed(0)}%`, SUBHEADER)));
    row++;

    kes.forEach(ke => {
      setCell(ws, row, 0, cell(`ke = ${(ke * 100).toFixed(0)}%`, LABEL_BOLD));
      gs.forEach((g, c) => {
        if (ke - g > 0.001 && valuation.pvRE != null) {
          const cv = (valuation.reSeries.length ? valuation.reSeries[valuation.reSeries.length - 1].RE : 0) * (1 + g) / (ke - g);
          const T = valuation.reSeries.length;
          const disc = Math.pow(1 + ke, T);
          const v = valuation.CSE0 + valuation.pvRE + cv / disc;
          const isBase = Math.abs(ke - valuation.ke) < 0.001 && Math.abs(g - valuation.g) < 0.001;
          setCell(ws, row, c + 1, cell(v, isBase ? { ...GREEN_FILL, font: { bold: true, sz: 9 } } : NUM_INR));
        } else {
          setCell(ws, row, c + 1, cell("N/A", LABEL));
        }
      });
      row++;
    });

    if (valuation.perShare?.implied_growth_rate != null) {
      row++;
      setCell(ws, row, 0, cell("Reverse DCF — Implied Growth Rate (RE vs Market Price)", LABEL_BOLD));
      setCell(ws, row, 1, cell(valuation.perShare.implied_growth_rate, { ...AMBER_FILL, numFmt: "0.0%" }));
      row++;
      setCell(ws, row, 0, cell("Margin of Safety (RE-CV3 vs Market Price)", LABEL_BOLD));
      setCell(ws, row, 1, cell(valuation.perShare.margin_of_safety_re, { numFmt: "0.0%", font: { sz: 9 } }));
    }
  }

  ws["!cols"] = [{ wch: 40 }, { wch: 18 }, { wch: 14 }, { wch: 50 }];
  updateRef(ws);
  return ws;
}

// ── Sheet 6: Quality Scores ────────────────────────────────────────────────────
function buildQualitySheet(recastData: RecastPeriod[]): WorkSheet {
  const ws: WorkSheet = {};
  const periods = recastData.map(p => p.period_end.slice(0, 7));
  let row = 0;

  setCell(ws, row, 0, cell("EARNINGS & ACCOUNTING QUALITY SCORES", HEADER_BLUE));
  periods.forEach((p, c) => setCell(ws, row, c + 1, cell(p, SUBHEADER)));
  row += 2;

  const qRows: [string, (p: RecastPeriod) => number | null | boolean | undefined, string][] = [
    ["PIOTROSKI F-SCORE (0–9; ≥ 7 = strong)", p => p.quality?.piotroski_total ?? null, "Total F-Score"],
    ["  — ROA > 0", p => p.quality?.piotroski_roa, ""],
    ["  — ΔROA > 0", p => p.quality?.piotroski_delta_roa, ""],
    ["  — CFO > 0", p => p.quality?.piotroski_cfo, ""],
    ["  — Accrual quality", p => p.quality?.piotroski_accrual, ""],
    ["  — Leverage ↓", p => p.quality?.piotroski_leverage, ""],
    ["  — Liquidity ↑", p => p.quality?.piotroski_liquidity, ""],
    ["  — No dilution", p => p.quality?.piotroski_dilution, ""],
    ["  — Gross margin ↑", p => p.quality?.piotroski_margin, ""],
    ["  — Asset turnover ↑", p => p.quality?.piotroski_turnover, ""],
    ["BENEISH M-SCORE (< −1.78 = low manipulation risk)", p => p.quality?.beneish_mscore ?? null, ""],
    ["ALTMAN Z'-SCORE (> 2.9 = safe; < 1.23 = distress)", p => p.quality?.altman_zprime ?? null, ""],
    ["ZMIJEWSKI X-SCORE (< 0 = low distress risk)", p => p.quality?.zmijewski_xscore ?? null, ""],
    ["  — P(Distress) Zmijewski", p => p.quality?.zmijewski_prob_distress ?? null, ""],
    ["OHLSON O-SCORE (< 0 = low distress risk)", p => p.quality?.ohlson_oscore ?? null, ""],
    ["  — P(Distress) Ohlson", p => p.quality?.ohlson_prob_distress ?? null, ""],
    ["SLOAN ACCRUALS — Total", p => p.quality?.sloan_total_accruals ?? null, ""],
    ["  — WC Accruals", p => p.quality?.sloan_wc_accruals ?? null, ""],
    ["  — LT Accruals", p => p.quality?.sloan_lt_accruals ?? null, ""],
    ["Accrual Reliability (0=low, 1=high)", p => p.quality?.accrual_reliability_score ?? null, ""],
    ["Cash Earnings Quality Index (CEQI = CFO/PAT)", p => p.quality?.cash_earnings_quality_index ?? null, ""],
    ["Operating Leverage (DOL)", p => p.quality?.operating_leverage ?? null, ""],
  ];

  const pctFields = new Set(["P(Distress) Zmijewski", "P(Distress) Ohlson", "Accrual Reliability"]);
  const bigFonts = new Set(["PIOTROSKI", "BENEISH", "ALTMAN", "ZMIJEWSKI", "OHLSON", "SLOAN"]);

  for (const [label, fn] of qRows) {
    const isBig = [...bigFonts].some(s => label.toUpperCase().startsWith(s));
    setCell(ws, row, 0, cell(label, isBig ? LABEL_BOLD : LABEL));
    recastData.forEach((p, c) => {
      const v = fn(p);
      const numV = typeof v === "boolean" ? (v ? 1 : 0) : (v ?? null);
      const style = pctFields.has(label.replace("  — ", "")) ? NUM_PCT : NUM_2DP;
      setCell(ws, row, c + 1, cell(numV, style));
    });
    row++;
  }

  ws["!cols"] = [{ wch: 48 }, ...recastData.map(() => ({ wch: 13 }))];
  updateRef(ws);
  return ws;
}

// ── Main export function ───────────────────────────────────────────────────────
export async function generateValuationWorkbook(
  recastData: RecastPeriod[],
  forecastScenarios: ForecastScenario[],
  valuation: ValuationResult,
  config: EngineConfig,
  metadata?: WorkbookExportMetadata,
): Promise<ArrayBuffer> {
  const wb: WorkBook = utils.book_new();

  utils.book_append_sheet(wb, buildCoverSheet(config, recastData.length, metadata), "Cover");
  utils.book_append_sheet(wb, buildRecastSheet(recastData), "Recast Statements");
  utils.book_append_sheet(wb, buildRatioSheet(recastData), "N&P Ratios");

  if (forecastScenarios.length > 0) {
    utils.book_append_sheet(wb, buildForecastSheet(forecastScenarios), "Forecast Model");
  }

  utils.book_append_sheet(wb, buildValuationSheet(valuation, config, metadata), "Valuation");
  utils.book_append_sheet(wb, buildQualitySheet(recastData), "Quality Scores");
  utils.book_append_sheet(wb, buildTraceabilitySheet(metadata), "Traceability");

  const provenanceRows = buildProvenanceAuditRows(recastData);
  if (provenanceRows.length > 0) {
    utils.book_append_sheet(wb, utils.json_to_sheet(provenanceRows), "Provenance Audit");
  }
  const discrepancyRows = buildMappingDiscrepancyRows(recastData);
  if (discrepancyRows.length > 0) {
    utils.book_append_sheet(wb, utils.json_to_sheet(discrepancyRows), "Mapping Discrepancies");
  }

  return await writeWorkbookArray(wb) as ArrayBuffer;
}

export async function generateValuationWorkbookFromPublicationSnapshot(params: {
  snapshot: {
    companyId: string | null;
    valuationReadiness: {
      status: "production-ready" | "warning" | "guarded";
      reasons: string[];
      anchorPeriod: string | null;
      latestPeriod: string | null;
    };
    policyVersions: AnalysisPolicyVersions;
    traceability: AnalysisTraceabilityEnvelope;
    auditMeta?: { runId?: string | null } | null;
  };
  recastData: RecastPeriod[];
  forecastScenarios: ForecastScenario[];
  valuation: ValuationResult;
  config: EngineConfig;
}): Promise<ArrayBuffer> {
  return generateValuationWorkbook(
    params.recastData,
    params.forecastScenarios,
    params.valuation,
    params.config,
    workbookMetadataFromPublicationSnapshot(params.snapshot),
  );
}
