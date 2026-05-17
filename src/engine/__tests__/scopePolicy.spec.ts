import { describe, expect, it } from "vitest";
import { assessAnalysisScope } from "../scopePolicy";

describe("scopePolicy", () => {
  it("does not false-positive on industrial companies with zero insurance fields", () => {
    const periods = [
      {
        company_id: "INDUSTRIAL",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 100,
          "Total Equity__BalanceSheet": 60,
          "Profit After Tax__ProfitLoss": 10,
          "Profit Before Tax__ProfitLoss": 13,
          "Tax Expenses__ProfitLoss": 3,
          "Revenue From Operations(Net)__ProfitLoss": 80,
          "Finance Cost__ProfitLoss": 1,
          "Net Cash from Operating Activities__CashFlow": 12,
          "Purchased of Fixed Assets__CashFlow": -4,
          "Policy Holder's Investments (Insurance Business)__BalanceSheet": 0,
          "Claims Expenses__ProfitLoss": 0,
        },
      },
    ];

    const assessment = assessAnalysisScope(periods);
    expect(assessment.blocked).toBe(false);
    expect(assessment.classification).toBe("supported-industrial");
  });

  it("routes financial-company datasets to financial pipeline when banking/nbfc signals carry value", () => {
    const periods = [
      {
        company_id: "NBFC_CASE",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 1200,
          "Total Equity__BalanceSheet": 140,
          "Profit After Tax__ProfitLoss": 25,
          "Profit Before Tax__ProfitLoss": 35,
          "Tax Expenses__ProfitLoss": 10,
          "Revenue From Operations(Net)__ProfitLoss": 210,
          "Finance Cost__ProfitLoss": 82,
          "Net Cash from Operating Activities__CashFlow": 60,
          "Purchased of Fixed Assets__CashFlow": -5,
          "Finance Receivables__BalanceSheet": 850,
          "Loan Assets__BalanceSheet": 730,
          "Interest / Discount on Advances / Bills__ProfitLoss": 190,
          "Income from Financial Services__ProfitLoss": 102,
        },
      },
    ];

    const assessment = assessAnalysisScope(periods);
    expect(assessment.blocked).toBe(false);
    expect(assessment.classification).toBe("supported-financial");
    expect(assessment.analysisFamily).toBe("financial-institution");
    expect(assessment.label).toBe("Supported NBFC scope");
    expect(assessment.reasons.join(" ")).toContain("nbfc");
  });

  // ── Phase I — mixed-conglomerate routing override ──────────────────────

  /** Build a 4-period series that triggers material insurance + bank signals. */
  function mixedConglomerateFixture() {
    return Array.from({ length: 4 }, (_, i) => ({
      company_id: "ICICI_LIKE",
      period_end: `${2022 + i}-03-31`,
      raw_metric_values: {
        // Bank signals (material across 4 periods)
        "Cash and Balance with RBI__BalanceSheet": 50000 + i * 5000,
        "Money at Call and Short Notice__BalanceSheet": 12000 + i * 1000,
        "Borrowings from RBI__BalanceSheet": 8000 + i * 500,
        // Insurance signals (material across 4 periods → triggers mixed-conglomerate)
        "Investments of Life Insurance Business__BalanceSheet": 25000 + i * 2000,
        "Policy Holder's Investments (Insurance Business)__BalanceSheet": 15000 + i * 1500,
        "Premium Earned (Net)__ProfitLoss": 3000 + i * 200,
        // Industrial fillers
        "Total Assets__BalanceSheet": 200000 + i * 20000,
        "Total Equity__BalanceSheet": 30000 + i * 3000,
        "Profit After Tax__ProfitLoss": 5000 + i * 400,
      },
    }));
  }

  it("blocks mixed-financial-conglomerate by default (no override)", () => {
    const assessment = assessAnalysisScope(mixedConglomerateFixture());
    expect(assessment.blocked).toBe(true);
    expect(assessment.classification).toBe("mixed-financial-conglomerate");
    expect(assessment.recommendedAction).toContain("mixed_conglomerate_route_to");
  });

  it("routes to bank pipeline when override = 'bank' (ICICI Bank case)", () => {
    const assessment = assessAnalysisScope(mixedConglomerateFixture(), {
      financial_institution_mode: false,
      mixed_conglomerate_route_to: "bank",
    });
    expect(assessment.blocked).toBe(false);
    expect(assessment.classification).toBe("supported-financial");
    expect(assessment.analysisFamily).toBe("financial-institution");
    expect(assessment.label).toMatch(/routed to bank/);
    expect(assessment.reasons.some(r => r.includes("User override"))).toBe(true);
  });

  it("routes to industrial pipeline when override = 'industrial' (Reliance/Jio case)", () => {
    const assessment = assessAnalysisScope(mixedConglomerateFixture(), {
      financial_institution_mode: false,
      mixed_conglomerate_route_to: "industrial",
    });
    expect(assessment.blocked).toBe(false);
    expect(assessment.classification).toBe("supported-industrial");
    expect(assessment.analysisFamily).toBe("industrial");
    expect(assessment.label).toMatch(/industrial/);
    expect(assessment.reasons.some(r => r.includes("User override"))).toBe(true);
  });

  it("routes to NBFC pipeline when override = 'nbfc'", () => {
    const assessment = assessAnalysisScope(mixedConglomerateFixture(), {
      financial_institution_mode: false,
      mixed_conglomerate_route_to: "nbfc",
    });
    expect(assessment.blocked).toBe(false);
    expect(assessment.classification).toBe("supported-financial");
    expect(assessment.label).toMatch(/routed to nbfc/);
  });

  it("override is a no-op when there's no mixed-conglomerate signal", () => {
    // Pure industrial — override should not change anything
    const periods = [
      {
        company_id: "ITC_LIKE",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 100,
          "Total Equity__BalanceSheet": 60,
          "Revenue From Operations(Net)__ProfitLoss": 80,
          "Profit After Tax__ProfitLoss": 10,
        },
      },
    ];
    const assessment = assessAnalysisScope(periods, {
      financial_institution_mode: false,
      mixed_conglomerate_route_to: "bank",
    });
    expect(assessment.classification).toBe("supported-industrial");
    expect(assessment.blocked).toBe(false);
  });

  it("still blocks insurance-only datasets (no pipeline yet)", () => {
    const periods = [
      {
        company_id: "INSURANCE_CASE",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 500,
          "Total Equity__BalanceSheet": 80,
          "Profit After Tax__ProfitLoss": 15,
          "Profit Before Tax__ProfitLoss": 20,
          "Tax Expenses__ProfitLoss": 5,
          "Revenue From Operations(Net)__ProfitLoss": 100,
          "Finance Cost__ProfitLoss": 2,
          "Net Cash from Operating Activities__CashFlow": 30,
          "Purchased of Fixed Assets__CashFlow": -3,
          "Investments of Life Insurance Business__BalanceSheet": 350,
          "Premium Earned (Net)__ProfitLoss": 90,
          "Claims Expenses__ProfitLoss": 60,
        },
      },
    ];

    const assessment = assessAnalysisScope(periods);
    expect(assessment.blocked).toBe(true);
    expect(assessment.classification).toBe("unsupported-financial-company");
    expect(assessment.label).toBe("Unsupported insurance scope");
  });
});
