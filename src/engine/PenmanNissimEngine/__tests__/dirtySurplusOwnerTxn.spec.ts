import { describe, expect, it } from "vitest";
import { computeRatios } from "../ratiosResidual";
import { DEFAULT_CONFIG, RecastPeriod } from "../../types";

/**
 * S-5.1 dirty-surplus regression.
 *
 * Clean-surplus identity: ΔCSE = CNI − (Div + Buy − Iss). The dirty-surplus
 * residual (ΔCSE NOT explained by income + owner transactions) is therefore
 *   ΔCSE − CNI + Div + Buy − Iss.
 * Dividends and buybacks both return cash to owners (add back); share issuance
 * raises equity without transiting the P&L (subtract). The prior form used only
 * `+ DividendPaid`, so any issuance or buyback was misclassified as dirty
 * surplus (on ITC this overstated FY23/FY24 by 2–4% of CSE).
 *
 * Triangulated to prove the added terms are LIVE: the fixture satisfies clean
 * surplus exactly once owner transactions are included (net payout nets to
 * zero), so the corrected residual is ~0% — "clean". The old dividends-only
 * form would have reported 6% of CSE (Div / prevCSE = 30/500) → dirty.
 */

function mkPeriod(args: {
  cse: number;
  cni: number;
  dividendPaid: number; // positive magnitude (recast stores Math.abs)
  equityIssued: number; // positive issue proceeds
  shareBuybacks: number; // positive magnitude (recast stores Math.abs)
}): RecastPeriod {
  const { cse, cni, dividendPaid, equityIssued, shareBuybacks } = args;
  return {
    period_end: "2025-03-31",
    bs: { CSE: cse, NOA: 800, NFO: 200, OA: 880, OL: 80, TA: 1000, FA: 100, FO: 0, MI: 0,
      OL_TradePayables: 0, OL_OtherCurrentLiabilities: 0, OL_ProvisionsCurrent: 0,
      OL_ProvisionsLongTerm: 0, OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 0,
      CurrentAssets: 300, CurrentLiabilities: 200, Inventory: 0, TradeReceivables: 0, TradePayables: 0 },
    is: { Sales: 1000, COGS: 580, CNI: cni, OI: 200, NFE: 10, OI_from_sales: 200,
      OtherItems: 0, MII: 0 },
    cu: { UOI: 0, CoreOI: 200, UFE: 0, CoreNFE: 10, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: { CFO: 180, DividendPaid: dividendPaid, EquityIssued: equityIssued,
      ShareBuybacks: shareBuybacks },
  } as unknown as RecastPeriod;
}

describe("dirty-surplus residual nets owner capital transactions", () => {
  it("treats issuance/buybacks as owner transactions, not dirty surplus", () => {
    // Net payout to owners = Div + Buy − Iss = 30 + 20 − 50 = 0.
    // Clean surplus then requires ΔCSE = CNI = 100 → prev 500, cur 600.
    const prev = mkPeriod({ cse: 500, cni: 0, dividendPaid: 0, equityIssued: 0, shareBuybacks: 0 });
    const cur = mkPeriod({ cse: 600, cni: 100, dividendPaid: 30, equityIssued: 50, shareBuybacks: 20 });

    const r = computeRatios(cur, prev, DEFAULT_CONFIG);

    expect(r.dirty_surplus_pct_cse).not.toBeNull();
    // Corrected residual ≈ 0: ΔCSE(100) − CNI(100) + Div(30) + Buy(20) − Iss(50) = 0.
    expect(Math.abs(r.dirty_surplus_pct_cse!)).toBeLessThan(1e-9);
    // Guard: the old dividends-only form would have read 30/500 = 6%.
    // This asserts the issuance/buyback terms are actually applied.
    expect(Math.abs(r.dirty_surplus_pct_cse!)).toBeLessThan(0.06 - 1e-6);
  });

  it("still flags genuine dirty surplus (OCI that bypasses income)", () => {
    // No owner transactions; ΔCSE exceeds CNI by 40 (e.g. revaluation reserve).
    const prev = mkPeriod({ cse: 500, cni: 0, dividendPaid: 0, equityIssued: 0, shareBuybacks: 0 });
    const cur = mkPeriod({ cse: 640, cni: 100, dividendPaid: 0, equityIssued: 0, shareBuybacks: 0 });

    const r = computeRatios(cur, prev, DEFAULT_CONFIG);

    expect(r.dirty_surplus_pct_cse).not.toBeNull();
    // ΔCSE(140) − CNI(100) = 40 → 40/500 = 8% genuine dirty surplus, still caught.
    expect(r.dirty_surplus_pct_cse!).toBeCloseTo(0.08, 6);
  });
});
