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

  it("raises COGS when inventory runs down", () => {
    const period = computeRecastPeriod(
      filed({ "Changes in Inventories of Finished Goods, Work-in-Progress and Stock-in-Trade__ProfitLoss": 140.61 }),
      DEFAULT_CONFIG,
    );
    expect(period.is.COGS).toBeCloseTo(3928.09, 6);
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
