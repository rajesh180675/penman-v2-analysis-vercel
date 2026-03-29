import { describe, expect, it } from "vitest";
import { read } from "xlsx";
import { buildAnalysisTraceability } from "../analysisTraceability";
import { generateValuationWorkbook } from "../excelExport";
import { getAnalysisPolicyVersions } from "../policyVersions";
import { DEFAULT_CONFIG, EngineConfig, RecastPeriod, ValuationResult } from "../types";

function mkPeriod(period_end: string): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000,
      CSE: 600,
      MI: 0,
      FA: 150,
      FO: 200,
      OA: 850,
      OL: 250,
      OL_TradePayables: 80,
      OL_OtherCurrentLiabilities: 50,
      OL_ProvisionsCurrent: 10,
      OL_ProvisionsLongTerm: 10,
      OL_CurrentTaxLiabilities: 10,
      OL_NonCurrentTaxLiabilities: 10,
      OL_DeferredTaxLiabilitiesNet: 5,
      OL_OtherNonCurrentLiabilities: 75,
      NOA: 600,
      NFO: 50,
      DTL: 5,
      PensionObl: 0,
      OL_ex_DTL: 245,
      Goodwill: 0,
      CurrentAssets: 400,
      CurrentLiabilities: 220,
      Inventory: 90,
      TradeReceivables: 110,
      TradePayables: 80,
      PPE: 320,
      LIFO_reserve: 0,
      separationScore: 90,
      OA_PPE: 320,
      OA_ROU: 0,
      OA_Goodwill: 0,
      OA_OtherIntangibles: 0,
      OA_Inventory: 90,
      OA_TradeReceivables: 110,
      OA_DTA: 0,
      OA_CWIP: 0,
      OA_Other: 330,
    },
    is: {
      Sales: 900,
      TaxExpense: 30,
      taxRate: 0.25,
      PAT: 90,
      OCI: 0,
      TCI: 90,
      TCI_NCI: 0,
      CNI: 90,
      FinanceCost: 12,
      FinanceIncome: 2,
      FinanceIncomeRung: 1,
      PreferredDividend: 0,
      NFE: 10,
      OI: 100,
      OtherItems: 0,
      OI_from_sales: 100,
      MII: 0,
      COGS: 600,
    },
    cu: {
      UOI: 0,
      CoreOI: 100,
      UFE: 0,
      CoreNFE: 10,
      ExceptionalItemsAfterTax: 0,
      OCITotal: 0,
    },
    cf: {
      CFO: 120,
      Capex: 40,
      DividendPaid: 20,
      EquityIssued: 0,
      ShareBuybacks: 0,
      InterestReceived: 0,
      DividendReceived: 0,
      FCF_accounting: 60,
      FCF_cash: 80,
      d_t: 20,
      d_t_formula: 20,
      d_t_discrepancy: 0,
      EBITDA: 140,
    },
  };
}

const valuation: ValuationResult = {
  reSeries: [{ period: "2025-03-31", RE: 40, ReOI: 35 }],
  pvRE: 35,
  pvReOI: 30,
  CV_RE: 400,
  CV_ReOI: 320,
  EV_ReOI: 350,
  V_RE_CV1: 500,
  V_RE_CV2: 520,
  V_RE_CV3: 540,
  V_ReOI_CV01: 480,
  V_ReOI_CV02: 500,
  V_ReOI_CV03: 520,
  CSE0: 600,
  NOA0: 600,
  NFO_latest: 50,
  ke: 0.12,
  kw: 0.1,
  g: 0.04,
  separationScore: 90,
  lowConfidence: false,
};

function coverKeCellValue(config: EngineConfig): number {
  const workbookBuf = generateValuationWorkbook([mkPeriod("2025-03-31")], [], valuation, config);
  const wb = read(workbookBuf, { type: "array" });
  const sheet = wb.Sheets.Cover;
  const entries = Object.entries(sheet);
  const labelCell = entries.find(([, cell]) => cell && typeof cell === "object" && "v" in cell && cell.v === "Cost of Equity (ke)");
  expect(labelCell).toBeTruthy();
  const row = Number(labelCell![0].replace(/^[A-Z]+/, "")) - 1;
  return sheet[`B${row + 1}`]?.v as number;
}

function sheetValueByLabel(sheet: Record<string, { v?: unknown }>, label: string) {
  const match = Object.entries(sheet).find(([, cell]) => cell && typeof cell === "object" && "v" in cell && cell.v === label);
  expect(match).toBeTruthy();
  const row = Number(match![0].replace(/^[A-Z]+/, ""));
  return sheet[`B${row}`]?.v;
}

describe("generateValuationWorkbook", () => {
  it("exports explicit config.ke to the Cover ke field", () => {
    const cfg: EngineConfig = {
      ...DEFAULT_CONFIG,
      ke: 0.18,
      risk_free_rate: 0.03,
      equity_risk_premium: 0.05,
    };
    expect(coverKeCellValue(cfg)).toBeCloseTo(0.18, 8);
  });

  it("falls back to rf+erp when config.ke is non-positive", () => {
    const cfg: EngineConfig = {
      ...DEFAULT_CONFIG,
      ke: 0,
      risk_free_rate: 0.04,
      equity_risk_premium: 0.06,
    };
    expect(coverKeCellValue(cfg)).toBeCloseTo(0.1, 8);
  });

  it("writes company and valuation metadata to the workbook", () => {
    const traceability = buildAnalysisTraceability({
      generatedAt: "2026-03-29T19:00:00.000Z",
      runId: "run-123",
      companyId: "ITC",
      sourceMode: "capitaline",
      periodCount: 1,
      latestPeriod: "2025-03-31",
      policyVersions: getAnalysisPolicyVersions(),
    });
    const workbookBuf = generateValuationWorkbook(
      [mkPeriod("2025-03-31")],
      [],
      valuation,
      DEFAULT_CONFIG,
      {
        companyLabel: "ITC",
        auditRunId: "run-123",
        valuationStatus: "guarded",
        valuationReasons: ["Using prior anchor period 2024-03-31 because 2025-03-31 is compromised."],
        valuationAnchorPeriod: "2024-03-31",
        valuationSourcePeriod: "2025-03-31",
        policyVersions: getAnalysisPolicyVersions(),
        traceability,
      },
    );
    const wb = read(workbookBuf, { type: "array" });

    expect(wb.Sheets.Cover.B6?.v).toBe("ITC");
    expect(sheetValueByLabel(wb.Sheets.Cover, "Audit Run ID")).toBe("run-123");
    expect(sheetValueByLabel(wb.Sheets.Cover, "Valuation Status")).toBe("guarded");
    expect(sheetValueByLabel(wb.Sheets.Cover, "Valuation Anchor Period")).toBe("2024-03-31");
    expect(sheetValueByLabel(wb.Sheets.Cover, "Engine Version")).toBe(getAnalysisPolicyVersions().engineVersion);
    expect(sheetValueByLabel(wb.Sheets.Cover, "Mapping Spec Version")).toBe(getAnalysisPolicyVersions().mappingSpecVersion);
    expect(sheetValueByLabel(wb.Sheets.Cover, "Scope Policy Version")).toBe(getAnalysisPolicyVersions().scopePolicyVersion);
    expect(sheetValueByLabel(wb.Sheets.Cover, "Traceability Schema")).toBe(getAnalysisPolicyVersions().traceabilitySchemaVersion);
    expect(sheetValueByLabel(wb.Sheets.Valuation, "Audit Run ID")).toBe("run-123");
    expect(sheetValueByLabel(wb.Sheets.Valuation, "Valuation Status")).toBe("guarded");
    expect(sheetValueByLabel(wb.Sheets.Valuation, "Anchor Period")).toBe("2024-03-31");
    expect(sheetValueByLabel(wb.Sheets.Traceability, "Run ID")).toBe("run-123");
    expect(sheetValueByLabel(wb.Sheets.Traceability, "Schema Version")).toBe(getAnalysisPolicyVersions().traceabilitySchemaVersion);
  });
});
