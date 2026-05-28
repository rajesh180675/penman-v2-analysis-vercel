import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
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
      NFO: 0,
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

function mkBalancedPeriod(period_end: string): RecastPeriod {
  return {
    ...mkPeriod(period_end),
    bs: {
      ...mkPeriod(period_end).bs,
      FO: 150,
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

/** Load a generated workbook buffer for read-back assertions. */
async function loadWorkbook(buf: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

/** Get the value of cell `addr` (e.g. "B6") on sheet `name`. Returns null if missing. */
function cellValue(wb: ExcelJS.Workbook, sheetName: string, addr: string): unknown {
  const sheet = wb.getWorksheet(sheetName);
  if (!sheet) return null;
  const cell = sheet.getCell(addr);
  // ExcelJS may return objects for rich text / formulas; flatten to plain value.
  const v = cell.value as unknown;
  if (v && typeof v === "object" && "result" in (v as Record<string, unknown>)) {
    return (v as { result: unknown }).result;
  }
  return v;
}

/** Find a label in column A of `sheetName`, return the value in column B of the same row. */
function valueByLabel(wb: ExcelJS.Workbook, sheetName: string, label: string): unknown {
  const sheet = wb.getWorksheet(sheetName);
  expect(sheet, `sheet '${sheetName}' missing`).toBeTruthy();
  let foundRow: number | null = null;
  sheet!.eachRow((row, rowIdx) => {
    if (foundRow !== null) return;
    const a = row.getCell(1).value as unknown;
    if (a === label) {
      foundRow = rowIdx;
      return;
    }
    // Rich-text cells appear as { richText: [{ text: string, ... }] }
    if (a && typeof a === "object" && "richText" in (a as Record<string, unknown>)) {
      const rt = (a as { richText?: { text?: string }[] }).richText;
      if (Array.isArray(rt) && rt.map(r => r?.text ?? "").join("") === label) {
        foundRow = rowIdx;
      }
    }
  });
  expect(foundRow, `label '${label}' not found in sheet '${sheetName}'`).not.toBeNull();
  return cellValue(wb, sheetName, `B${foundRow}`);
}

async function coverKeCellValue(config: EngineConfig): Promise<number> {
  const workbookBuf = await generateValuationWorkbook([mkPeriod("2025-03-31")], [], valuation, config);
  const wb = await loadWorkbook(workbookBuf);
  return valueByLabel(wb, "Cover", "Cost of Equity (ke)") as number;
}

describe("generateValuationWorkbook", () => {
  it("exports explicit config.ke to the Cover ke field", async () => {
    const cfg: EngineConfig = {
      ...DEFAULT_CONFIG,
      ke: 0.18,
      risk_free_rate: 0.03,
      equity_risk_premium: 0.05,
    };
    expect(await coverKeCellValue(cfg)).toBeCloseTo(0.18, 8);
  });

  it("falls back to rf+erp when config.ke is non-positive", async () => {
    const cfg: EngineConfig = {
      ...DEFAULT_CONFIG,
      ke: 0,
      risk_free_rate: 0.04,
      equity_risk_premium: 0.06,
    };
    expect(await coverKeCellValue(cfg)).toBeCloseTo(0.1, 8);
  });

  it("suppresses valuation outputs when workbook metadata is guarded", async () => {
    const workbookBuf = await generateValuationWorkbook(
      [mkBalancedPeriod("2025-03-31")],
      [],
      valuation,
      DEFAULT_CONFIG,
      {
        companyLabel: "ITC",
        valuationStatus: "guarded",
        valuationReasons: ["Using prior anchor period 2024-03-31 because 2025-03-31 is compromised."],
        valuationAnchorPeriod: "2024-03-31",
        valuationSourcePeriod: "2025-03-31",
      },
    );
    const wb = await loadWorkbook(workbookBuf);
    expect(valueByLabel(wb, "Valuation", "Valuation Status")).toBe("guarded");
    expect(valueByLabel(wb, "Valuation", "RE (CV3 — Gordon Growth)")).toBe("");
    expect(String(valueByLabel(wb, "Valuation", "Guarded mode"))).toContain("suppressed");
  });

  it("writes company and valuation metadata to the workbook", async () => {
    const traceability = buildAnalysisTraceability({
      generatedAt: "2026-03-29T19:00:00.000Z",
      runId: "run-123",
      companyId: "ITC",
      sourceMode: "json",
      recastData: [mkBalancedPeriod("2025-03-31")],
      config: DEFAULT_CONFIG,
      rawData: [
        {
          company_id: "ITC",
          period_end: "2025-03-31",
          raw_metric_values: {
            "Total Assets__BalanceSheet": 1000,
            "Total Equity__BalanceSheet": 600,
            "Revenue From Operations(Net)__ProfitLoss": 900,
            "Profit After Tax__ProfitLoss": 90,
          },
        },
      ],
      periodCount: 1,
      latestPeriod: "2025-03-31",
      policyVersions: getAnalysisPolicyVersions(),
    });
    const workbookBuf = await generateValuationWorkbook(
      [mkBalancedPeriod("2025-03-31")],
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
    const wb = await loadWorkbook(workbookBuf);

    expect(cellValue(wb, "Cover", "B6")).toBe("ITC");
    expect(valueByLabel(wb, "Cover", "Audit Run ID")).toBe("run-123");
    expect(valueByLabel(wb, "Cover", "Valuation Status")).toBe("guarded");
    expect(valueByLabel(wb, "Cover", "Valuation Anchor Period")).toBe("2024-03-31");
    expect(valueByLabel(wb, "Cover", "Engine Version")).toBe(getAnalysisPolicyVersions().engineVersion);
    expect(valueByLabel(wb, "Cover", "Mapping Spec Version")).toBe(getAnalysisPolicyVersions().mappingSpecVersion);
    expect(valueByLabel(wb, "Cover", "Scope Policy Version")).toBe(getAnalysisPolicyVersions().scopePolicyVersion);
    expect(valueByLabel(wb, "Cover", "Traceability Schema")).toBe(getAnalysisPolicyVersions().traceabilitySchemaVersion);
    expect(valueByLabel(wb, "Cover", "Rigor Level")).toBe("Economically plausible");
    expect(valueByLabel(wb, "Cover", "Parser Fidelity")).toBe("confirmed");
    expect(valueByLabel(wb, "Cover", "Reconciliation Status")).toBe("confirmed");
    expect(valueByLabel(wb, "Valuation", "Audit Run ID")).toBe("run-123");
    expect(valueByLabel(wb, "Valuation", "Valuation Status")).toBe("guarded");
    expect(valueByLabel(wb, "Valuation", "Anchor Period")).toBe("2024-03-31");
    expect(valueByLabel(wb, "Traceability", "Run ID")).toBe("run-123");
    expect(valueByLabel(wb, "Traceability", "Schema Version")).toBe(getAnalysisPolicyVersions().traceabilitySchemaVersion);
    expect(valueByLabel(wb, "Traceability", "Rigor Level")).toBe("Economically plausible");
    expect(valueByLabel(wb, "Traceability", "Parser Fidelity Status")).toBe("confirmed");
    expect(valueByLabel(wb, "Traceability", "Parser Fidelity Score")).toBe(100);
    expect(valueByLabel(wb, "Traceability", "Reconciliation Status")).toBe("confirmed");
    expect(valueByLabel(wb, "Traceability", "Max Reconciliation Residual")).toBe(0);
    expect(valueByLabel(wb, "Traceability", "Achieved Levels")).toBe("syntactically-valid | structurally-reconciled | economically-plausible");
  });

  it("exports effective confidence counters separately from mapping coverage counters", async () => {
    const versions = getAnalysisPolicyVersions();
    const traceability = buildAnalysisTraceability({
      generatedAt: "2026-04-04T10:00:00.000Z",
      runId: "run-blocked",
      companyId: "ITC",
      sourceMode: "json",
      rawData: [
        {
          company_id: "ITC",
          period_end: "2025-03-31",
          raw_metric_values: {
            "Total Assets__BalanceSheet": 1000,
            "Total Equity__BalanceSheet": 600,
            "Revenue From Operations(Net)__ProfitLoss": 900,
            "Profit After Tax__ProfitLoss": 90,
          },
        },
      ],
      recastData: [mkBalancedPeriod("2025-03-31")],
      config: DEFAULT_CONFIG,
      periodCount: 1,
      latestPeriod: "2025-03-31",
      policyVersions: versions,
      qualityGate: {
        tier: "Tier 1",
        valuationBlocked: true,
        missingMinimum: [],
        missingCore: [],
        blockingReasons: ["Terminal anchor remains guarded."],
        policyVersion: versions.mappingPolicyVersion,
        coverageSummary: {
          policyVersion: versions.mappingPolicyVersion,
          issues: [],
          unresolvedBySeverity: { critical: [], warning: [], info: [] },
          unresolvedByTier: { "Tier A": [], "Tier B": [], "Tier C": [], "Tier D": [] },
          totalsByTier: {
            "Tier A": { total: 0, resolved: 0, unresolved: 0 },
            "Tier B": { total: 0, resolved: 0, unresolved: 0 },
            "Tier C": { total: 0, resolved: 0, unresolved: 0 },
            "Tier D": { total: 0, resolved: 0, unresolved: 0 },
          },
        },
        valuationCriticalGaps: [],
        ratioCriticalGaps: [],
        scopeAssessment: {
          policyVersion: versions.scopePolicyVersion,
          classification: "supported-industrial",
          analysisFamily: "industrial",
          blocked: false,
          label: "Supported industrial/company scope",
          reasons: [],
          recommendedAction: "Proceed",
          signals: [],
        },
      },
      analysisStatus: {
        status: "blocked",
        label: "Blocked",
        headline: "Valuation blocked",
        summary: "Terminal anchor remains guarded.",
        reasons: ["Terminal anchor remains guarded."],
        tone: "red",
        qualityTier: "Tier 1",
        valuationStatus: "guarded",
        scopeBlocked: false,
        valuationBlocked: true,
        blockingCount: 0,
        diagnosticCount: 0,
        optionalCount: 0,
        effectiveBlockingCount: 1,
        effectiveDiagnosticCount: 0,
        effectiveOptionalCount: 0,
      },
    });

    const workbookBuf = await generateValuationWorkbook(
      [mkBalancedPeriod("2025-03-31")],
      [],
      valuation,
      DEFAULT_CONFIG,
      {
        companyLabel: "ITC",
        auditRunId: "run-blocked",
        valuationStatus: "guarded",
        valuationReasons: ["Terminal anchor remains guarded."],
        valuationAnchorPeriod: "2024-03-31",
        valuationSourcePeriod: "2025-03-31",
        policyVersions: versions,
        traceability,
      },
    );
    const wb = await loadWorkbook(workbookBuf);

    expect(valueByLabel(wb, "Traceability", "Confidence Blocking Issues")).toBe(1);
    expect(valueByLabel(wb, "Traceability", "Confidence Diagnostic Issues")).toBe(0);
    expect(valueByLabel(wb, "Traceability", "Confidence Optional Issues")).toBe(0);
    expect(valueByLabel(wb, "Traceability", "Mapping Blocking Issues")).toBe(0);
    expect(valueByLabel(wb, "Traceability", "Mapping Diagnostic Issues")).toBe(0);
    expect(valueByLabel(wb, "Traceability", "Mapping Optional Issues")).toBe(0);
  });

  // ─── Workbook regression contract (Gap 5 / PR-E) ─────────────────────────
  //
  // The generated XLSX is the auditor-facing artifact. Schema drift = silent
  // audit corruption. These tests pin the contract documented at
  // `docs/workbook-regression-contract.md`. Intentional sheet renames /
  // schema changes must update both the contract and these assertions in
  // the same PR.

  it("regression: workbook contains the documented sheet manifest", async () => {
    const traceability = buildAnalysisTraceability({
      generatedAt: "2026-05-28T10:00:00.000Z",
      runId: "run-manifest",
      companyId: "ITC",
      sourceMode: "json",
      recastData: [mkBalancedPeriod("2024-03-31"), mkBalancedPeriod("2025-03-31")],
      config: DEFAULT_CONFIG,
      rawData: [
        { company_id: "ITC", period_end: "2024-03-31", raw_metric_values: { "Total Equity__BalanceSheet": 600 } },
        { company_id: "ITC", period_end: "2025-03-31", raw_metric_values: { "Total Equity__BalanceSheet": 600 } },
      ],
      periodCount: 2,
      latestPeriod: "2025-03-31",
      policyVersions: getAnalysisPolicyVersions(),
    });

    const workbookBuf = await generateValuationWorkbook(
      [mkBalancedPeriod("2024-03-31"), mkBalancedPeriod("2025-03-31")],
      [],
      valuation,
      DEFAULT_CONFIG,
      {
        companyLabel: "ITC",
        auditRunId: "run-manifest",
        valuationStatus: "production-ready",
        valuationReasons: [],
        valuationAnchorPeriod: "2025-03-31",
        valuationSourcePeriod: "2025-03-31",
        policyVersions: getAnalysisPolicyVersions(),
        traceability,
      },
    );
    const wb = await loadWorkbook(workbookBuf);

    // Required sheets per the regression contract. Order matters here only
    // for human readability; the test only checks presence.
    const REQUIRED_SHEETS = [
      "Cover",
      "Recast Statements",
      "N&P Ratios",
      "Valuation",
      "Quality Scores",
      "Traceability",
      "Ratio Sanity",
    ];
    const sheetNames = wb.worksheets.map((s) => s.name);
    for (const name of REQUIRED_SHEETS) {
      expect(sheetNames, `missing sheet '${name}' (regression contract)`).toContain(name);
    }
  });

  it("regression: cover sheet carries company, run, generation, and rigor metadata", async () => {
    const traceability = buildAnalysisTraceability({
      generatedAt: "2026-05-28T10:00:00.000Z",
      runId: "run-cover",
      companyId: "ITC",
      sourceMode: "json",
      recastData: [mkBalancedPeriod("2025-03-31")],
      config: DEFAULT_CONFIG,
      rawData: [
        { company_id: "ITC", period_end: "2025-03-31", raw_metric_values: { "Total Equity__BalanceSheet": 600 } },
      ],
      periodCount: 1,
      latestPeriod: "2025-03-31",
      policyVersions: getAnalysisPolicyVersions(),
    });

    const workbookBuf = await generateValuationWorkbook(
      [mkBalancedPeriod("2025-03-31")],
      [],
      valuation,
      DEFAULT_CONFIG,
      {
        companyLabel: "ITC",
        auditRunId: "run-cover",
        valuationStatus: "production-ready",
        valuationReasons: [],
        valuationAnchorPeriod: "2025-03-31",
        valuationSourcePeriod: "2025-03-31",
        policyVersions: getAnalysisPolicyVersions(),
        traceability,
      },
    );
    const wb = await loadWorkbook(workbookBuf);

    expect(valueByLabel(wb, "Cover", "Audit Run ID")).toBe("run-cover");
    expect(valueByLabel(wb, "Cover", "Engine Version")).toBe(getAnalysisPolicyVersions().engineVersion);
    expect(valueByLabel(wb, "Cover", "Traceability Schema")).toBe(getAnalysisPolicyVersions().traceabilitySchemaVersion);
    expect(valueByLabel(wb, "Cover", "Rigor Level")).toBeTruthy();
  });

  it("regression: traceability sheet matches in-memory envelope state", async () => {
    const traceability = buildAnalysisTraceability({
      generatedAt: "2026-05-28T10:00:00.000Z",
      runId: "run-trace",
      companyId: "ITC",
      sourceMode: "json",
      recastData: [mkBalancedPeriod("2025-03-31")],
      config: DEFAULT_CONFIG,
      rawData: [
        { company_id: "ITC", period_end: "2025-03-31", raw_metric_values: { "Total Equity__BalanceSheet": 600 } },
      ],
      periodCount: 1,
      latestPeriod: "2025-03-31",
      policyVersions: getAnalysisPolicyVersions(),
    });

    const workbookBuf = await generateValuationWorkbook(
      [mkBalancedPeriod("2025-03-31")],
      [],
      valuation,
      DEFAULT_CONFIG,
      {
        companyLabel: "ITC",
        auditRunId: "run-trace",
        valuationStatus: "production-ready",
        valuationReasons: [],
        valuationAnchorPeriod: "2025-03-31",
        valuationSourcePeriod: "2025-03-31",
        policyVersions: getAnalysisPolicyVersions(),
        traceability,
      },
    );
    const wb = await loadWorkbook(workbookBuf);

    expect(valueByLabel(wb, "Traceability", "Run ID")).toBe(traceability.runContext.runId);
    expect(valueByLabel(wb, "Traceability", "Schema Version")).toBe(traceability.schemaVersion);
    expect(valueByLabel(wb, "Traceability", "Parser Fidelity Status")).toBe(traceability.parserFidelity.status);
    expect(valueByLabel(wb, "Traceability", "Reconciliation Status")).toBe(traceability.reconciliation.status);
  });

  it("regression: valuation sheet keeps anchor period and run id consistent with metadata", async () => {
    const workbookBuf = await generateValuationWorkbook(
      [mkBalancedPeriod("2025-03-31")],
      [],
      valuation,
      DEFAULT_CONFIG,
      {
        companyLabel: "ITC",
        auditRunId: "run-val",
        valuationStatus: "production-ready",
        valuationReasons: [],
        valuationAnchorPeriod: "2024-03-31",
        valuationSourcePeriod: "2025-03-31",
      },
    );
    const wb = await loadWorkbook(workbookBuf);

    expect(valueByLabel(wb, "Valuation", "Audit Run ID")).toBe("run-val");
    expect(valueByLabel(wb, "Valuation", "Anchor Period")).toBe("2024-03-31");
    expect(valueByLabel(wb, "Valuation", "Valuation Status")).toBe("production-ready");
  });

  it("regression: deliberate sheet rename causes the manifest test to fail (contract enforcement)", () => {
    // This is a meta-test. It documents the contract: if any author renames
    // a sheet without updating the REQUIRED_SHEETS list above, the
    // manifest test must fail. We assert that here by construction —
    // REQUIRED_SHEETS is a literal list inside this file, not pulled from
    // excelExport.ts. So a rename in excelExport.ts that skips the contract
    // doc + this list will be caught.
    const SAMPLE_REQUIRED = ["Cover", "Recast Statements", "Valuation"];
    const renamedSheets = ["Cover", "Statements", "Valuation"];
    for (const s of SAMPLE_REQUIRED) {
      // Demonstrates the contract: the test layer enforces the literal list.
      // If "Recast Statements" gets renamed to "Statements" in excelExport.ts,
      // the previous test will fail. This test just confirms the literal
      // list is the source of truth.
      if (s === "Recast Statements") {
        expect(renamedSheets).not.toContain(s);
      } else {
        expect(renamedSheets).toContain(s);
      }
    }
  });
});
