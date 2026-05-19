import { describe, expect, it } from "vitest";
import { processBankData, extractBankMetrics } from "../bankPipeline";
import { assessAnalysisScope } from "../scopePolicy";
import { computeBankValuation } from "../bankValuation";

describe("insurancePipeline", () => {
  const insurancePeriods = [
    {
      company_id: "LIC_INDIA",
      period_end: "2022-03-31",
      raw_metric_values: {
        "Total Assets__BalanceSheet": 4300000,
        "Total Shareholders Funds__BalanceSheet": 8000,
        "Life Assurance Fund__BalanceSheet": 4100000, // Policyholder funds
        "Premium Earned (Net)__ProfitLoss": 380000,
        "Claims Incurred__ProfitLoss": -250000,
        "Operating Expenses Related to Insurance Business__ProfitLoss": -55000,
        "Investment Income__ProfitLoss": 310000,
        "Profit After Tax__ProfitLoss": 32000,
        "Profit Before Tax__ProfitLoss": 33000,
      },
    },
    {
      company_id: "LIC_INDIA",
      period_end: "2023-03-31",
      raw_metric_values: {
        "Total Assets__BalanceSheet": 4700000,
        "Total Shareholders Funds__BalanceSheet": 10000,
        "Life Assurance Fund__BalanceSheet": 4500000, // Policyholder funds
        "Premium Earned (Net)__ProfitLoss": 420000,
        "Claims Incurred__ProfitLoss": -280000,
        "Operating Expenses Related to Insurance Business__ProfitLoss": -62000,
        "Investment Income__ProfitLoss": 350000,
        "Profit After Tax__ProfitLoss": 36000,
        "Profit Before Tax__ProfitLoss": 37000,
      },
    },
    {
      company_id: "LIC_INDIA",
      period_end: "2024-03-31",
      raw_metric_values: {
        "Total Assets__BalanceSheet": 5100000,
        "Total Shareholders Funds__BalanceSheet": 12000,
        "Life Assurance Fund__BalanceSheet": 4900000, // Policyholder funds
        "Premium Earned (Net)__ProfitLoss": 470000,
        "Claims Incurred__ProfitLoss": -320000,
        "Operating Expenses Related to Insurance Business__ProfitLoss": -70000,
        "Investment Income__ProfitLoss": 390000,
        "Profit After Tax__ProfitLoss": 40000,
        "Profit Before Tax__ProfitLoss": 41000,
      },
    },
    {
      company_id: "LIC_INDIA",
      period_end: "2025-03-31",
      raw_metric_values: {
        "Total Assets__BalanceSheet": 5500000,
        "Total Shareholders Funds__BalanceSheet": 15000,
        "Life Assurance Fund__BalanceSheet": 5300000, // Policyholder funds
        "Premium Earned (Net)__ProfitLoss": 520000,
        "Claims Incurred__ProfitLoss": -350000,
        "Operating Expenses Related to Insurance Business__ProfitLoss": -78000,
        "Investment Income__ProfitLoss": 420000,
        "Profit After Tax__ProfitLoss": 44000,
        "Profit Before Tax__ProfitLoss": 45000,
      },
    },
  ];

  it("classifies insurance company scope properly", () => {
    // LIC is supported now!
    const scope = assessAnalysisScope(insurancePeriods);
    expect(scope.classification).toBe("supported-financial");
    expect(scope.blocked).toBe(false);
    expect(scope.label).toBe("Supported insurance scope");
  });

  it("extracts insurance raw fields from period data", () => {
    const metrics = extractBankMetrics(insurancePeriods[3]);
    expect(metrics.totalAssets).toBe(5500000);
    expect(metrics.totalEquity).toBe(15000);
    expect(metrics.policyholderFunds).toBe(5300000);
    expect(metrics.premiumEarned).toBe(520000);
    expect(metrics.claimsExpense).toBe(-350000);
    expect(metrics.investmentIncome).toBe(420000);
    expect(metrics.pat).toBe(44000);
  });

  it("computes correct Tier-1 insurance ratios", () => {
    const scope = assessAnalysisScope(insurancePeriods);
    const result = processBankData(insurancePeriods, scope);

    expect(result.subtype).toBe("insurance");
    expect(result.periods).toHaveLength(4);

    const latest = result.bankMetrics![3];
    
    // Claims ratio: claimsIncurred / premiumEarned = 350000 / 520000 = 67.3%
    expect(latest.claimsRatio).toBeCloseTo(350000 / 520000, 4);

    // Expense ratio: opEx / premiumEarned = 78000 / 520000 = 15.0%
    expect(latest.expenseRatio).toBeCloseTo(78000 / 520000, 4);

    // Combined ratio: Claims + Expense = 67.3% + 15.0% = 82.3%
    expect(latest.combinedRatio).toBeCloseTo((350000 + 78000) / 520000, 4);

    // Float to Equity: 5300000 / 15000 = 353.3x
    expect(latest.floatToEquity).toBeCloseTo(5300000 / 15000, 4);

    // Premium growth YoY: (520000 - 470000) / 470000 = 10.6%
    expect(latest.premiumGrowth).toBeCloseTo(50000 / 470000, 4);

    // Investment yield: 420000 / avg(5300000, 4900000) = 420000 / 5100000 = 8.23%
    expect(latest.investmentYield).toBeCloseTo(420000 / 5100000, 4);
  });

  it("applies 0.7x Gordon P/B floor and computes EV valuation for insurance", () => {
    const scope = assessAnalysisScope(insurancePeriods);
    
    const quality = {
      schema_version: "2026-05-bank-quality-v1",
      company_name: "LIC",
      as_of_date: "2025-03-31",
      periods: [
        {
          period_end: "2025-03-31",
          solvency_ratio: 1.85,
          embedded_value: 95000, // 95k Cr
          vnb: 9500, // 9.5k Cr
        },
      ],
    };

    const result = processBankData(insurancePeriods, scope, undefined, 450000, quality);
    const metrics = result.bankMetrics!;
    
    const cfg = {
      ke: 0.14, // ke = 14%
      risk_free_rate: 0.07,
      equity_risk_premium: 0.07,
      terminal_growth_rate: 0.05, // g = 5%
    };

    const val = computeBankValuation(metrics, cfg as any, 450000, null, true);

    // Check Justified P/B Gordon is computed
    expect(val.justifiedPB.status).toBe("computed");
    
    // Check EV Based valuation
    // EV + VNB * 12 = 95000 + 9500 * 12 = 95000 + 114000 = 209000
    expect(val.evBased?.status).toBe("computed");
    expect(val.evBased?.intrinsicValue).toBe(209000);
  });
});
