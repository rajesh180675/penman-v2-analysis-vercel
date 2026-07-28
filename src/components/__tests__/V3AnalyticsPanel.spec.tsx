import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import V3AnalyticsPanel from "../V3AnalyticsPanel";
import { MoatSection } from "../v3-analytics/MoatSection";
import { CapitalAllocSection } from "../v3-analytics/CapitalAllocSection";
import { EPVSection } from "../v3-analytics/EPVSection";
import { RelativeValSection } from "../v3-analytics/RelativeValSection";
import { GapDecompSection } from "../v3-analytics/GapDecompSection";
import { buildAnalysisTraceability } from "../../engine/analysisTraceability";
import { getAnalysisPolicyVersions } from "../../engine/policyVersions";
import { DEFAULT_CONFIG, RecastPeriod, RawPeriodData } from "../../engine/types";
import type { ITServicesSignal } from "../../engine/itServicesDetector";

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

function mkV3Period(period_end: string): RecastPeriod {
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
      ROCE_bridge_residual: 0,
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
      ROCE_eq16_error: 0,
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
  };
}

describe("V3AnalyticsPanel", () => {
  it("renders the shared traceability trust gate ahead of V3 analytics sections", () => {
    const data = [
      mkV3Period("2024-03-31"),
      mkV3Period("2025-03-31"),
    ];
    const rawData = [
      mkRawPeriod("2024-03-31"),
      mkRawPeriod("2025-03-31"),
    ];
    const traceability = buildAnalysisTraceability({
      generatedAt: "2026-04-03T18:00:00.000Z",
      runId: "run-v3",
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
      <V3AnalyticsPanel
        data={data}
        config={DEFAULT_CONFIG}
        traceability={traceability}
        itServices={null}
      />,
    );

    expect(html).toContain("V3 Analytics Trust Gate");
    expect(html).toContain("Economically plausible");
    expect(html).toContain("V3 Analytics — Executive Overview");
  });

  it("renders all 15 tab labels so section composition stays intact", () => {
    const data = [mkV3Period("2024-03-31"), mkV3Period("2025-03-31")];
    const html = renderToStaticMarkup(
      <V3AnalyticsPanel data={data} config={DEFAULT_CONFIG} itServices={null} />,
    );
    for (const label of [
      "Overview",
      "Dirty Surplus §6",
      "Event Flags §13",
      "Terminal Anchor §11",
      "Sensitivity §12",
      "Confidence §14",
      "Triggers §15",
      "Accruals §5A",
      "OA Decomp §3B",
      "RE/ReOI Gap §6",
      "§6B Per-Share",
      "Moat Score",
      "Capital Allocation",
      "EPV (Graham-Dodd)",
      "Relative Valuation",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("pins the default Overview pane: headers, metric cards, and diagnostics", () => {
    const data = [mkV3Period("2024-03-31"), mkV3Period("2025-03-31")];
    const html = renderToStaticMarkup(
      <V3AnalyticsPanel data={data} config={DEFAULT_CONFIG} itServices={null} />,
    );
    // Section header + subtitle
    expect(html).toContain("V3 Analytics — Executive Overview");
    expect(html).toContain("Full implementation of Penman–Nissim V3 specification");
    // Metric card labels
    expect(html).toContain("Confidence Score");
    expect(html).toContain("TV Share (RE CV3)");
    expect(html).toContain("Anchor Method");
    expect(html).toContain("RE–ReOI Gap");
    // Confidence score is formatted as N/100
    expect(html).toMatch(/\d+\/100/);
    // Info blocks + rows
    expect(html).toContain("Terminal Value");
    expect(html).toContain("Terminal growth g");
    expect(html).toContain("Selected anchor");
    expect(html).toContain("Data Quality");
    expect(html).toContain("Cumulative dirty surplus");
    expect(html).toContain("Clean surplus compromised");
  });

  it("shows the ≥2 periods guard when given a single period", () => {
    const html = renderToStaticMarkup(
      <V3AnalyticsPanel data={[mkV3Period("2025-03-31")]} config={DEFAULT_CONFIG} itServices={null} />,
    );
    expect(html).toContain("Need ≥ 2 periods for V3 analytics");
  });

  // Phase E3 wiring. `computeMoatScore` has always known how to disqualify
  // itself for an IT-services company, and this panel has always known how to
  // render that caveat — but the prop carrying the signal was optional and the
  // only caller never passed it, so for TCS and INFY the panel scored moat
  // width on structurally inflated RNOA and reported it as sufficient.
  //
  // Asserted in both directions, because the failure mode was silence: a test
  // that only checks the caveat appears would also pass if the panel warned
  // unconditionally, which is a different bug with the same green tick.
  describe("IT-services moat caveat", () => {
    const IT_SIGNAL: ITServicesSignal = {
      isITServices: true,
      medianEmployeeCostRatio: 0.52,
      medianPPERatio: 0.04,
      reason: "employee cost 52% of revenue, PPE 4% of total assets",
      periodsAnalysed: 3,
    };
    // Three periods: below that `computeMoatScore` returns null and there is no
    // classification to caveat, so the test would pass vacuously.
    const data = [mkV3Period("2023-03-31"), mkV3Period("2024-03-31"), mkV3Period("2025-03-31")];

    it("marks the moat score low-confidence when the signal is supplied", () => {
      const html = renderToStaticMarkup(
        <V3AnalyticsPanel data={data} config={DEFAULT_CONFIG} itServices={IT_SIGNAL} />,
      );
      expect(html).toContain("Moat score is low-confidence");
      expect(html).toContain("IT-services company");
    });

    it("does not caveat the moat score when there is no signal", () => {
      const html = renderToStaticMarkup(
        <V3AnalyticsPanel data={data} config={DEFAULT_CONFIG} itServices={null} />,
      );
      expect(html).not.toContain("IT-services company");
    });
  });
});

// Per-section render tests. The panel SSR-renders only the default "overview"
// pane, so these pin the extracted sub-sections directly (covers the 14 panes
// that the panel's default render cannot reach).
describe("V3 analytics sub-sections", () => {
  it("MoatSection renders the null-state when moat is null", () => {
    const html = renderToStaticMarkup(<MoatSection moat={null} />);
    expect(html).toContain("Insufficient data for moat scoring");
  });

  it("CapitalAllocSection renders the null-state when ca is null", () => {
    const html = renderToStaticMarkup(<CapitalAllocSection ca={null} />);
    expect(html).toContain("Insufficient data for capital allocation scoring");
  });

  it("EPVSection renders the null-state when epv is null", () => {
    const html = renderToStaticMarkup(<EPVSection epv={null} />);
    expect(html).toContain("EPV requires ≥ 3 periods");
  });

  it("RelativeValSection renders the null-state when rv is null", () => {
    const html = renderToStaticMarkup(<RelativeValSection rv={null} />);
    expect(html).toContain("Relative valuation requires market_price and shares_outstanding");
  });

  it("GapDecompSection renders rows, header, %-of-total, and dominant-driver star", () => {
    const html = renderToStaticMarkup(
      <GapDecompSection
        gap={{
          dirty_surplus: 60,
          nfo_timing: 20,
          tv_divergence: 10,
          explicit_period_discounting: 10,
          residual: 0,
          total: 100,
          dominant_driver: "nfo_timing",
        }}
      />,
    );
    expect(html).toContain("§6 RE ↔ ReOI Gap Decomposition (S-15.2)");
    expect(html).toContain("Dirty surplus (PV)");
    expect(html).toContain("NFO timing");
    expect(html).toContain("TV divergence (ke vs kw)");
    expect(html).toContain("Total gap");
    // dominant_driver "nfo_timing" matches the "NFO timing" row → starred
    expect(html).toContain("★");
    // dirty_surplus 60 / total 100 = 60.0% of total
    expect(html).toContain("60.0%");
    expect(html).toContain("Primary driver:");
  });
});
