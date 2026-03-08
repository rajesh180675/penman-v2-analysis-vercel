import { describe, expect, it } from "vitest";
import { processCompanyData } from "../pipeline";
import { DEFAULT_CONFIG, EngineConfig, RawPeriodData } from "../types";
import { runRegressionHarness } from "../regressionHarness";

const sample: RawPeriodData[] = [
  {
    company_id: "KECHECK",
    period_end: "2024-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000,
      "Total Equity__BalanceSheet": 600,
      "Minority Interest__BalanceSheet": 0,
      "Cash and Cash Equivalents__BalanceSheet": 100,
      "Current Investments__BalanceSheet": 120,
      "Long Term Borrowings__BalanceSheet": 80,
      "Short Term Borrowings__BalanceSheet": 20,
      "Others Financial Liabilities - Short-term__BalanceSheet": 10,
      "Revenue From Operations(Net)__ProfitLoss": 900,
      "Profit Before Tax__ProfitLoss": 140,
      "Tax Expenses__ProfitLoss": 35,
      "Profit After Tax__ProfitLoss": 105,
      "Total Comprehensive Income for the Year__ProfitLoss": 108,
      "Finance Cost__ProfitLoss": 8,
      "Other Income__ProfitLoss": 15,
      "Net Cash from Operating Activities__CashFlow": 130,
      "Purchased of Fixed Assets__CashFlow": -45,
      "Dividend Paid__CashFlow": -20,
      "Interest Received__CashFlow": 2,
      "Dividend Received__CashFlow": 1,
    },
  },
  {
    company_id: "KECHECK",
    period_end: "2025-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1080,
      "Total Equity__BalanceSheet": 660,
      "Minority Interest__BalanceSheet": 0,
      "Cash and Cash Equivalents__BalanceSheet": 120,
      "Current Investments__BalanceSheet": 130,
      "Long Term Borrowings__BalanceSheet": 70,
      "Short Term Borrowings__BalanceSheet": 20,
      "Others Financial Liabilities - Short-term__BalanceSheet": 15,
      "Revenue From Operations(Net)__ProfitLoss": 980,
      "Profit Before Tax__ProfitLoss": 155,
      "Tax Expenses__ProfitLoss": 39,
      "Profit After Tax__ProfitLoss": 116,
      "Total Comprehensive Income for the Year__ProfitLoss": 118,
      "Finance Cost__ProfitLoss": 7,
      "Other Income__ProfitLoss": 14,
      "Net Cash from Operating Activities__CashFlow": 145,
      "Purchased of Fixed Assets__CashFlow": -50,
      "Dividend Paid__CashFlow": -22,
      "Interest Received__CashFlow": 2,
      "Dividend Received__CashFlow": 1,
    },
  },
];

describe("runRegressionHarness", () => {
  it("respects explicit config.ke instead of rf+erp", () => {
    const cfg: EngineConfig = {
      ...DEFAULT_CONFIG,
      risk_free_rate: 0.03,
      equity_risk_premium: 0.09,
      ke: 0.16,
    };
    const recast = processCompanyData(sample, cfg);
    const report = runRegressionHarness(sample, recast, cfg);
    expect(report).not.toBeNull();
    expect(report?.valuationDelta.ke).toBeCloseTo(0.16, 8);
  });
});
