/**
 * Core workbook sheets (Cover, Traceability, Ratio Sanity, Recast)  extracted verbatim from excelExport.ts.
 */
import type { EngineConfig, RecastPeriod } from "../types";
import { ke_from_config } from "../types";
import type { AnalysisTraceabilityEnvelope } from "../analysisTraceability";
import type { AnalysisPolicyVersions } from "../policyVersions";
import type { SanityAssessment } from "../ratioSanity";
import type { WorkSheet, CellObject } from "./xlsx";
import {
  cell,
  setCell,
  setRange,
  updateRef,
  HEADER_BLUE,
  SUBHEADER,
  LABEL,
  LABEL_BOLD,
  NUM_INR,
  NUM_PCT,
  GREEN_FILL,
} from "./xlsx";

export interface WorkbookExportMetadata {
  companyLabel?: string | undefined;
  auditRunId?: string | null | undefined;
  valuationStatus?: "production-ready" | "warning" | "guarded" | undefined;
  valuationReasons?: string[] | undefined;
  valuationAnchorPeriod?: string | null | undefined;
  valuationSourcePeriod?: string | null | undefined;
  policyVersions?: AnalysisPolicyVersions | undefined;
  traceability?: AnalysisTraceabilityEnvelope | undefined;
  /** Phase 9 — anchor ratio bands (economic sanity gate). */
  ratioSanity?: SanityAssessment | null | undefined;
}

// ── Sheet 1: Cover ─────────────────────────────────────────────────────────────
export function buildCoverSheet(config: EngineConfig, periodCount: number, metadata?: WorkbookExportMetadata): WorkSheet {
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
    [cell("Ratio Sanity", LABEL_BOLD), cell(metadata?.ratioSanity?.status ?? "—", LABEL)],
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

export function buildTraceabilitySheet(metadata?: WorkbookExportMetadata): WorkSheet {
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
    [cell("Ratio Sanity Status", LABEL_BOLD), cell(metadata?.ratioSanity?.status ?? "—", LABEL)],
    [cell("Ratio Sanity Warnings", LABEL_BOLD), cell(metadata?.ratioSanity?.warningCount ?? 0, NUM_INR)],
    [cell("Ratio Sanity Failures", LABEL_BOLD), cell(metadata?.ratioSanity?.failCount ?? 0, NUM_INR)],
    [cell("Ratio Sanity Summary", LABEL_BOLD), cell(metadata?.ratioSanity?.summary ?? "—", { font: { sz: 8 }, alignment: { wrapText: true } })],
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

// ── Sheet 7b: Ratio Sanity (Phase 9 — anchor ratio bands) ─────────────────────
export function buildRatioSanitySheet(metadata?: WorkbookExportMetadata): WorkSheet {
  const ws: WorkSheet = {};
  const sanity = metadata?.ratioSanity ?? null;
  const rows: CellObject[][] = [
    [cell("RATIO SANITY (PHASE 9)", { font: { bold: true, sz: 14, color: { rgb: "1F3864" } } })],
    [cell("Anchor ratio bands per company type — flags economically implausible outputs", { font: { sz: 9, color: { rgb: "666666" } } })],
    [cell("")],
    [cell("Company Type", LABEL_BOLD), cell(sanity?.companyType ?? "—", LABEL)],
    [cell("Overall Status", LABEL_BOLD), cell(sanity?.status ?? "n/a", LABEL)],
    [cell("Warnings", LABEL_BOLD), cell(sanity?.warningCount ?? 0, NUM_INR)],
    [cell("Failures", LABEL_BOLD), cell(sanity?.failCount ?? 0, NUM_INR)],
    [cell("Summary", LABEL_BOLD), cell(sanity?.summary ?? "—", { font: { sz: 8 }, alignment: { wrapText: true } })],
    [cell("")],
    [cell("CHECK", HEADER_BLUE), cell("VALUE", HEADER_BLUE), cell("STATUS", HEADER_BLUE), cell("NORMAL BAND", HEADER_BLUE), cell("WARNING BAND", HEADER_BLUE), cell("DETAIL", HEADER_BLUE)],
  ];
  if (sanity?.checks?.length) {
    for (const check of sanity.checks) {
      rows.push([
        cell(check.label, LABEL),
        cell(check.value ?? "—", check.value != null ? NUM_PCT : LABEL),
        cell(check.status, LABEL),
        cell(`[${check.band.normal[0]}, ${check.band.normal[1]}]`, LABEL),
        cell(`[${check.band.warning[0]}, ${check.band.warning[1]}]`, LABEL),
        cell(check.detail, { font: { sz: 8 }, alignment: { wrapText: true } }),
      ]);
    }
  } else {
    rows.push([cell("(no sanity checks ran)", { font: { sz: 9, color: { rgb: "888888" } } })]);
  }
  setRange(ws, rows);
  ws["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 50 }];
  updateRef(ws);
  return ws;
}

// ── Sheet 2: Recast Statements ─────────────────────────────────────────────────
export function buildRecastSheet(recastData: RecastPeriod[]): WorkSheet {
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
