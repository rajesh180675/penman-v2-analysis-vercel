import { describe, expect, it } from "vitest";
import { auditMappingCoverage, evaluateQualityGate } from "../mappingAudit";
import { RawPeriodData } from "../types";

describe("mapping coverage tiers", () => {
  it("distinguishes valuation-critical gaps from optional detail gaps", () => {
    const periods: RawPeriodData[] = [
      {
        company_id: "TIERTEST",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 1000,
          "Total Equity__BalanceSheet": 600,
          "Cash and Cash Equivalents__BalanceSheet": 120,
          "Current Investments__BalanceSheet": 90,
          "Long Term Borrowings__BalanceSheet": 40,
          "Short Term Borrowings__BalanceSheet": 10,
          "Revenue From Operations(Net)__ProfitLoss": 850,
          "Profit Before Tax__ProfitLoss": 130,
          "Tax Expenses__ProfitLoss": 32,
          "Profit After Tax__ProfitLoss": 98,
          "Finance Cost__ProfitLoss": 7,
          "Net Cash from Operating Activities__CashFlow": 145,
          "Purchased of Fixed Assets__CashFlow": -42,
        },
      },
    ];

    const audit = auditMappingCoverage(periods);
    const gate = evaluateQualityGate(periods);

    expect(audit.coverageSummary.unresolvedBySeverity.critical).toHaveLength(0);
    expect(audit.coverageSummary.unresolvedBySeverity.warning.length).toBeGreaterThan(0);
    expect(gate.valuationBlocked).toBe(false);
    expect(gate.ratioCriticalGaps.length).toBeGreaterThan(0);
  });

  it("surfaces missing valuation-critical groups as blocking reasons", () => {
    const periods: RawPeriodData[] = [
      {
        company_id: "TIERBLOCK",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 1000,
          "Total Equity__BalanceSheet": 600,
          "Revenue From Operations(Net)__ProfitLoss": 850,
          "Profit Before Tax__ProfitLoss": 130,
          "Tax Expenses__ProfitLoss": 32,
          "Profit After Tax__ProfitLoss": 98,
          "Net Cash from Operating Activities__CashFlow": 145,
          "Purchased of Fixed Assets__CashFlow": -42,
        },
      },
    ];

    const gate = evaluateQualityGate(periods);

    expect(gate.valuationBlocked).toBe(true);
    expect(gate.blockingReasons.some((reason) => reason.includes("Valuation-critical coverage gaps"))).toBe(true);
  });

  it("triages out-of-spec labels into actionable and ignored backlog buckets", () => {
    const periods: RawPeriodData[] = [
      {
        company_id: "BACKLOG",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 1000,
          "Total Equity__BalanceSheet": 600,
          "Cash and Cash Equivalents__BalanceSheet": 120,
          "Current Investments__BalanceSheet": 90,
          "Long Term Borrowings__BalanceSheet": 40,
          "Short Term Borrowings__BalanceSheet": 10,
          "Sundry Creditors__BalanceSheet": 65,
          "Revenue From Operations(Net)__ProfitLoss": 850,
          "Total Interest Expenses__ProfitLoss": 7,
          "Profit Before Tax__ProfitLoss": 130,
          "Tax Expenses__ProfitLoss": 32,
          "Profit After Tax__ProfitLoss": 98,
          "Number of Equity Shares - Issued__BalanceSheet": 1000000,
          "Net Cash from Operating Activities__CashFlow": 145,
          "Purchased of Fixed Assets__CashFlow": -42,
        },
      },
    ];

    const audit = auditMappingCoverage(periods);

    expect(audit.outOfSpecLabels.some((entry) => entry.key === "Total Interest Expenses")).toBe(false);
    expect(audit.outOfSpecLabels.some((entry) => entry.key === "Sundry Creditors")).toBe(false);
    expect(audit.backlogSummary.totalsByAction["ignore-non-core"]).toBe(1);
    expect(audit.backlogSummary.actionableCount).toBe(0);
  });
});
