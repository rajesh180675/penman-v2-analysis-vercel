import { describe, expect, it } from "vitest";
import { assessAnalysisScope } from "../scopePolicy";
import { evaluateQualityGate } from "../mappingAudit";

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

  it("blocks financial-company datasets when banking signals carry value", () => {
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
    expect(assessment.blocked).toBe(true);
    expect(assessment.classification).toBe("unsupported-financial-company");

    const qualityGate = evaluateQualityGate(periods);
    expect(qualityGate.valuationBlocked).toBe(true);
    expect(qualityGate.scopeAssessment.blocked).toBe(true);
    expect(qualityGate.blockingReasons.join(" ")).toContain("nbfc");
  });
});
