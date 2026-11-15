/**
 * HDFC Bank, ICICI, Kotak and SBI file their investments only as a schedule:
 * government securities, debentures and bonds, other current investments and
 * so on, closed by a row Capitaline labels just "Total". With no
 * "Investments" line, earning assets (advances + investments) were missing and
 * none of the four had a NIM. The schedule's total is read beside its own
 * component lines, never below their sum, and only for a bank's NIM.
 */
import { describe, expect, it } from "vitest";
import { computeBankRatios, extractBankMetrics } from "../bankPipeline";

const extract = (periodEnd: string, lines: Record<string, number>) =>
  extractBankMetrics({ company_id: "BANK", period_end: periodEnd, raw_metric_values: lines });

// HDFC Bank FY2025 as filed (₹ crore).
const hdfc2025 = {
  "Advances :__BalanceSheet": 2724938.16,
  "Investments in Government or Trust securities__BalanceSheet": 775264.24,
  "Investments in Debentures or Bonds__BalanceSheet": 38285.78,
  "Other Current Investments__BalanceSheet": 362205.16,
  "Total__BalanceSheet": 1186472.89,
};

describe("a bank's investments schedule total", () => {
  it("is read beside the schedule's component lines (HDFC Bank FY2025)", () => {
    const m = extract("2025-03-31", hdfc2025);
    expect(m.investments).toBeNull();
    expect(m.investmentScheduleTotal).toBe(1186472.89);
  });

  it("is not read where no component line is filed (Shriram FY2011)", () => {
    expect(extract("2011-03-31", { "Total__BalanceSheet": 3254 }).investmentScheduleTotal).toBeNull();
  });

  it("is not read below the sum of its components", () => {
    const m = extract("2025-03-31", { ...hdfc2025, "Total__BalanceSheet": 1000000 });
    expect(m.investmentScheduleTotal).toBeNull();
  });

  it("gives way to a filed investments line", () => {
    const m = extract("2025-03-31", { ...hdfc2025, "Investments__BalanceSheet": 1190000 });
    expect(m.investments).toBe(1190000);
    expect(m.investmentScheduleTotal).toBeNull();
  });

  it("completes a bank's earning assets, and an NBFC's NIM stays on advances alone", () => {
    const prev = extract("2024-03-31", { ...hdfc2025, "Advances :__BalanceSheet": 2500000, "Total__BalanceSheet": 1180000 });
    const cur = { ...extract("2025-03-31", hdfc2025), nii: 152473.23 };
    const earningAssets = (2724938.16 + 1186472.89 + 2500000 + 1180000) / 2;
    expect(computeBankRatios(cur, prev, "bank").nim).toBeCloseTo(152473.23 / earningAssets, 12);
    expect(computeBankRatios(cur, prev, "nbfc").nim).toBeCloseTo(152473.23 / ((2724938.16 + 2500000) / 2), 12);
  });
});
