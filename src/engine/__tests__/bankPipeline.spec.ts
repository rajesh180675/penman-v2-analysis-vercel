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
    const metrics = extractBankMetrics(bankPeriods[1]!);
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
    expect(result.periods[1]!.bookValue).toBe(430000);
    expect(result.periods[1]!.earnings).toBe(62000);
    expect(result.periods[1]!.deposits).toBe(2700000);
    expect(result.periods[1]!.advances).toBe(2900000);
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

  it("joins Phase B5 quality indicators by period_end", () => {
    const scope = assessAnalysisScope(bankPeriods);
    const quality = {
      schema_version: "2026-05-bank-quality-v1",
      company_name: "HDFC Bank Ltd",
      as_of_date: "2025-03-31",
      periods: [
        {
          period_end: "2025-03-31",
          fiscal_label: "FY25",
          gnpa_pct: 1.33,
          nnpa_pct: 0.43,
          pcr_pct: 67.92,
          crar_pct: 19.6,
          tier1_pct: 17.69,
          casa_pct: 34.36,
          source_doc: "HDFCBANK_AR_FY2025.pdf",
          source_page: 198,
        },
        // FY24 deliberately absent — verify periods without a match stay null
      ],
    };
    const result = processBankData(bankPeriods, scope, undefined, null, quality);
    expect(result.bankMetrics).toBeDefined();
    const fy25 = result.bankMetrics!.find((m) => m.period_end === "2025-03-31");
    const fy24 = result.bankMetrics!.find((m) => m.period_end === "2024-03-31");
    expect(fy25?.quality?.gnpa_pct).toBe(1.33);
    expect(fy25?.quality?.crar_pct).toBe(19.6);
    expect(fy24?.quality).toBeNull();
  });

  it("converts the sidecar's CASA percent to a fraction on the way in", () => {
    // `casa_pct` is a percent — bankQualityIndicators validates it to [0, 100].
    // `casaRatio` is a fraction — metrics.ts computes casaDeposits / deposits.
    // The join used to assign across without dividing, so 34.36 landed in a
    // field the "CASA ≤ Total Deposits" reconciliation check reads as 3436%.
    // That failed the check for every sidecar-backed period and blamed it on a
    // parse error. The cost_to_income_pct branch beside it has always divided.
    const scope = assessAnalysisScope(bankPeriods);
    const quality = {
      schema_version: "2026-05-bank-quality-v1",
      company_name: "HDFC Bank Ltd",
      as_of_date: "2025-03-31",
      periods: [
        { period_end: "2025-03-31", fiscal_label: "FY25", casa_pct: 34.36, cost_to_income_pct: 40.5 },
      ],
    };
    const result = processBankData(bankPeriods, scope, undefined, null, quality);
    const fy25 = result.bankMetrics!.find((m) => m.period_end === "2025-03-31");

    expect(fy25?.casaRatio).toBeCloseTo(0.3436, 6);
    // Sibling field, same block — pinned so the two stay in the same unit.
    expect(fy25?.costToIncome).toBeCloseTo(0.405, 6);
    // The raw sidecar record keeps its own percent units untouched.
    expect(fy25?.quality?.casa_pct).toBe(34.36);
  });

  it("leaves quality null when no sidecar provided (back-compat)", () => {
    const scope = assessAnalysisScope(bankPeriods);
    const result = processBankData(bankPeriods, scope);
    for (const m of result.bankMetrics ?? []) {
      expect(m.quality).toBeNull();
    }
  });

  // F1: NIM, ROA, ROE, creditCost within expected ranges for a well-formed bank dataset.
  // Catches regressions in ratio computation (denominator bugs, sign errors, etc.)
  it("NIM, ROA, ROE, creditCost are within expected ranges (F1 audit finding)", () => {
    const scope = assessAnalysisScope(bankPeriods);
    const result = processBankData(bankPeriods, scope);
    const fy25 = result.bankMetrics?.find((m) => m.period_end === "2025-03-31");
    expect(fy25).toBeDefined();

    // NIM = NII / (Advances + Investments) = 130000 / 3680000 ≈ 3.53%
    // Valid range for a large Indian private bank: 2.5%–5.5%
    expect(fy25!.nim).not.toBeNull();
    expect(fy25!.nim!).toBeGreaterThan(0.025);
    expect(fy25!.nim!).toBeLessThan(0.055);

    // ROA = PAT / avg(TotalAssets) = 62000 / 3898000 ≈ 1.59%
    // Valid range: 0.5%–3.0%
    expect(fy25!.roa).not.toBeNull();
    expect(fy25!.roa!).toBeGreaterThan(0.005);
    expect(fy25!.roa!).toBeLessThan(0.030);

    // ROE = PAT / avg(Equity) = 62000 / 405000 ≈ 15.3%
    // Valid range: 5%–30%
    expect(fy25!.roe).not.toBeNull();
    expect(fy25!.roe!).toBeGreaterThan(0.05);
    expect(fy25!.roe!).toBeLessThan(0.30);

    // creditCost = Provisions / avg(Advances) = 22000 / 2690000 ≈ 0.82%
    // Valid range: 0%–5%
    expect(fy25!.creditCost).not.toBeNull();
    expect(fy25!.creditCost!).toBeGreaterThanOrEqual(0);
    expect(fy25!.creditCost!).toBeLessThan(0.05);

    // costToIncome = OpEx / (NII + OtherIncome) = 65000 / 178000 ≈ 36.5%
    // Valid range: 20%–70%
    expect(fy25!.costToIncome).not.toBeNull();
    expect(fy25!.costToIncome!).toBeGreaterThan(0.20);
    expect(fy25!.costToIncome!).toBeLessThan(0.70);
  });
});
