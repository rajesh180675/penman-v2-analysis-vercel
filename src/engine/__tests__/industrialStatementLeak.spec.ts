/**
 * The parser keeps every line it places in a statement under its bare label
 * too. The industrial picker read that bare key, and then any statement's
 * line with a loosely matching label, whenever the statement it asked for did
 * not file the label: the cash flow's working-capital changes stood in for
 * balance-sheet inventories and trade payables (DMart FY2012-15 inventories
 * -72.81 to -161.28, Titan FY2011 -652.70), and its "Investment Income"
 * adjustment for DMart's FY2016-17 finance income. Asked for a statement, the
 * picker now reads only that statement's lines and labels no statement files.
 */
import { describe, expect, it } from "vitest";
import { valBS, valPL } from "../PenmanNissimEngine/picking";
import type { RawPeriodData } from "../types";

const period = (lines: Record<string, number>): RawPeriodData => ({
  company_id: "X",
  period_end: "2012-03-31",
  raw_metric_values: lines,
});

describe("an industrial pick reads its own statement", () => {
  it("does not read a cash-flow change as a balance-sheet balance (DMart FY2012)", () => {
    const d = period({ "Inventories__CashFlow": -72.81, Inventories: -72.81 });
    expect(valBS(d, ["Inventories"])).toBe(0);
  });

  it("does not reach another statement's line through a loose label match", () => {
    // Case differs, so only the loose pass could find it.
    const d = period({ "Trade payables__CashFlow": 19.78 });
    expect(valBS(d, ["Trade Payables"])).toBe(0);
  });

  it("does not read the cash flow's investment-income adjustment as P&L income (DMart FY2016)", () => {
    const d = period({ "Investment Income__CashFlow": 2.55, "Investment Income": 2.55 });
    expect(valPL(d, ["Investment Income"])).toBe(0);
  });

  it("still reads its own statement's line, and a bare label no statement files", () => {
    expect(valBS(period({ "Inventories__BalanceSheet": 671.69, Inventories: 671.69 }), ["Inventories"])).toBe(671.69);
    expect(valBS(period({ Inventories: 500 }), ["Inventories"])).toBe(500);
  });

  it("reads retained earnings from the P&L appropriation account, where Capitaline files them", () => {
    const d = period({ "Unappropriated Profits Carried Forward__ProfitLoss": 18000, "Unappropriated Profits Carried Forward": 18000 });
    expect(valPL(d, ["Unappropriated Profits Carried Forward"])).toBe(18000);
    expect(valBS(d, ["Unappropriated Profits Carried Forward"])).toBe(0);
  });
});
