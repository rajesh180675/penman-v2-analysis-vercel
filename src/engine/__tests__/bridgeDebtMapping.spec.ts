import { describe, expect, it } from "vitest";
import asianPaintsAuditedFixture from "../__fixtures__/asian-paints-capitaline-audited.json";
import itcAuditedFixture from "../__fixtures__/itc-capitaline-audited.json";
import { processCompanyData } from "../pipeline";
import { DEFAULT_CONFIG, RawPeriodData, RecastPeriod } from "../types";

function traceKeys(period: RecastPeriod, line: string) {
  return (period.trace?.[line] ?? [])
    .filter((entry) => entry.statement !== "Derived" && entry.note !== "unmatched" && !entry.note?.startsWith("duplicate_source_ignored:"))
    .map((entry) => entry.key);
}

const currentMaturityIssuer: RawPeriodData[] = [
  {
    company_id: "CURRENT_MATURITY_ISSUER",
    period_end: "2024-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000,
      "Total Stockholders' Equity__BalanceSheet": 600,
      "Total Equity__BalanceSheet": 600,
      "Minority Interest__BalanceSheet": 0,
      "Cash and Cash Equivalents__BalanceSheet": 100,
      "Current Investments__BalanceSheet": 50,
      "Trade Payables__BalanceSheet": 120,
      "Other Current Liabilities__BalanceSheet": 90,
      "Property, Plant and Equipment__BalanceSheet": 320,
      "Long Term Borrowings__BalanceSheet": 90,
      "Short Term Borrowings__BalanceSheet": 25,
      "Total Current Maturities of Long-term Borrowings__BalanceSheet": 30,
      "Debentures / Bonds Quoted__BalanceSheet": 70,
      "Lease Liabilities__BalanceSheet": 40,
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
      "Proceed from Issue of Debentures__CashFlow": 15,
      "On Redemption of Debenture__CashFlow": -10,
      "Of financial Liabilities__CashFlow": -25,
    },
  },
  {
    company_id: "CURRENT_MATURITY_ISSUER",
    period_end: "2025-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1080,
      "Total Stockholders' Equity__BalanceSheet": 655,
      "Total Equity__BalanceSheet": 655,
      "Minority Interest__BalanceSheet": 0,
      "Cash and Cash Equivalents__BalanceSheet": 120,
      "Current Investments__BalanceSheet": 55,
      "Trade Payables__BalanceSheet": 125,
      "Other Current Liabilities__BalanceSheet": 90,
      "Property, Plant and Equipment__BalanceSheet": 340,
      "Long Term Borrowings__BalanceSheet": 80,
      "Short Term Borrowings__BalanceSheet": 20,
      "Total Current Maturities of Long-term Borrowings__BalanceSheet": 20,
      "Debentures / Bonds Quoted__BalanceSheet": 75,
      "Lease Liabilities__BalanceSheet": 44,
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
      "Proceed from Issue of Debentures__CashFlow": 10,
      "On Redemption of Debenture__CashFlow": -5,
      "Of financial Liabilities__CashFlow": -30,
    },
  },
];

describe("bridge debt mapping", () => {
  it("excludes generic financial-liability repayments from the bridge CF line for ITC", () => {
    const periods = processCompanyData((itcAuditedFixture as { rawData: RawPeriodData[] }).rawData, DEFAULT_CONFIG);
    const latest = periods.find((period) => period.period_end === "2023-03-31")!;

    expect(traceKeys(latest, "CF.BridgeDebtRepayment")).not.toContain("Of financial Liabilities");
    expect(traceKeys(latest, "CF.BridgeDebtRepayment")).toContain("Of the Long Tem Borrowings");
  }, 20000);

  it("captures debentures and current maturities in the bridge debt total while excluding leases", () => {
    const periods = processCompanyData(currentMaturityIssuer, DEFAULT_CONFIG);
    const latest = periods[periods.length - 1];

    expect(traceKeys(latest, "BS.BridgeDebt.Debentures")).toContain("Debentures / Bonds Quoted");
    expect(traceKeys(latest, "BS.BridgeDebt.CurrentMaturities")).toContain("Total Current Maturities of Long-term Borrowings");
    expect(traceKeys(latest, "BS.BridgeDebt.Total")).not.toContain("Lease Liabilities");
  });

  it("creates the dedicated bridge-debt trace lines on another real-company fixture", () => {
    const periods = processCompanyData(asianPaintsAuditedFixture.rawData as RawPeriodData[], DEFAULT_CONFIG);
    const latest = periods[periods.length - 1];

    expect(latest.trace?.["BS.BridgeDebt.Total"]?.length).toBeGreaterThan(0);
    expect(latest.trace?.["CF.BridgeDebtProceeds"]?.length).toBeGreaterThan(0);
    expect(latest.trace?.["CF.BridgeDebtRepayment"]?.length).toBeGreaterThan(0);
  }, 20000);
});
