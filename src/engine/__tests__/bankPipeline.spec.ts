import { describe, expect, it } from "vitest";
import { processBankData, extractBankMetrics } from "../bankPipeline";
import { assessAnalysisScope } from "../scopePolicy";

describe("bankPipeline", () => {
  const bankPeriods = [
    {
      company_id: "HDFC_BANK",
      period_end: "2024-03-31",
      raw_metric_values: {
        "Total Assets__BalanceSheet": 3596000,
        "Total Shareholders Funds__BalanceSheet": 380000,
        "Advances__BalanceSheet": 2480000,
        "Deposits__BalanceSheet": 2310000,
        "Investments__BalanceSheet": 680000,
        "Borrowings__BalanceSheet": 180000,
        "Cash and Balance with RBI__BalanceSheet": 126000,
        "Interest Earned__ProfitLoss": 248000,
        "Interest Expended__ProfitLoss": -138000,
        "Other Income__ProfitLoss": 42000,
        "Operating Expenses__ProfitLoss": -58000,
        "Provisions and Contingencies__ProfitLoss": -18000,
        "Profit After Tax__ProfitLoss": 52000,
        "Profit Before Tax__ProfitLoss": 68000,
      },
    },
    {
      company_id: "HDFC_BANK",
      period_end: "2025-03-31",
      raw_metric_values: {
        "Total Assets__BalanceSheet": 4200000,
        "Total Shareholders Funds__BalanceSheet": 430000,
        "Advances__BalanceSheet": 2900000,
        "Deposits__BalanceSheet": 2700000,
        "Investments__BalanceSheet": 780000,
        "Borrowings__BalanceSheet": 200000,
        "Cash and Balance with RBI__BalanceSheet": 140000,
        "Interest Earned__ProfitLoss": 295000,
        "Interest Expended__ProfitLoss": -165000,
        "Other Income__ProfitLoss": 48000,
        "Operating Expenses__ProfitLoss": -65000,
        "Provisions and Contingencies__ProfitLoss": -22000,
        "Profit After Tax__ProfitLoss": 62000,
        "Profit Before Tax__ProfitLoss": 82000,
      },
    },
  ];

  it("extracts bank metrics from raw period data", () => {
    const metrics = extractBankMetrics(bankPeriods[1]);
    expect(metrics.totalAssets).toBe(4200000);
    expect(metrics.advances).toBe(2900000);
    expect(metrics.deposits).toBe(2700000);
    expect(metrics.interestEarned).toBe(295000);
    expect(metrics.nii).toBe(295000 - 165000); // 130000
    expect(metrics.pat).toBe(62000);
  });

  it("computes bank ratios with previous period", () => {
    const scope = assessAnalysisScope(bankPeriods);
    const result = processBankData(bankPeriods, scope);

    expect(result.family).toBe("financial-institution");
    expect(result.subtype).toBe("bank");
    expect(result.periods).toHaveLength(2);

    // Second period should have ratios
    expect(result.periods[1].bookValue).toBe(430000);
    expect(result.periods[1].earnings).toBe(62000);
    expect(result.periods[1].deposits).toBe(2700000);
    expect(result.periods[1].advances).toBe(2900000);
  });

  it("detects bank subtype from scope signals", () => {
    const scope = assessAnalysisScope(bankPeriods);
    expect(scope.classification).toBe("supported-financial");
    expect(scope.blocked).toBe(false);
    expect(scope.label).toBe("Supported banking scope");
  });

  it("handles empty data gracefully", () => {
    const scope = assessAnalysisScope([]);
    const result = processBankData([], scope);
    expect(result.family).toBe("financial-institution");
    expect(result.periods).toHaveLength(0);
  });
});
