/** @vitest-environment jsdom (asserts against a parsed DOM) */
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import AcademicReport from "../AcademicReport";
import { runExportIcBundle } from "../academic/AcademicReport.exports";
import { buildAnalysisTraceability } from "../../engine/analysisTraceability";
import { getAnalysisPolicyVersions } from "../../engine/policyVersions";
import { DEFAULT_CONFIG, RecastPeriod, RawPeriodData } from "../../engine/types";
import { buildAnalysisPublicationSnapshot } from "../../lib/publication/analysisPublicationSnapshot";

afterEach(() => {
  vi.restoreAllMocks();
});

function mkRawPeriod(period_end: string): RawPeriodData {
  return {
    company_id: "ITC",
    period_end,
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000,
      "Total Equity__BalanceSheet": 600,
      "Revenue From Operations(Net)__ProfitLoss": 900,
      "Profit After Tax__ProfitLoss": 90,
    },
  };
}

function mkReportPeriod(period_end: string): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000,
      CSE: 600,
      MI: 0,
      FA: 150,
      FO: 150,
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
      DebtProceeds: 0,
      DebtRepayment: 0,
      SaleFixedAssets: 0,
      PurchaseInvestments: 0,
      SaleInvestments: 0,
      FCF_accounting: 60,
      FCF_cash: 80,
      d_t: 20,
      d_t_formula: 20,
      d_t_discrepancy: 0,
      EBITDA: 140,
    },
    ratios: {
      ROCE: 0.15,
      RNOA: 0.14,
      NBC: 0.04,
      SPREAD: 0.10,
      FLEV: 0,
      PM: 0.11,
      ATO: 1.4,
      SalesPM: 0.11,
      ATO_star: 1.2,
      OtherItemsRatio: 0,
      ROCE_bridge_residual: 0.0,
      io: 0,
      ROOA: 0.12,
      OLLEV: 0.25,
      OLSPREAD: 0.02,
      RNOA_check: 0.14,
      ROTCE: 0.16,
      MSR: 1.0,
      CoreSalesPM: 0.10,
      CoreOtherItems_OA: 0,
      UOI_OA: 0,
      CoreNBC: 0.04,
      UFE_NFO: 0,
      CoreSPREAD: 0.08,
      ROCE_eq16_reconstructed: 0.15,
      ROCE_eq16_error: 0.0,
      eq16_step1_residual: 0,
      eq16_step2_residual: 0,
      eq16_step3_residual: 0,
      eq16_flag: "OK",
      eq16_diagnosis: null,
      ROOA_spec: 0.12,
      imputed_io_spec: 0,
      required_return_per_sales: 0.03,
      value_creating_margin: 0.08,
      CSE_eq8_check: 600,
      CSE_eq8_error_pct: 0,
      current_ratio: 1.8,
      quick_ratio: 1.4,
      days_receivable: 45,
      days_payable: 35,
      days_inventory: 55,
      cash_conversion_cycle: 65,
      accrual_ratio_bs: 0.03,
      accrual_ratio_cf: 0.02,
      cash_conversion_ratio: 1.15,
      interest_coverage: 8.3,
      NOA_growth: 0.04,
      CNI_growth: 0.05,
      OI_growth: 0.06,
      Sales_growth: 0.06,
      noaSmall: false,
      separationScore: 90,
      accrual_regime: "NORMAL",
      dirty_surplus: 0,
      dirty_surplus_pct_cse: 0,
      freeOL: 0,
      interestBearingOL: 0,
      OLLEV_check: 0,
      RNOA_vs_OLLEV_residual: 0,
    employeeCostRatio: null,
    },
    quality: {
      piotroski_total: 7,
      beneish_dsri: 1,
      beneish_gmi: 1,
      beneish_aqi: 1,
      beneish_sgi: 1,
      beneish_depi: 1,
      beneish_sgai: 1,
      beneish_lvgi: 1,
      beneish_tata: 0.02,
      altman_zprime: 3.1,
      altman_wc_ta: 0.18,
      altman_re_ta: 0.22,
      altman_ebit_ta: 0.12,
      altman_bve_tl: 1.5,
      altman_s_ta: 0.9,
      beneish_mscore: -2.0,
      zmijewski_roa: 0.09,
      zmijewski_leverage: 0.4,
      zmijewski_liquidity: 1.5,
      zmijewski_xscore: -2.2,
      zmijewski_prob_distress: 0.08,
      ohlson_size: 6,
      ohlson_leverage: 0.4,
      ohlson_liquidity: 1.5,
      ohlson_roe_neg: false,
      ohlson_chin: 0,
      ohlson_oscore: -1.9,
      ohlson_prob_distress: 0.07,
      sloan_wc_accruals: 0.03,
      sloan_lt_accruals: 0.01,
      sloan_total_accruals: 0.04,
      accrual_reliability_score: 0.86,
      cash_earnings_quality_index: 1.1,
      operating_leverage: 1.2,
      conservative_accounting_score: 72,
      revenue_quality_flags: [],
      piotroski_roa: 1,
      piotroski_delta_roa: 1,
      piotroski_cfo: 1,
      piotroski_accrual: 1,
      piotroski_leverage: 1,
      piotroski_liquidity: 1,
      piotroski_dilution: 1,
      piotroski_margin: 0,
      piotroski_turnover: 0,
    },
  };
}

describe("AcademicReport", () => {
  it("renders the shared traceability trust gate ahead of the memo body", () => {
    const data = [
      mkReportPeriod("2024-03-31"),
      mkReportPeriod("2025-03-31"),
    ];
    const rawData = [
      mkRawPeriod("2024-03-31"),
      mkRawPeriod("2025-03-31"),
    ];
    const traceability = buildAnalysisTraceability({
      generatedAt: "2026-04-03T16:00:00.000Z",
      runId: "run-report",
      companyId: "ITC",
      sourceMode: "json",
      rawData,
      recastData: data,
      config: DEFAULT_CONFIG,
      periodCount: 2,
      recastPeriodCount: 2,
      latestPeriod: "2025-03-31",
      policyVersions: getAnalysisPolicyVersions(),
    });

    const html = renderToStaticMarkup(
      <AcademicReport
        data={data}
        config={DEFAULT_CONFIG}
        rawData={rawData}
        traceability={traceability}
      />,
    );

    expect(html).toContain("Report Trust Gate");
    expect(html).toContain("Economically plausible");
    expect(html).toContain("Investor Research Memorandum");
  });

  it("renders every numbered report section with pinned formatted values", () => {
    const data = [
      mkReportPeriod("2024-03-31"),
      mkReportPeriod("2025-03-31"),
    ];
    const rawData = [
      mkRawPeriod("2024-03-31"),
      mkRawPeriod("2025-03-31"),
    ];
    const traceability = buildAnalysisTraceability({
      generatedAt: "2026-04-03T16:00:00.000Z",
      runId: "run-report",
      companyId: "ITC",
      sourceMode: "json",
      rawData,
      recastData: data,
      config: DEFAULT_CONFIG,
      periodCount: 2,
      recastPeriodCount: 2,
      latestPeriod: "2025-03-31",
      policyVersions: getAnalysisPolicyVersions(),
    });

    const html = renderToStaticMarkup(
      <AcademicReport
        data={data}
        config={DEFAULT_CONFIG}
        rawData={rawData}
        traceability={traceability}
      />,
    );

    // Section headers (structural anchors). Substrings avoid &/×/— escaping.
    expect(html).toContain("1) Executive Findings");
    expect(html).toContain("2) Methodology");
    expect(html).toContain("3) Profitability and Growth Diagnostics");
    expect(html).toContain("3A) NOA denominator diagnostics");
    expect(html).toContain("3B) NOA structural-break diagnostics");
    expect(html).toContain("4) Balance-Sheet Structure and Financing Posture");
    expect(html).toContain("5) Cash-Flow Quality and Clean-Surplus Diagnostics");
    expect(html).toContain("5A) Accrual-ratio time series");
    expect(html).toContain("5B) Operating trajectory timeline (full sample)");
    expect(html).toContain("6) Valuation Synthesis (Residual Income Framework)");
    expect(html).toContain("6A) RE sensitivity matrix");
    expect(html).toContain("6A.1) Explicit residual-income stream");
    expect(html).toContain("6B) Per-share and market-implied checks");
    expect(html).toContain("6C) Quality Score Decomposition");
    expect(html).toContain("7) Investment Interpretation and Monitoring Triggers");

    // Header KPI block — separation confidence is deterministic.
    expect(html).toContain("Separation Confidence");
    expect(html).toContain("90/100");
    expect(html).toContain("Latest ROCE");

    // §3 Profitability table — N&P benchmark medians render verbatim.
    expect(html).toContain("12.2%"); // ROCE median
    expect(html).toContain("10.0%"); // RNOA median (also latest SPREAD)
    expect(html).toContain("5.5%"); // PM median
    expect(html).toContain("1.18x"); // ATO median

    // §1 Executive findings — quality diagnostics pins.
    expect(html).toContain("7/9"); // Piotroski F-score
    expect(html).toContain("(Safe)"); // Altman Z' zone (3.10 > 2.9)
    expect(html).toContain("(clean threshold)"); // Beneish M-score -2.00 > -1.78

    // §3A NOA diagnostics — flag rule produces 0 flagged of 2.
    expect(html).toContain("Flagged periods:");
    expect(html).toContain("0</b> / 2");

    // §2.6 Data source mapping echoes separation score again.
    expect(html).toContain("90/100");

    // §6C Piotroski/Altman component decomposition labels.
    expect(html).toContain("Piotroski components");
    expect(html).toContain("EBIT / TA");
  });

  it("builds a validated IC ZIP with the canonical report, PDF, evidence, and closed manifest", async () => {
    const data = [mkReportPeriod("2024-03-31"), mkReportPeriod("2025-03-31")];
    const rawData = [mkRawPeriod("2024-03-31"), mkRawPeriod("2025-03-31")];
    const traceability = buildAnalysisTraceability({
      generatedAt: "2026-04-03T16:00:00.000Z",
      runId: "run-report",
      companyId: "ITC",
      sourceMode: "json",
      rawData,
      recastData: data,
      config: DEFAULT_CONFIG,
      periodCount: 2,
      recastPeriodCount: 2,
      latestPeriod: "2025-03-31",
      policyVersions: getAnalysisPolicyVersions(),
    });
    const publication = buildAnalysisPublicationSnapshot({
      data,
      config: DEFAULT_CONFIG,
      rawData,
      auditMeta: null,
      sharedTraceability: traceability,
    });
    const reportElement = document.createElement("div");
    reportElement.innerHTML = `
      <h1>Investor Research Memorandum</h1>
      <h2>Executive Findings</h2>
      <p>Valuation evidence for ITC.</p>
      <table><tr><th>Metric</th><th>Value</th></tr><tr><td>RNOA</td><td>12%</td></tr></table>
    `;

    let downloaded: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new Error("Expected Blob artifact");
      downloaded = blob;
      return "blob:ic-bundle";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
      if (typeof callback === "function") callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const result = await runExportIcBundle({
      reportEl: reportElement,
      data,
      traceRecords: [],
      provenanceRows: publication.provenanceRows,
      granularityChecklist: publication.granularityChecklist,
      valuationReadiness: publication.valuationReadiness,
      policyVersions: publication.policyVersions,
      traceability: publication.traceability,
      runIdentity: publication.runIdentity,
      companyId: "ITC",
      hmacKeyId: "",
      hmacSecret: "",
      auditMeta: null,
    });

    expect(result.format).toBe("zip");
    expect(result.filename).toBe("penman-ITC-ic-bundle-2025-03-31.zip");
    expect(result.auditStatus).toBe("not-requested");
    const bundle = downloaded as Blob | null;
    if (!bundle) throw new Error("Expected IC bundle download");
    const archive = await JSZip.loadAsync(new Uint8Array(await bundle.arrayBuffer()));
    const names = Object.keys(archive.files);
    expect(names).toEqual(expect.arrayContaining([
      "penman-ITC-academic-report-2025-03-31.pdf",
      "report_document.json",
      "report_document.html",
      "traceability_appendix.csv",
      "traceability_appendix.json",
      "provenance_audit_report.csv",
      "provenance_audit_report.md",
      "manifest.json",
    ]));
    const manifest = JSON.parse(await archive.file("manifest.json")!.async("string")) as {
      generatedAt: string;
      reportDocumentSchema: string;
      checksums: Array<{ file: string }>;
      signature: { mode: string };
    };
    expect(manifest.reportDocumentSchema).toBe("2026-07-report-document-v1");
    expect(manifest.signature.mode).toBe("unsigned");
    const canonicalReport = JSON.parse(await archive.file("report_document.json")!.async("string")) as {
      generatedAt: string;
    };
    expect(canonicalReport.generatedAt).toBe(manifest.generatedAt);
    expect(manifest.checksums.map((entry) => entry.file).sort())
      .toEqual(names.filter((name) => name !== "manifest.json").sort());
    expect(await archive.file("penman-ITC-academic-report-2025-03-31.pdf")!.async("string"))
      .toMatch(/^%PDF-/);
  }, 30_000);
});
