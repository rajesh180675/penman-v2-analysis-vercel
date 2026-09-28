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

  it("still fails closed when a component is genuinely missing from the source", () => {
    // Drop 150 of trade payables: 250 / 400 = 0.63, below the 0.7 floor.
    const { check } = olCheck({ "Sundry Creditors__BalanceSheet": 0 });
    expect(check?.status).toBe("failed");
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
