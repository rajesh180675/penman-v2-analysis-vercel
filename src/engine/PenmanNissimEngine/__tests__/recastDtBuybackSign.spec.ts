/* ================================================================
   Regression: recast d_t net-distribution buyback sign (#82).

   d_t (net distribution to common owners) must ADD share buybacks —
   they return cash to owners exactly like dividends — and SUBTRACT
   equity issuance (cash received). recast.ts previously subtracted
   buybacks (d_t = Div - Issued - Buyback), a latent sign flip that was
   harmless only because Capitaline's fixed CF template carries no
   buyback row (ShareBuybacks always resolved to 0).

   These tests drive a NON-ZERO buyback through the full
   computeRecastPeriod path so the corrected sign is live and locked:
   a future refactor reintroducing the old sign flips d_t by 2x Buyback
   and fails here. We deliberately avoid asserting a hardcoded cf.d_t —
   the value must come out of the real picker → recast pipeline.
================================================================ */

import { describe, expect, it } from "vitest";
import { computeRecastPeriod } from "../../PenmanNissimEngine";
import { DEFAULT_CONFIG, RawPeriodData } from "../../types";

/**
 * A buyback-active period. The CF lines map as:
 *   Dividend Paid           -> DividendPaid  = |−30| = 30  (cash OUT to owners)
 *   Proceeds from Issue ...  -> EquityIssued = 50          (cash IN from owners)
 *   Buyback of Shares        -> ShareBuybacks= |−100| = 100 (cash OUT to owners)
 * so the correct net distribution is d_t = Div + Buyback − Issued = 80.
 */
function makeBuybackPeriod(overrides: Record<string, number> = {}): RawPeriodData {
  return {
    company_id: "BUYBACK",
    period_end: "2025-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000,
      "Total Stockholders' Equity__BalanceSheet": 600,
      "Total Equity__BalanceSheet": 600,
      "Minority Interest__BalanceSheet": 0,
      "Revenue From Operations(Net)__ProfitLoss": 900,
      "Profit Before Tax__ProfitLoss": 140,
      "Tax Expenses__ProfitLoss": 35,
      "Profit After Tax__ProfitLoss": 105,
      "Total Comprehensive Income for the Year__ProfitLoss": 105,
      "Finance Cost__ProfitLoss": 10,
      "Other Income__ProfitLoss": 5,
      "Net Cash from Operating Activities__CashFlow": 120,
      "Purchased of Fixed Assets__CashFlow": -30,
      "Dividend Paid__CashFlow": -30,
      "Proceeds from Issue of shares (incl share premium)__CashFlow": 50,
      "Buyback of Shares__CashFlow": -100,
      ...overrides,
    },
  };
}

describe("recast d_t buyback sign (#82)", () => {
  it("adds buybacks to net distribution: d_t = DividendPaid + ShareBuybacks − EquityIssued", () => {
    const recast = computeRecastPeriod(makeBuybackPeriod(), DEFAULT_CONFIG);

    // Guard: the buyback must actually have flowed through the mapping,
    // else the d_t assertion below would pass vacuously (0-buyback case).
    expect(recast.cf.ShareBuybacks).toBe(100);
    expect(recast.cf.DividendPaid).toBe(30);
    expect(recast.cf.EquityIssued).toBe(50);

    // Corrected sign: 30 + 100 − 50 = 80.
    expect(recast.cf.d_t).toBe(80);

    // Regression guard: the old buggy formula (Div − Issued − Buyback)
    // would have produced −120. Pin the sign so it cannot silently revert.
    expect(recast.cf.d_t).not.toBe(-120);
  });

  it("matches the closed-form Div + Buyback − Issued across varied magnitudes", () => {
    const recast = computeRecastPeriod(
      makeBuybackPeriod({
        "Dividend Paid__CashFlow": -12,
        "Proceeds from Issue of shares (incl share premium)__CashFlow": 200,
        "Buyback of Shares__CashFlow": -45,
      }),
      DEFAULT_CONFIG,
    );

    const { DividendPaid, ShareBuybacks, EquityIssued, d_t } = recast.cf;
    expect(d_t).toBe(DividendPaid + ShareBuybacks - EquityIssued);
    // 12 + 45 − 200 = −143 (a net raise: issuance dominates).
    expect(d_t).toBe(-143);
  });

  it("collapses to Dividend − Issued when no buyback row is present (Capitaline reality)", () => {
    const raw = makeBuybackPeriod();
    delete raw.raw_metric_values["Buyback of Shares__CashFlow"];

    const recast = computeRecastPeriod(raw, DEFAULT_CONFIG);

    expect(recast.cf.ShareBuybacks).toBe(0);
    // With ShareBuybacks = 0 the corrected and old formulas coincide:
    // 30 − 50 = −20. This is the byte-identical golden-data path.
    expect(recast.cf.d_t).toBe(-20);
  });
});
