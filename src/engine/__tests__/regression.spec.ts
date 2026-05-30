import { describe, expect, it } from "vitest";
import { processCompanyData } from "../pipeline";
import { DEFAULT_CONFIG, RawPeriodData } from "../types";

const sample: RawPeriodData[] = [
  {
    company_id: "GOLDEN",
    period_end: "2024-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000,
      "Total Stockholders' Equity__BalanceSheet": 600,
      "Total Equity__BalanceSheet": 600,
      "Minority Interest__BalanceSheet": 0,
      "Cash and Cash Equivalents__BalanceSheet": 100,
      "Current Investments__BalanceSheet": 120,
      "Long Term Borrowings__BalanceSheet": 80,
      "Short Term Borrowings__BalanceSheet": 20,
      "Others Financial Liabilities - Short-term__BalanceSheet": 10,
      "Trade Payables__BalanceSheet": 120,
      "Other Current Liabilities__BalanceSheet": 90,
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
    company_id: "GOLDEN",
    period_end: "2025-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1080,
      "Total Stockholders' Equity__BalanceSheet": 660,
      "Total Equity__BalanceSheet": 660,
      "Minority Interest__BalanceSheet": 0,
      "Cash and Cash Equivalents__BalanceSheet": 120,
      "Current Investments__BalanceSheet": 130,
      "Long Term Borrowings__BalanceSheet": 70,
      "Short Term Borrowings__BalanceSheet": 20,
      "Others Financial Liabilities - Short-term__BalanceSheet": 15,
      "Trade Payables__BalanceSheet": 130,
      "Other Current Liabilities__BalanceSheet": 95,
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

describe("golden master regression", () => {
  it("keeps stable high-level outputs for baseline sample", () => {
    const out = processCompanyData(sample, DEFAULT_CONFIG);
    expect(out.length).toBe(2);
    const latest = out[1]!;
    expect(latest.bs.TA).toBe(1080);
    expect(Math.round((latest.ratios?.ROCE ?? 0) * 1000) / 1000).toBeGreaterThan(0);
    expect(Math.round((latest.ratios?.RNOA ?? 0) * 1000) / 1000).toBeGreaterThan(0);
  });

  it("preserves negative common equity instead of clamping it to zero", () => {
    const distressed: RawPeriodData[] = [
      {
        company_id: "DISTRESSED",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 500,
          "Total Equity__BalanceSheet": 20,
          "Minority Interest__BalanceSheet": 60,
          "Cash and Cash Equivalents__BalanceSheet": 20,
          "Long Term Borrowings__BalanceSheet": 180,
          "Short Term Borrowings__BalanceSheet": 120,
          "Trade Payables__BalanceSheet": 90,
          "Other Current Liabilities__BalanceSheet": 70,
          "Revenue From Operations(Net)__ProfitLoss": 300,
          "Profit Before Tax__ProfitLoss": -25,
          "Tax Expenses__ProfitLoss": 0,
          "Profit After Tax__ProfitLoss": -25,
          "Total Comprehensive Income for the Year__ProfitLoss": -25,
          "Finance Cost__ProfitLoss": 22,
          "Net Cash from Operating Activities__CashFlow": 15,
          "Purchased of Fixed Assets__CashFlow": -10,
          "Dividend Paid__CashFlow": 0,
        },
      },
    ];

    const out = processCompanyData(distressed, DEFAULT_CONFIG);
    expect(out).toHaveLength(1);
    expect(out[0]!.bs.CSE).toBe(-40);
  });
});
