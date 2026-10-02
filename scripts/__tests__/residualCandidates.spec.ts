import { describe, expect, it } from "vitest";
import { findResidualCandidates } from "../lib/residualCandidates";

// L&T FY16 as filed: the associates' share sits below PAT and the recast did
// not read it, so the cost bridge missed Core OI by exactly that figure.
const raw = {
  "Profit After Tax__ProfitLoss": 5582.66,
  "Share of Profits / Loss of Associated Companies__ProfitLoss": -990.16,
  "Extraordinary Items After Tax__ProfitLoss": -47.8,
  "Interest Received__CashFlow": 402.31,
  "Share Capital__BalanceSheet": 990.16,
  "Dividend Per Share__ProfitLoss": 0,
};
const readLabels = new Set(["Profit After Tax", "Extraordinary Items After Tax"]);

describe("findResidualCandidates", () => {
  it("finds the unread line equal to the residual, whatever its sign", () => {
    const found = findResidualCandidates({ rawValues: raw, readLabels, residual: 990.2, taxRate: 0.304 });
    expect(found).toEqual([
      { label: "Share of Profits / Loss of Associated Companies", statement: "ProfitLoss", value: -990.16, basis: "as filed", read: false },
    ]);
  });

  it("matches a line after tax when that is the scale the residual is on", () => {
    // NTPC FY12: 316.06 of prior-year adjustments, 236.07 after a 25.3% rate.
    const found = findResidualCandidates({
      rawValues: { "Prior Year Adjustments__ProfitLoss": 316.06 },
      readLabels: new Set(),
      residual: -236.1,
      taxRate: 0.253,
    });
    expect(found.map((c) => [c.label, c.basis, c.read])).toEqual([["Prior Year Adjustments", "after tax", false]]);
  });

  it("reports a line the recast read, flagged, and skips balance-sheet lines and zeros", () => {
    // L&T FY18: the investment loss was read (as UFE) and still explains the gap.
    const found = findResidualCandidates({ rawValues: raw, readLabels, residual: 47.8, taxRate: 0.3 });
    expect(found.map((c) => [c.label, c.read])).toEqual([["Extraordinary Items After Tax", true]]);
    // The balance-sheet share capital equals 990.16 too, but is not a P&L or cash-flow line.
    expect(findResidualCandidates({ rawValues: raw, readLabels, residual: 990.16, taxRate: 0.3 }).map((c) => c.statement)).toEqual(["ProfitLoss"]);
  });

  it("searches the balance sheet when asked: the line behind an OL-coverage gap", () => {
    // Power Grid FY16: 5,698.14 filed outside both liability blocks, the whole gap.
    const found = findResidualCandidates({
      rawValues: {
        "Other Liabilities Excluding Equity, Non-Current and Current Liabilities__BalanceSheet": 5698.14,
        "Total Equity__BalanceSheet": 43969.93,
        "Provisions__ProfitLoss": 5698.2,
      },
      readLabels: new Set(["Total Equity"]),
      residual: -5698.2,
      taxRate: 0,
      statements: ["BalanceSheet"],
    });
    expect(found.map((c) => c.label)).toEqual(["Other Liabilities Excluding Equity, Non-Current and Current Liabilities"]);
  });

  it("treats a line as read whichever statement suffix the recast traced it under", () => {
    // A bare-key read is traced as "Fallback"; the label is what identifies the line.
    const found = findResidualCandidates({ rawValues: { "Interest Received__CashFlow": 50 }, readLabels: new Set(["Interest Received"]), residual: 50, taxRate: 0 });
    expect(found.map((c) => c.read)).toEqual([true]);
  });

  it("does not match a line to a large residual by coincidence", () => {
    // L&T FY18's residual was two lines combined; Interest Paid after tax is
    // 0.5% away from it, which a 1% band reported as a match.
    const found = findResidualCandidates({
      rawValues: { "Interest Paid__CashFlow": -2470.7 },
      readLabels: new Set(),
      residual: -1781.86,
      taxRate: 0.275,
    });
    expect(found).toEqual([]);
  });

  it("returns nothing for a zero or non-finite residual", () => {
    expect(findResidualCandidates({ rawValues: raw, readLabels, residual: 0, taxRate: 0.3 })).toEqual([]);
    expect(findResidualCandidates({ rawValues: raw, readLabels, residual: Number.NaN, taxRate: 0.3 })).toEqual([]);
  });

  it("lists the nearest matches first and honours the limit", () => {
    const found = findResidualCandidates({
      rawValues: {
        "A__ProfitLoss": 100.4,
        "B__ProfitLoss": 100.05,
        "C__CashFlow": 99.7,
      },
      readLabels: new Set(),
      residual: 100,
      taxRate: 0,
      limit: 2,
    });
    expect(found.map((c) => c.label)).toEqual(["B", "C"]);
  });
});
