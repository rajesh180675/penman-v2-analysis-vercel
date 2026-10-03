/**
 * Asset rows repeat labels across sections the way liability rows do: a
 * pre-Ind AS NBFC files "Total Loans Given" under non-current assets and again
 * under current assets (Bajaj Finance FY16: 24,778.55 and 18,493.68). The
 * first row won, so the current half of the loan book was lost and NIM read
 * at twice its level.
 */
import { describe, expect, it } from "vitest";
import { gridToPeriods } from "../capitalineParser/gridToPeriods";

const header = {
  rowIndex: 0,
  metricCol: 0,
  periodCols: [
    { col: 1, period_end: "2016-03-31", label: "Mar 2016" },
    { col: 2, period_end: "2025-03-31", label: "Mar 2025" },
  ],
};
const parse = (rows: Array<[string, string, string]>) => {
  const out = gridToPeriods([["Particulars", "Mar 2016", "Mar 2025"], ...rows], header, "BalanceSheet", "ind-as");
  return { fy16: out.get("2016-03-31")!, fy25: out.get("2025-03-31")! };
};

describe("current-asset rows that repeat an earlier label", () => {
  // FY16: the book filed in both blocks. FY25: the non-current row is "-"
  // and the current row carries the line, as banks and insurers file it.
  const { fy16, fy25 } = parse([
    ["Total Loans Given", "24778.55", "-"],
    ["Total Provisions", "0", "0"],
    ["Foreign Currency Monetary Item Translation Difference Account", "0", "0"],
    ["Total Reported Non-current Assets", "25905.85", "1"],
    ["Total Provisions", "12", "12"],
    ["Total Loans Given", "18493.68", "720"],
    ["Total Current Assets", "21067.22", "1"],
    ["Foreign Currency Monetary Item Translation Difference Account", "3", "3"],
    ["Total Reported Non-current Liabilities", "25977.2", "1"],
    ["Total Provisions", "40", "40"],
    ["Total Current Liabilities", "13569.11", "1"],
  ]);

  it("keeps the current row under its own key beside the non-current row", () => {
    expect(fy16.get("Total Loans Given__BalanceSheet")?.value).toBe(24778.55);
    expect(fy16.get("Total Loans Given - Current Assets__BalanceSheet")?.value).toBe(18493.68);
  });

  it("still fills a null first row from the current row, and then keeps no twin", () => {
    // The plain key is unchanged from before; a twin here would count 720 twice.
    expect(fy25.get("Total Loans Given__BalanceSheet")?.value).toBe(720);
    expect(fy25.has("Total Loans Given - Current Assets__BalanceSheet")).toBe(false);
  });

  it("leaves the liability block's current key to the liability row", () => {
    expect(fy16.get("Total Provisions - Current__BalanceSheet")?.value).toBe(40);
    expect(fy16.get("Total Provisions - Current Assets__BalanceSheet")?.value).toBe(12);
  });

  it("tags only rows inside the current-assets block", () => {
    // A repeat after the block ends keeps the first-row-wins rule.
    expect(fy16.has("Foreign Currency Monetary Item Translation Difference Account - Current Assets__BalanceSheet")).toBe(false);
    expect(fy16.get("Foreign Currency Monetary Item Translation Difference Account__BalanceSheet")?.value).toBe(0);
  });
});
