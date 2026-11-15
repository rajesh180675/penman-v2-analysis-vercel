/**
 * The parser keeps every line it places in a statement under its bare label
 * too, so a bare key is not a line the parser failed to classify whenever a
 * statement files that label. The bank pipeline read the bare key as a
 * fallback for any field its own statement did not file, and every financial
 * in the library took P&L and balance-sheet figures from the cash flow:
 * provisions from its "Prov. & W/O (Net)" add-back (all ten), investment income
 * from its "Investment Income" adjustment (all ten), and SBI's, Bajaj Finance's
 * and Muthoot Finance's balance-sheet investments from its "Investments", the
 * year's purchases (SBI FY2025: −₹81,890.97 Cr).
 */
import { describe, expect, it } from "vitest";
import { extractBankMetrics } from "../bankPipeline";

const extract = (lines: Record<string, number | null>) =>
  extractBankMetrics({ company_id: "BANK", period_end: "2025-03-31", raw_metric_values: lines as Record<string, number> });

describe("a field reads only its own statement", () => {
  it("leaves the balance sheet's investments empty when only the cash flow files the label (SBI FY2025)", () => {
    const m = extract({
      "Advances :__BalanceSheet": 4250830.74,
      "Investments__CashFlow": -81890.97,
      Investments: -81890.97,
    });
    expect(m.investments).toBeNull();
  });

  it("reads provisions from the cash flow's add-back on purpose, ahead of the P&L's components (HDFC Bank FY2025)", () => {
    // The P&L files only a component; the loan-loss charge is in the add-back.
    const m = extract({
      "Prov. & W/O (Net)__CashFlow": 16347.73,
      "Prov. & W/O (Net)": 16347.73,
      "Other Provisions and Write-offs__ProfitLoss": -1520.59,
    });
    expect(m.provisions).toBe(16347.73);
  });

  it("reads a P&L provisions total ahead of the cash flow's add-back", () => {
    const m = extract({
      "Provisions and Contingencies__ProfitLoss": 15000,
      "Prov. & W/O (Net)__CashFlow": 16347.73,
      "Prov. & W/O (Net)": 16347.73,
    });
    expect(m.provisions).toBe(15000);
  });

  it("reads the P&L's investment income, not the cash flow's adjustment (LIC's label)", () => {
    const m = extract({
      "Investment Income__CashFlow": -412000,
      "Investment Income": -412000,
      "Income From Investment (Insurance Business)__ProfitLoss": 418500,
    });
    expect(m.investmentIncome).toBe(418500);
  });

  it("still reads a bare key that no statement files", () => {
    // The fallback's purpose: a line the parser could not place.
    const m = extract({ "Advances :__BalanceSheet": 1000, Investments: 400 });
    expect(m.investments).toBe(400);
  });

  it("labels the interest basis by the line actually read, past a label only the cash flow files", () => {
    const m = extract({
      "Interest Income__CashFlow": 900,
      "Interest Income": 900,
      "Revenue From Operations(Net)__ProfitLoss": 54973.89,
    });
    expect(m.interestEarned).toBe(54973.89);
    expect(m.interestIncomeBasis).toBe("revenue-total");
  });
});

describe("an unused label filed at zero", () => {
  it("does not hide the investments filed under the label in use (Shriram FY2025)", () => {
    const m = extract({ "Investments__BalanceSheet": 0, "Total Investments__BalanceSheet": 15585.34 });
    expect(m.investments).toBe(15585.34);
  });

  it("still reads investments of zero where no other label is filed", () => {
    expect(extract({ "Investments__BalanceSheet": 0 }).investments).toBe(0);
  });
});
