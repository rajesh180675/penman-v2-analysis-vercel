import { describe, expect, it } from "vitest";
import { processCompanyData } from "../pipeline";
import { DEFAULT_CONFIG, RawPeriodData } from "../types";
import { buildPhase0BaselineSnapshot, computePhase0Guardrails, PHASE0_BENCHMARK_SET } from "../baselineGuardrails";

const sample: RawPeriodData[] = [
  {
    company_id: "ITC",
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
      "Property, Plant and Equipment__BalanceSheet": 250,
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
    company_id: "ITC",
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
      "Property, Plant and Equipment__BalanceSheet": 270,
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

describe("phase 0 baseline guardrails", () => {
  it("computes guardrail metrics with sane ranges", () => {
    const periods = processCompanyData(sample, DEFAULT_CONFIG);
    const kpis = computePhase0Guardrails(periods, DEFAULT_CONFIG);
    expect(kpis).not.toBeNull();
    expect(kpis!.identityGapPct).toBeGreaterThanOrEqual(0);
    expect(kpis!.terminalAnchorStabilityPct).toBeGreaterThanOrEqual(0);
    expect(kpis!.valuationErrorBand.valueHigh).toBeGreaterThanOrEqual(kpis!.valuationErrorBand.valueLow);
  });

  it("builds deterministic snapshot ids for same inputs", () => {
    const periods = processCompanyData(sample, DEFAULT_CONFIG);
    const s1 = buildPhase0BaselineSnapshot("ITC", periods, DEFAULT_CONFIG);
    const s2 = buildPhase0BaselineSnapshot("ITC", periods, DEFAULT_CONFIG);
    expect(s1).not.toBeNull();
    expect(s1?.snapshotId).toBe(s2?.snapshotId);
    expect(s1?.benchmarkUniverse.length).toBe(6);
    expect(PHASE0_BENCHMARK_SET[0].id).toBe("ITC");
  });
});
