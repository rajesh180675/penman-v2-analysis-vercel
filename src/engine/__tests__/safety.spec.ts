import { describe, expect, it } from "vitest";
import { evaluateQualityGate } from "../mappingAudit";
import { computeValuation } from "../PenmanNissimEngine";
import { DEFAULT_CONFIG, RawPeriodData } from "../types";

describe("fail-fast safety guards", () => {
  it("blocks valuation when critical keys are unresolved", () => {
    const periods: RawPeriodData[] = [
      {
        company_id: "TST",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 1000,
          "Total Stockholders' Equity__BalanceSheet": 400,
          "Profit After Tax__ProfitLoss": 100,
          "Revenue From Operations(Net)__ProfitLoss": 800,
          "Net Cash from Operating Activities__CashFlow": 150,
          "Purchased of Fixed Assets__CashFlow": 60,
          "Finance Cost__ProfitLoss": 20,
        },
      },
    ];

    const report = evaluateQualityGate(periods);
    expect(report.tier).toBe("Tier 3");
    expect(report.valuationBlocked).toBe(true);
    expect(report.blockingReasons.some((r) => r.includes("Critical key gaps"))).toBe(true);
  });

  it("throws clearly when valuation is called with zero periods", () => {
    expect(() => computeValuation([], 0.13, 0.1, 0.04, DEFAULT_CONFIG)).toThrow(
      "computeValuation requires at least one period."
    );
  });
});
