/**
 * The balance sheet repeats line labels across sections: "Trade Payables",
 * "Lease Liabilities" and "Provisions" appear under non-current liabilities
 * (often at 0) and again under current liabilities. Keys are per label and the
 * first row wins, so the current rows were lost — TCS's 13,909 Cr of trade
 * payables, and current lease liabilities in 124 library company-years.
 */
import { describe, expect, it } from "vitest";
import { gridToPeriods } from "../capitalineParser/gridToPeriods";

const header = { rowIndex: 0, metricCol: 0, periodCols: [{ col: 1, period_end: "2025-03-31", label: "Mar 2025" }] };
const parse = (rows: Array<[string, string]>) =>
  gridToPeriods([["Particulars", "Mar 2025"], ...rows.map(([m, v]) => [m, v])], header, "BalanceSheet", "ind-as").get("2025-03-31")!;

describe("current-liability rows that repeat an earlier label", () => {
  const values = parse([
    ["Trade Payables", "0"],
    ["Lease Liabilities", "7838"],
    ["Total Reported Non-current Liabilities", "9496"],
    ["Lease Liabilities", "1554"],
    ["Trade Payables", "13909"],
    ["Other Current Liabilities", "7718"],
    ["Total Current Liabilities", "34155"],
    ["Trade Payables", "5"],
  ]);

  it("keeps the current row under its own key", () => {
    expect(values.get("Trade Payables - Current__BalanceSheet")?.value).toBe(13909);
    expect(values.get("Lease Liabilities - Current__BalanceSheet")?.value).toBe(1554);
  });

  it("leaves every existing key as it was", () => {
    expect(values.get("Trade Payables__BalanceSheet")?.value).toBe(0);
    expect(values.get("Lease Liabilities__BalanceSheet")?.value).toBe(7838);
  });

  it("keeps a label first seen under current liabilities on its plain key", () => {
    expect(values.get("Other Current Liabilities__BalanceSheet")?.value).toBe(7718);
    expect(values.has("Other Current Liabilities - Current__BalanceSheet")).toBe(false);
  });

  it("tags only rows inside the current-liabilities block", () => {
    // A repeat after the block ends keeps the first-row-wins rule.
    expect([...values.keys()].filter((k) => k.startsWith("Trade Payables")).sort()).toEqual([
      "Trade Payables - Current__BalanceSheet",
      "Trade Payables__BalanceSheet",
    ]);
  });
});
