/* ================================================================
   End-to-end: recast-ta-vs-raw fails closed on real corrupt input (#89).

   The audit found the prior recast-ta-vs-raw residual was tautological —
   it compared period.bs.TA against debug.rawTotalAssets, but BOTH resolve
   the identical raw "Total Assets" cell with the same precedence, so the
   residual was identically 0 for every executable input. Its regression
   test hand-injected a decoupled recastDebug the real extractRecastDebug
   could never produce, so it was green-by-construction.

   The check now compares recast bs.TA against the SUM of independently-
   reported asset subtotals (Total Current Assets + Total Non-Current
   Assets). These tests drive the REAL computeRecastPeriod pipeline (which
   calls extractRecastDebug internally) — no hand-built recastDebug — so a
   genuinely corrupted source line must flip reconciliation closed.
================================================================ */

import { describe, expect, it } from "vitest";
import { computeRecastPeriod } from "../PenmanNissimEngine";
import { evaluateReconciliationResiduals } from "../reconciliationResiduals";
import { DEFAULT_CONFIG, RawPeriodData } from "../types";

/**
 * A clean, balanced industrial period. Total Assets (1000) reconciles to the
 * two independently-reported asset subtotals:
 *   Total Current Assets (400) + Total Non-Current and Other Assets (600) = 1000.
 */
function makePeriod(period_end: string, overrides: Record<string, number> = {}): RawPeriodData {
  return {
    company_id: "TA-COMP",
    period_end,
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000,
      "Total Current Assets__BalanceSheet": 400,
      "Total Non-Current and Other Assets__BalanceSheet": 600,
      "Total Stockholders' Equity__BalanceSheet": 600,
      "Total Equity__BalanceSheet": 600,
      "Total Equity and Liabilities__BalanceSheet": 1000,
      "Minority Interest__BalanceSheet": 0,
      "Net Property, plant and equipment__BalanceSheet": 320,
      "Cash and Cash Equivalents__BalanceSheet": 100,
      "Trade Payables__BalanceSheet": 80,
      "Other Current Liabilities__BalanceSheet": 50,
      "Provisions - Current__BalanceSheet": 10,
      "Provisions - Long-term__BalanceSheet": 10,
      "Current Tax Liabilities__BalanceSheet": 10,
      "Other Non-Current Liabilities__BalanceSheet": 80,
      "Revenue From Operations(Net)__ProfitLoss": 900,
      "Profit Before Tax__ProfitLoss": 140,
      "Tax Expenses__ProfitLoss": 35,
      "Profit After Tax__ProfitLoss": 105,
      "Total Comprehensive Income for the Year__ProfitLoss": 105,
      "Finance Cost__ProfitLoss": 10,
      "Other Income__ProfitLoss": 5,
      "Net Cash from Operating Activities__CashFlow": 120,
      "Purchased of Fixed Assets__CashFlow": -40,
      "Dividend Paid__CashFlow": -20,
      ...overrides,
    },
  };
}

function reconcile(corruption: Record<string, number> = {}) {
  const prev = computeRecastPeriod(makePeriod("2024-03-31"), DEFAULT_CONFIG);
  const cur = computeRecastPeriod(makePeriod("2025-03-31", corruption), DEFAULT_CONFIG, prev);
  const summary = evaluateReconciliationResiduals({ recastData: [prev, cur], config: DEFAULT_CONFIG });
  const check = summary.checks.find(
    (c) => c.key === "recast-ta-vs-raw" && c.periodEnd === "2025-03-31",
  );
  return { summary, check, cur };
}

describe("ol-coverage-bridge — reads the labels Capitaline actually uses (real recast)", () => {
  // Capitaline's own labels and the "Sundry Creditors" alias, as in the
  // bundled exports. They sum to OL = TA − CSE − FO = 1000 − 600 − 0 = 400.
  function capitalinePeriod(period_end: string, overrides: Record<string, number> = {}): RawPeriodData {
    return {
      company_id: "OL-COV",
      period_end,
      raw_metric_values: {
        "Total Assets__BalanceSheet": 1000,
        "Total Current Assets__BalanceSheet": 400,
        "Total Non-Current and Other Assets__BalanceSheet": 600,
        "Total Stockholders' Equity__BalanceSheet": 600,
        "Total Equity__BalanceSheet": 600,
        "Total Equity and Liabilities__BalanceSheet": 1000,
        "Minority Interest__BalanceSheet": 0,
        "Net Property, plant and equipment__BalanceSheet": 320,
        "Cash and Cash Equivalents__BalanceSheet": 100,
        "Sundry Creditors__BalanceSheet": 150,
        "Other Current Liabilities__BalanceSheet": 50,
        "Provisions__BalanceSheet": 40,
        "Long-term Provisions__BalanceSheet": 30,
        "Current Tax Liabilities - Short-term__BalanceSheet": 30,
        "Non Current Tax Liabilities - Long-term__BalanceSheet": 20,
        "Deferred Tax Liabilities (Net)__BalanceSheet": 30,
        "Other Non-Current Liabilities__BalanceSheet": 50,
        "Revenue From Operations(Net)__ProfitLoss": 900,
        "Profit Before Tax__ProfitLoss": 140,
        "Tax Expenses__ProfitLoss": 35,
        "Profit After Tax__ProfitLoss": 105,
        "Total Comprehensive Income for the Year__ProfitLoss": 105,
        "Finance Cost__ProfitLoss": 10,
        ...overrides,
      },
    };
  }
  const olCheck = (overrides: Record<string, number> = {}) => {
    const prev = computeRecastPeriod(capitalinePeriod("2024-03-31"), DEFAULT_CONFIG);
    const cur = computeRecastPeriod(capitalinePeriod("2025-03-31", overrides), DEFAULT_CONFIG, prev);
    const summary = evaluateReconciliationResiduals({ recastData: [prev, cur], config: DEFAULT_CONFIG });
    return { cur, check: summary.checks.find((c) => c.key === "ol-coverage-bridge" && c.periodEnd === "2025-03-31") };
  };

  it("confirms when the reported OL components sum to OL", () => {
    // The old hard-coded list read "Trade Payables", "Provisions - Current",
    // "Current Tax Liabilities"… — none present here — and found 130 of 400.
    const { cur, check } = olCheck();
    expect(cur.bs.OL).toBe(400);
    expect(cur.recastDebug?.explicitOL).toBe(400);
    expect(check?.status).toBe("confirmed");
  });

  it("reads past a label exported at zero to the one that carries the balance", () => {
    // ITC-shaped: the unused labels are explicit zeros and the payables sit
    // under "Other Trade Payables". The first finite key used to win, so the
    // zero was read and trade payables counted as nothing.
    const { cur, check } = olCheck({
      "Trade Payables__BalanceSheet": 0,
      "Sundry Creditors__BalanceSheet": 0,
      "Other Trade Payables__BalanceSheet": 150,
    });
    expect(cur.bs.OL_TradePayables).toBe(150);
    expect(cur.recastDebug?.explicitOL).toBe(400);
    expect(check?.status).toBe("confirmed");
  });

  it("still fails closed when a component is genuinely missing from the source", () => {
    // Drop 150 of trade payables: 250 / 400 = 0.63, below the 0.7 floor.
    const { check } = olCheck({ "Sundry Creditors__BalanceSheet": 0 });
    expect(check?.status).toBe("failed");
  });
  it("adds Other Trade Payables to Sundry Creditors, which is only the MSME + others subtotal", () => {
    // HUL FY25-shaped: "Sundry Creditors" 263 (all MSME) beside "Other Trade
    // Payables" 10,898. Reading the first non-zero line found 263.
    const { cur, check } = olCheck({
      "Sundry Creditors__BalanceSheet": 50,
      "Other Trade Payables__BalanceSheet": 100,
    });
    expect(cur.bs.OL_TradePayables).toBe(150);
    expect(cur.bs.TradePayables).toBe(150);
    expect(check?.status).toBe("confirmed");
  });

  it("reads the current trade-payables total the parser keeps under its own key", () => {
    // TCS FY21-shaped: the non-current "Trade Payables" row is 0 and the
    // current one (13,909) used to be dropped as a duplicate label.
    const { cur, check } = olCheck({
      "Sundry Creditors__BalanceSheet": 0,
      "Trade Payables__BalanceSheet": 0,
      "Trade Payables - Current__BalanceSheet": 150,
    });
    expect(cur.bs.TradePayables).toBe(150);
    expect(cur.bs.OL_TradePayables).toBe(150);
    expect(check?.status).toBe("confirmed");
  });

  it("does not add the itemized lines to the current total they sit under", () => {
    // HUL FY25-shaped: 11,315 current total ⊇ Sundry Creditors 263 + Other Trade Payables 10,898.
    const { cur } = olCheck({
      "Sundry Creditors__BalanceSheet": 30,
      "Other Trade Payables__BalanceSheet": 110,
      "Trade Payables - Current__BalanceSheet": 150,
    });
    expect(cur.bs.TradePayables).toBe(150);
  });

  it("reads current provisions kept under their own key", () => {
    const { cur, check } = olCheck({
      "Provisions__BalanceSheet": 0,
      "Provisions - Current__BalanceSheet": 40,
    });
    expect(cur.bs.OL_ProvisionsCurrent).toBe(40);
    expect(check?.status).toBe("confirmed");
  });

  it("reads trade payables filed only as Other Trade Payables", () => {
    // Sun Pharma FY25-shaped: the days-payable read found none of its labels
    // and reported 0, overstating operating working capital.
    const { cur } = olCheck({
      "Sundry Creditors__BalanceSheet": 0,
      "Other Trade Payables__BalanceSheet": 150,
    });
    expect(cur.bs.TradePayables).toBe(150);
    expect(cur.bs.OL_TradePayables).toBe(150);
  });

  it("reads the other-current-liabilities total, not its residual line", () => {
    // ITC FY25-shaped: statutory dues and customer advances are itemized, so
    // "Other Current Liabilities" is 32.72 of a 6,148.27 total.
    const { cur, check } = olCheck({
      "Other Current Liabilities__BalanceSheet": 5,
      "Total Other Current Liabilities__BalanceSheet": 50,
    });
    expect(cur.bs.OL_OtherCurrentLiabilities).toBe(50);
    expect(check?.status).toBe("confirmed");
  });

  it("counts a consolidated insurer's policy liabilities as operating liabilities", () => {
    // Grasim FY25-shaped: 81,353 of insurance liabilities sit inside OL.
    const { cur, check } = olCheck({
      "Other Non-Current Liabilities__BalanceSheet": 10,
      "Insurance Related Liabilities__BalanceSheet": 40,
    });
    expect(cur.bs.OL_OtherNonCurrentLiabilities).toBe(50);
    expect(check?.status).toBe("confirmed");
  });

  it("counts regulatory-deferral credit balances filed outside both sections", () => {
    // Power Grid FY16-shaped: 5,698.14 sat outside the current and non-current
    // blocks and was the whole coverage gap.
    const { cur, check } = olCheck({
      "Other Non-Current Liabilities__BalanceSheet": 10,
      "Other Liabilities Excluding Equity, Non-Current and Current Liabilities__BalanceSheet": 40,
    });
    expect(cur.bs.OL_OtherNonCurrentLiabilities).toBe(50);
    expect(check?.status).toBe("confirmed");
  });

  // Paytm FY10-shaped old Schedule VI: the 270 of current liabilities and
  // provisions are deducted from the 400 of current assets, so "Total Assets"
  // is 730 and no "Total Equity and Liabilities" is filed. Trade payables
  // appear under both labels.
  const netted = {
    "Total Assets__BalanceSheet": 730,
    "Total Equity and Liabilities__BalanceSheet": 0,
    "Total Current Liabilities__BalanceSheet": 270,
    "Net Current Assets__BalanceSheet": 130,
    "Trade Payables__BalanceSheet": 150,
  };

  it("grosses up a netted Schedule VI balance sheet, leaving NOA unchanged", () => {
    const { cur, check } = olCheck(netted);
    const gross = olCheck().cur;
    expect(cur.bs.TA).toBe(1000);
    expect(cur.bs.OL).toBe(400);
    expect(cur.bs.NOA).toBe(gross.bs.NOA);
    expect(cur.bs.OL_TradePayables).toBe(150);
    expect(check?.status).toBe("confirmed");
  });

  it("reads the netted layout's other current liabilities from its subtotal", () => {
    // Only trade payables are itemized inside "Current Liabilities" (200 here:
    // 150 + 50 unitemized); Paytm FY15 left 165 of 313 unread this way.
    const { cur, check } = olCheck({
      ...netted,
      "Other Current Liabilities__BalanceSheet": 0,
      "Current Liabilities__BalanceSheet": 200,
    });
    expect(cur.bs.OL_OtherCurrentLiabilities).toBe(50);
    expect(check?.status).toBe("confirmed");
  });

  it("leaves a filed Net Current Assets line alone when it is not the netting", () => {
    // ITC files the line (FY11: 1,100.83, not 13,872.30 − 8,711.10) beside a
    // gross TA; even without "Total Equity and Liabilities" it is not netting.
    const { cur } = olCheck({
      "Total Equity and Liabilities__BalanceSheet": 0,
      "Total Current Liabilities__BalanceSheet": 270,
      "Net Current Assets__BalanceSheet": 55,
    });
    expect(cur.bs.TA).toBe(1000);
  });

  // NTPC FY12-shaped: the export files only totals, trade payables, deferred
  // tax and the regulatory-deferral line outside both blocks.
  const bareTotals = {
    "Other Current Liabilities__BalanceSheet": 0,
    "Provisions__BalanceSheet": 0,
    "Long-term Provisions__BalanceSheet": 0,
    "Current Tax Liabilities - Short-term__BalanceSheet": 0,
    "Non Current Tax Liabilities - Long-term__BalanceSheet": 0,
    "Other Non-Current Liabilities__BalanceSheet": 0,
    "Other Liabilities Excluding Equity, Non-Current and Current Liabilities__BalanceSheet": 40,
  };

  it("keeps a bare-totals year diagnostic despite the line filed outside both blocks", () => {
    const { check } = olCheck(bareTotals);
    expect(check?.role).toBe("diagnostic");
  });

  it("gates once a block is itemized beside that line", () => {
    const { check } = olCheck({ ...bareTotals, "Other Non-Current Liabilities__BalanceSheet": 10 });
    expect(check?.role).not.toBe("diagnostic");
  });

  it("reads current provisions filed as Short-Term Provisions", () => {
    // TCS FY13-shaped: 4,233.46 of current provisions under the older label.
    const { cur, check } = olCheck({ "Provisions__BalanceSheet": 0, "Short-Term Provisions__BalanceSheet": 40 });
    expect(cur.bs.OL_ProvisionsCurrent).toBe(40);
    expect(check?.status).toBe("confirmed");
  });
});

describe("owners' income identity — profit on TCI's basis (real recast)", () => {
  // Capitaline's "Profit After Tax" stops before discontinued operations; the
  // filed TCI includes them. "Profit Attributable to Shareholders" less
  // "Minority Interest After Net Profit" is the group's full profit.
  const tciCheck = (overrides: Record<string, number>) => {
    const prev = computeRecastPeriod(makePeriod("2024-03-31"), DEFAULT_CONFIG);
    const cur = computeRecastPeriod(makePeriod("2025-03-31", overrides), DEFAULT_CONFIG, prev);
    const summary = evaluateReconciliationResiduals({ recastData: [prev, cur], config: DEFAULT_CONFIG });
    return { cur, check: summary.checks.find((c) => c.key === "comprehensive-income-bridge" && c.periodEnd === "2025-03-31") };
  };

  it("includes discontinued operations, as the filed TCI does", () => {
    // PAT 105 from continuing operations, a −40 discontinued loss: TCI 65.
    // Against PAT alone that was a 38% breach.
    const { cur, check } = tciCheck({
      "Discontinued Operations__ProfitLoss": -40,
      "Profit Attributable to Shareholders__ProfitLoss": 65,
      "Total Comprehensive Income for the Year__ProfitLoss": 65,
    });
    expect(cur.recastDebug?.fullPeriodProfit).toBe(65);
    expect(check?.residual).toBeCloseTo(0, 9);
    expect(check?.status).toBe("confirmed");
  });

  it("adds back the minority's signed share to reach the group's full profit", () => {
    // Group full profit 65; the minority shares 10, so owners get 55. Capitaline
    // signs both minority lines negative when the minority shares a profit.
    const { cur, check } = tciCheck({
      "Discontinued Operations__ProfitLoss": -40,
      "Profit Attributable to Shareholders__ProfitLoss": 55,
      "Minority Interest After Net Profit__ProfitLoss": -10,
      "Non-Controlling Interests__ProfitLoss": -10,
      "Total Comprehensive Income for the Year__ProfitLoss": 55,
    });
    expect(cur.recastDebug?.fullPeriodProfit).toBe(65);
    expect(check?.status).toBe("confirmed");
  });

  it("falls back to PAT when a minority exists but its after-profit line is absent", () => {
    const { cur } = tciCheck({
      "Profit Attributable to Shareholders__ProfitLoss": 95,
      "Non-Controlling Interests__ProfitLoss": -10,
    });
    expect(cur.recastDebug?.fullPeriodProfit).toBeNull();
  });
});

describe("profit bridge — PAT ties to full-period profit through the filed lines (real recast)", () => {
  // The owners'-income identity reads profit from the filed subtotal, so PAT
  // is checked here: PAT + discontinued + extraordinary + associates = full.
  const bridge = (overrides: Record<string, number>) => {
    const prev = computeRecastPeriod(makePeriod("2024-03-31"), DEFAULT_CONFIG);
    const cur = computeRecastPeriod(makePeriod("2025-03-31", overrides), DEFAULT_CONFIG, prev);
    const summary = evaluateReconciliationResiduals({ recastData: [prev, cur], config: DEFAULT_CONFIG });
    return summary.checks.find((c) => c.key === "profit-bridge" && c.periodEnd === "2025-03-31");
  };
  // L&T FY21 as filed, scaled to PAT 105: discontinued 150 − 50 tax, an
  // extraordinary loss of 40 and 5 from associates: 105 + 100 − 40 + 5 = 170.
  const filed = {
    "Profit / (Loss) from Discontinuing Operations__ProfitLoss": 150,
    "Tax Expense of Discontinuing Operations__ProfitLoss": -50,
    "Discontinued Operations__ProfitLoss": 100,
    "Extraordinary Items After Tax__ProfitLoss": -40,
    "Share of Profits / Loss of Associated Companies__ProfitLoss": 5,
    "Profit Attributable to Shareholders__ProfitLoss": 170,
    "Total Comprehensive Income for the Year__ProfitLoss": 170,
  };

  it("confirms when PAT and the lines below it sum to the filed subtotal", () => {
    const check = bridge(filed);
    expect(check?.residual).toBeCloseTo(0, 9);
    expect(check?.status).toBe("confirmed");
  });

  it("fails when PAT is mis-picked", () => {
    // "Profit After Tax" missing: the recast falls through to "Profit
    // Attributable to Shareholders" (170) and counts the lines below it twice.
    const { ["Profit After Tax__ProfitLoss"]: _pat, ...withoutPat } = makePeriod("2025-03-31", filed).raw_metric_values;
    const prev = computeRecastPeriod(makePeriod("2024-03-31"), DEFAULT_CONFIG);
    const cur = computeRecastPeriod({ company_id: "TA-COMP", period_end: "2025-03-31", raw_metric_values: withoutPat }, DEFAULT_CONFIG, prev);
    const summary = evaluateReconciliationResiduals({ recastData: [prev, cur], config: DEFAULT_CONFIG });
    const check = summary.checks.find((c) => c.key === "profit-bridge" && c.periodEnd === "2025-03-31");
    expect(cur.is.PAT).toBe(170);
    expect(check?.status).toBe("failed");
  });

  it("fails when the discontinued result is misstated", () => {
    // The pre-#356 subtraction: 150 − (−50) = 200 instead of 100.
    expect(bridge({ ...filed, "Tax Expense of Discontinuing Operations__ProfitLoss": 50 })?.status).toBe("failed");
  });

  it("is not run without the filed subtotal", () => {
    expect(bridge({})).toBeUndefined();
  });
});

describe("lease liabilities — current portion counts as a financial obligation (real recast)", () => {
  it("adds the current lease liabilities to FO", () => {
    const base = computeRecastPeriod(makePeriod("2025-03-31", { "Lease Liabilities__BalanceSheet": 60 }), DEFAULT_CONFIG);
    const withCurrent = computeRecastPeriod(makePeriod("2025-03-31", {
      "Lease Liabilities__BalanceSheet": 60,
      "Lease Liabilities - Current__BalanceSheet": 15,
    }), DEFAULT_CONFIG);
    expect(withCurrent.bs.FO - base.bs.FO).toBe(15);
    expect(withCurrent.bs.FO_LeaseLiabilities).toBe(75);
    expect(base.bs.OL - withCurrent.bs.OL).toBe(15);
  });
});

describe("COGS — the inventory-change line is added, as Capitaline signs it (real recast)", () => {
  // Asian Paints FY11 as filed: the cost lines tie to Total Expenses 5,288.65
  // only with the change ADDED (3,681.92 + 105.56 − 140.61 + 300.45 + 15.35
  // + 94.48 + 1,231.50). Inventory built, so the line is negative.
  const filed = (overrides: Record<string, number> = {}): RawPeriodData => ({
    ...makePeriod("2025-03-31"),
    raw_metric_values: {
      ...makePeriod("2025-03-31").raw_metric_values,
      "Cost of Material Consumed__ProfitLoss": 3681.92,
      "Purchases of Stock-in-Trade__ProfitLoss": 105.56,
      "Changes in Inventories of Finished Goods, Work-in-Progress and Stock-in-Trade__ProfitLoss": -140.61,
      ...overrides,
    },
  });

  it("lowers COGS when inventory builds", () => {
    const period = computeRecastPeriod(filed(), DEFAULT_CONFIG);
    // Subtracting it gave 3,928.09 — COGS overstated by twice the change.
    expect(period.is.COGS).toBeCloseTo(3646.87, 6);
  });

  it("adds the internally-manufactured-components line as signed", () => {
    // Maruti FY24: a −260.7 credit that Total Expenses includes; without it
    // the cost lines miss the filed total by exactly that.
    const period = computeRecastPeriod(
      filed({ "Internally Manufactured Intermediates or Components Consumed__ProfitLoss": -260.7 }),
      DEFAULT_CONFIG,
    );
    expect(period.is.COGS).toBeCloseTo(3646.87 - 260.7, 6);
  });

  it("carries the associates' share into the cost bridge, as Core OI does", () => {
    // Maruti FY24: 254.1 of associates' profit sits inside PBT and OI.
    const without = computeRecastPeriod(filed(), DEFAULT_CONFIG);
    const withShare = computeRecastPeriod(
      filed({ "Share of Profits / Loss of Associated Companies Before Tax__ProfitLoss": 254.1 }),
      DEFAULT_CONFIG,
    );
    expect(withShare.is.operatingCostBridge?.associatesShare).toBe(254.1);
    expect(withShare.is.operatingCostBridge!.bridgeCoreOI - without.is.operatingCostBridge!.bridgeCoreOI).toBeCloseTo(254.1, 6);
  });

  it("raises COGS when inventory runs down", () => {
    const period = computeRecastPeriod(
      filed({ "Changes in Inventories of Finished Goods, Work-in-Progress and Stock-in-Trade__ProfitLoss": 140.61 }),
      DEFAULT_CONFIG,
    );
    expect(period.is.COGS).toBeCloseTo(3928.09, 6);
  });
});

describe("discontinued operations — the tax line is added, as Capitaline signs it (real recast)", () => {
  // Capitaline files the discontinued result pre-tax, signs its tax line as an
  // adjustment (negative = expense) and files the after-tax result as
  // "Discontinued Operations": pre-tax + tax = after-tax in every library year.
  const discontinued = (pre: number, tax: number) => computeRecastPeriod(makePeriod("2025-03-31", {
    "Profit / (Loss) from Discontinuing Operations__ProfitLoss": pre,
    "Tax Expense of Discontinuing Operations__ProfitLoss": tax,
    "Discontinued Operations__ProfitLoss": pre + tax,
  }), DEFAULT_CONFIG).cu;

  it("nets a tax expense out of the pre-tax result", () => {
    // L&T FY21 as filed: 10,790.50 − 2,552.58 = 8,237.92. Subtracting the
    // signed line gave 13,343.08 — overstated by twice the tax.
    expect(discontinued(10790.5, -2552.58).DiscontinuedOperationsAfterTax).toBeCloseTo(8237.92, 6);
  });

  it("keeps the tax when the pre-tax line is zero", () => {
    // Asian Paints FY20: pre-tax 0, tax −4.95, filed after-tax −4.95. The
    // |tax| ≤ |pre-tax| guard dropped the tax and reported nothing.
    expect(discontinued(0, -4.95).DiscontinuedOperationsAfterTax).toBeCloseTo(-4.95, 6);
  });

  it("adds a tax credit", () => {
    // HUL FY22: 3 + 2 = 5 as filed (the old formula gave 1).
    expect(discontinued(3, 2).DiscontinuedOperationsAfterTax).toBeCloseTo(5, 6);
  });
});

describe("gains on sale of investments — financial income, as the cash-flow adjustment signs them (real recast)", () => {
  // "P/L on Sales of Invest" is the operating-cash-flow adjustment: a gain is
  // subtracted from PBT, so it is negative (Asian Paints FY11: −0.45 inside
  // the filed Total Adjustments of 71.14). A 40 gain, reported inside Other
  // Income and taxed at 25%, adds 30 to TCI and must leave Core OI — and the
  // cost bridge's other operating income — where they were.
  const base = computeRecastPeriod(makePeriod("2025-03-31", { "Interest Income__ProfitLoss": 3 }), DEFAULT_CONFIG);
  const withGain = computeRecastPeriod(makePeriod("2025-03-31", {
    "Interest Income__ProfitLoss": 3,
    "Other Income__ProfitLoss": 45,
    "Profit Before Tax__ProfitLoss": 180,
    "Tax Expenses__ProfitLoss": 45,
    "Profit After Tax__ProfitLoss": 135,
    "Total Comprehensive Income for the Year__ProfitLoss": 135,
    "P/L on Sales of Invest__CashFlow": -40,
  }), DEFAULT_CONFIG);

  it("books the after-tax gain as unusual financial income", () => {
    expect(withGain.is.taxRate).toBe(0.25);
    expect(withGain.cu.UFE).toBeCloseTo(-30, 9);
  });

  it("keeps the gain out of Core OI", () => {
    // Negating the adjustment booked the gain as an expense: Core OI rose by 60.
    expect(withGain.cu.CoreOI).toBeCloseTo(base.cu.CoreOI, 9);
  });

  it("keeps the gain out of the rung-4 finance-income proxy", () => {
    // No interest line anywhere, so finance income is Other Income × FA/TA
    // (clamped to 20% here). Proxying the gain too counted 8 of it as finance
    // income while UFE took the whole 40 again: Core OI fell by 6.
    const proxyBase = computeRecastPeriod(makePeriod("2025-03-31", { "Other Income__ProfitLoss": 2 }), DEFAULT_CONFIG);
    const proxyGain = computeRecastPeriod(makePeriod("2025-03-31", {
      "Other Income__ProfitLoss": 42,
      "Profit Before Tax__ProfitLoss": 180,
      "Tax Expenses__ProfitLoss": 45,
      "Profit After Tax__ProfitLoss": 135,
      "Total Comprehensive Income for the Year__ProfitLoss": 135,
      "P/L on Sales of Invest__CashFlow": -40,
    }), DEFAULT_CONFIG);
    expect(proxyGain.is.FinanceIncomeRung).toBe(4);
    expect(proxyGain.is.FinanceIncome).toBeCloseTo(proxyBase.is.FinanceIncome, 9);
    expect(proxyGain.cu.CoreOI).toBeCloseTo(proxyBase.cu.CoreOI, 9);
  });

  it("nets the gain out of the cost bridge's other operating income", () => {
    // Other Income 45 = interest 3 + the gain 40 + 2 of operating income.
    expect(base.is.operatingCostBridge?.otherOperatingIncome).toBe(2);
    expect(withGain.is.operatingCostBridge?.otherOperatingIncome).toBe(2);
  });
});

describe("investment P/L the exceptional items already carry — booked once (real recast)", () => {
  // Asian Paints FY25: the 83.71 loss on divesting the Indonesia subsidiaries
  // is one of the −363.10 exceptional items, and also the cash-flow "P/L on
  // Sales of Invest". UOI removed it with the exceptional items and UFE again.
  const base = computeRecastPeriod(makePeriod("2025-03-31", { "Interest Income__ProfitLoss": 3 }), DEFAULT_CONFIG);
  const withLoss = (exceptional: number, pl: number) => computeRecastPeriod(makePeriod("2025-03-31", {
    "Interest Income__ProfitLoss": 3,
    "Exceptional Items Before Tax__ProfitLoss": exceptional,
    "Profit Before Tax__ProfitLoss": 140 + exceptional,
    "Tax Expenses__ProfitLoss": 35 + exceptional * 0.25,
    "Profit After Tax__ProfitLoss": (140 + exceptional) * 0.75,
    "Total Comprehensive Income for the Year__ProfitLoss": (140 + exceptional) * 0.75,
    "P/L on Sales of Invest__CashFlow": pl,
  }), DEFAULT_CONFIG);

  it("leaves a loss inside larger exceptional losses to UOI", () => {
    const period = withLoss(-50, 20);
    expect(period.cu.UFE).toBe(0);
    expect(period.cu.CoreOI).toBeCloseTo(base.cu.CoreOI, 9);
  });

  it("leaves a gain that is the exceptional gain to UOI", () => {
    // Britannia FY23: a 375.6 gain filed as both.
    const period = withLoss(40, -40);
    expect(period.cu.UFE).toBe(0);
    expect(period.cu.CoreOI).toBeCloseTo(base.cu.CoreOI, 9);
  });

  it("still books a loss the exceptional items cannot contain", () => {
    expect(withLoss(-10, 20).cu.UFE).toBeCloseTo(15, 9);
  });
});

describe("operating-cost bridge — finance income is not operating income (real recast)", () => {
  // TCS-shaped: Other Income (60) includes a directly reported Interest
  // Income line (45). Core OI excludes it (it sits in NFE), so the bridge must.
  const withIncome = (overrides: Record<string, number> = {}): RawPeriodData => ({
    ...makePeriod("2025-03-31"),
    raw_metric_values: {
      ...makePeriod("2025-03-31").raw_metric_values,
      "Other Income__ProfitLoss": 60,
      "Interest Income__ProfitLoss": 45,
      "Cost of Material Consumed__ProfitLoss": 400,
      "Employee Benefits / Salaries & other Staff Cost__ProfitLoss": 150,
      "Depreciation and Amortization__ProfitLoss": 40,
      "Other Expenses__ProfitLoss": 170,
      ...overrides,
    },
  });

  it("nets directly reported finance income out of the bridge's other operating income", () => {
    const period = computeRecastPeriod(withIncome(), DEFAULT_CONFIG);
    expect(period.is.FinanceIncome).toBe(45);
    // Only the non-finance remainder of Other Income is operating.
    expect(period.is.operatingCostBridge?.otherOperatingIncome).toBe(15);
  });

  it("still nets the proxy estimate when finance income has no line of its own (unchanged)", () => {
    // No interest line and no cash-flow interest: finance income falls to the
    // Other-Income proxy (rung 4), which was already netted before this fix.
    const period = computeRecastPeriod(withIncome({ "Interest Income__ProfitLoss": 0 }), DEFAULT_CONFIG);
    expect(period.is.FinanceIncomeRung).toBe(4);
    expect(period.is.FinanceIncome).toBeGreaterThan(0);
    expect(period.is.operatingCostBridge?.otherOperatingIncome).toBeCloseTo(60 - period.is.FinanceIncome, 10);
  });
});

describe("operating-cost bridge — extraordinary items filed after tax (real recast)", () => {
  // NTPC FY25-shaped: a regulatory-deferral movement filed as "Extraordinary
  // Items After Tax" sits in TCI and so in Core OI, outside every cost line.
  const bridgeResidual = (overrides: Record<string, number>) => {
    const raw = (end: string) => ({
      ...makePeriod(end),
      raw_metric_values: {
        ...makePeriod(end).raw_metric_values,
        "Cost of Material Consumed__ProfitLoss": 400,
        "Employee Benefits / Salaries & other Staff Cost__ProfitLoss": 150,
        "Depreciation and Amortization__ProfitLoss": 40,
        "Other Expenses__ProfitLoss": 170,
        ...(end === "2025-03-31" ? overrides : {}),
      },
    });
    const prev = computeRecastPeriod(raw("2024-03-31"), DEFAULT_CONFIG);
    const cur = computeRecastPeriod(raw("2025-03-31"), DEFAULT_CONFIG, prev);
    const summary = evaluateReconciliationResiduals({ recastData: [prev, cur], config: DEFAULT_CONFIG });
    return summary.checks.find((c) => c.key === "operating-cost-bridge" && c.periodEnd === "2025-03-31")!.residual!;
  };

  it("compares the after-tax extraordinary line on the bridge's after-tax side", () => {
    const without = bridgeResidual({});
    const withMovement = bridgeResidual({
      "Extraordinary Items After Tax__ProfitLoss": 50,
      "Total Comprehensive Income for the Year__ProfitLoss": 155,
    });
    expect(withMovement).toBeCloseTo(without, 9);
  });
});

describe("recast-ta-vs-raw — end-to-end fail-closed on real corrupt input", () => {
  it("confirms when reported asset subtotals reconcile to recast TA (real recast)", () => {
    const { check, cur } = reconcile();
    // Sanity: the debug fields came out of the REAL extractRecastDebug, not a
    // hand-built object — proving the check is wired to the genuine pipeline.
    expect(cur.recastDebug?.rawCurrentAssets).toBe(400);
    expect(cur.recastDebug?.rawNonCurrentAssets).toBe(600);
    expect(check).toBeDefined();
    expect(check?.residual).toBeCloseTo(0, 6);
    expect(check?.status).toBe("confirmed");
  });

  it("fails closed when a reported asset SUBTOTAL is corrupted — the case the old tautology missed", () => {
    // Drop Total Current Assets by 150 (400 → 250). The reported subtotals now
    // sum to 850, diverging from recast bs.TA = 1000 (still read from the intact
    // "Total Assets" line). The OLD bs.TA-vs-raw-TA check would compare 1000 vs
    // 1000 and see nothing; the rebased composition check catches it.
    const { summary, check, cur } = reconcile({ "Total Current Assets__BalanceSheet": 250 });
    expect(cur.bs.TA).toBe(1000); // Total Assets line intact → bs.TA unchanged
    expect(cur.recastDebug?.rawCurrentAssets).toBe(250);
    expect(check?.status).toBe("failed");
    expect(check!.ratio).toBeGreaterThan(0.05);
    expect(summary.status).toBe("failed");
  });

  it("fails closed when the reported Total Assets line itself is corrupted (real recast)", () => {
    // The audit's literal ask: corrupt raw Total Assets (+20%). bs.TA now reads
    // 1200 while the untouched subtotals still sum to 1000 → divergence fires.
    const { summary, check, cur } = reconcile({ "Total Assets__BalanceSheet": 1200 });
    expect(cur.bs.TA).toBe(1200);
    expect(cur.recastDebug?.rawCurrentAssets).toBe(400);
    expect(cur.recastDebug?.rawNonCurrentAssets).toBe(600);
    expect(check?.status).toBe("failed");
    expect(summary.status).toBe("failed");
  });
});
