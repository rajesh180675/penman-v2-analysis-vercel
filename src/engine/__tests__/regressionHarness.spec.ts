import { describe, expect, it } from "vitest";
import { deriveKwFromStructure } from "../PenmanNissimEngine";
import { processCompanyData } from "../pipeline";
import { DEFAULT_CONFIG, EngineConfig, RawPeriodData } from "../types";
import { PercentFraction } from "../types/units";
import { runPhase0BaselineReport, runRegressionHarness } from "../regressionHarness";

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

const netCashSample: RawPeriodData[] = [
  {
    company_id: "NETCASH",
    period_end: "2024-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1300,
      "Total Equity__BalanceSheet": 900,
      "Minority Interest__BalanceSheet": 0,
      "Cash and Cash Equivalents__BalanceSheet": 240,
      "Current Investments__BalanceSheet": 240,
      "Other Current Financial Assets__BalanceSheet": 120,
      "Long Term Borrowings__BalanceSheet": 35,
      "Short Term Borrowings__BalanceSheet": 15,
      "Others Financial Liabilities - Short-term__BalanceSheet": 10,
      "Revenue From Operations(Net)__ProfitLoss": 980,
      "Profit Before Tax__ProfitLoss": 180,
      "Tax Expenses__ProfitLoss": 45,
      "Profit After Tax__ProfitLoss": 135,
      "Total Comprehensive Income for the Year__ProfitLoss": 136,
      "Finance Cost__ProfitLoss": 5,
      "Other Income__ProfitLoss": 30,
      "Net Cash from Operating Activities__CashFlow": 160,
      "Purchased of Fixed Assets__CashFlow": -55,
      "Dividend Paid__CashFlow": -25,
      "Interest Received__CashFlow": 6,
      "Dividend Received__CashFlow": 3,
    },
  },
  {
    company_id: "NETCASH",
    period_end: "2025-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1410,
      "Total Equity__BalanceSheet": 980,
      "Minority Interest__BalanceSheet": 0,
      "Cash and Cash Equivalents__BalanceSheet": 260,
      "Current Investments__BalanceSheet": 280,
      "Other Current Financial Assets__BalanceSheet": 130,
      "Long Term Borrowings__BalanceSheet": 30,
      "Short Term Borrowings__BalanceSheet": 14,
      "Others Financial Liabilities - Short-term__BalanceSheet": 9,
      "Revenue From Operations(Net)__ProfitLoss": 1080,
      "Profit Before Tax__ProfitLoss": 205,
      "Tax Expenses__ProfitLoss": 51,
      "Profit After Tax__ProfitLoss": 154,
      "Total Comprehensive Income for the Year__ProfitLoss": 156,
      "Finance Cost__ProfitLoss": 4.5,
      "Other Income__ProfitLoss": 34,
      "Net Cash from Operating Activities__CashFlow": 176,
      "Purchased of Fixed Assets__CashFlow": -58,
      "Dividend Paid__CashFlow": -28,
      "Interest Received__CashFlow": 6.5,
      "Dividend Received__CashFlow": 3.2,
    },
  },
];

describe("runRegressionHarness", () => {
  it("respects explicit config.ke instead of rf+erp", () => {
    const cfg: EngineConfig = {
      ...DEFAULT_CONFIG,
      risk_free_rate: 0.03,
      equity_risk_premium: 0.09,
      ke: PercentFraction(0.16),
    };
    const recast = processCompanyData(sample, cfg);
    const report = runRegressionHarness(sample, recast, cfg);
    expect(report).not.toBeNull();
    expect(report?.valuationDelta.ke).toBeCloseTo(0.16, 8);
  });

  it("builds a combined deterministic phase0 baseline report payload", () => {
    const recast = processCompanyData(sample, DEFAULT_CONFIG);
    const out = runPhase0BaselineReport(sample, recast, DEFAULT_CONFIG);
    expect(out).not.toBeNull();
    expect(out?.snapshot.phase).toBe("phase0-week1-baseline");
    expect(out?.snapshot.snapshotId).toMatch(/^fnv1a-/);
    expect(out?.regression.latestPeriod).toBe("2025-03-31");
  });

  it("keeps harness kw aligned with structural derivation for net-cash firms", () => {
    const cfg: EngineConfig = { ...DEFAULT_CONFIG, ke: PercentFraction(0.12), kd_pretax: 0.08, tax_rate_for_kd: 0.25 };
    const recast = processCompanyData(netCashSample, cfg);
    const report = runRegressionHarness(netCashSample, recast, cfg);
    expect(report).not.toBeNull();
    expect(recast.length).toBeGreaterThan(1);

    const prev = recast[recast.length - 2];
    const cur = recast[recast.length - 1];
    expect(cur.bs.NFO).toBeLessThan(0);

    const expectedKw = deriveKwFromStructure(cur, prev, cfg.ke, cfg.risk_free_rate, cfg);
    expect(report?.valuationDelta.kw_after).toBeCloseTo(expectedKw, 10);
    expect(report?.valuationDelta.kw_after).toBeGreaterThan(cfg.ke);
  });
});
