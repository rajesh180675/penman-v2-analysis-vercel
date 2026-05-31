import { describe, expect, it } from "vitest";
import { computeRatios } from "../ratiosResidual";
import { DEFAULT_CONFIG, RecastPeriod } from "../../types";

/**
 * ROTCE equity-basis regression (#81a, Option A).
 *
 * ROTCE = Return on Total Common + Minority Equity. The equity claim on
 * operations is CSE + MI (= NOA − NFO by the financing identity NOA = CSE +
 * NFO + MI), and the matching return to those holders is CNI + MII:
 *   ROTCE = (CNI + MII) / avg(CSE + MI).
 *
 * Two prior forms were wrong:
 *  - The shipped code used OI / avg(NOA + MI). NOA already contains MI, so the
 *    denominator double-counted minority interest (CSE + NFO + 2·MI).
 *  - The audit's proposed "NOA + MI → NOA" fix would have made ROTCE = OI /
 *    avg(NOA) ≡ RNOA — a vacuous duplicate of an existing operating-asset return.
 *
 * The fixture pins all three apart: new ROTCE 0.20, RNOA 0.18 (proves the metric
 * is NOT a RNOA duplicate), old double-count form 0.17 (proves the fix is live).
 */

function mkPeriod(args: {
  cse: number;
  mi: number;
  nfo: number;
  noa: number; // must satisfy noa = cse + nfo + mi
  cni: number;
  mii: number;
  oi: number;
}): RecastPeriod {
  const { cse, mi, nfo, noa, cni, mii, oi } = args;
  return {
    period_end: "2025-03-31",
    bs: { CSE: cse, NOA: noa, NFO: nfo, OA: noa + 80, OL: 80, TA: cse + mi + nfo + 200,
      FA: 100, FO: 100 + nfo, MI: mi,
      OL_TradePayables: 0, OL_OtherCurrentLiabilities: 0, OL_ProvisionsCurrent: 0,
      OL_ProvisionsLongTerm: 0, OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 0,
      CurrentAssets: 300, CurrentLiabilities: 200, Inventory: 0, TradeReceivables: 0, TradePayables: 0 },
    is: { Sales: 1000, COGS: 580, CNI: cni, OI: oi, NFE: 10, OI_from_sales: oi,
      OtherItems: 0, MII: mii },
    cu: { UOI: 0, CoreOI: oi, UFE: 0, CoreNFE: 10, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: { CFO: 180, DividendPaid: 0, EquityIssued: 0, ShareBuybacks: 0 },
  } as unknown as RecastPeriod;
}

describe("ROTCE charges comprehensive income to the common+minority equity base", () => {
  it("uses (CNI+MII)/avg(CSE+MI) — not OI/avg(NOA+MI), and is distinct from RNOA", () => {
    // NOA = CSE + NFO + MI holds in both periods (800=500+250+50, 900=600+250+50).
    const prev = mkPeriod({ cse: 500, mi: 50, nfo: 250, noa: 800, cni: 0, mii: 0, oi: 0 });
    const cur  = mkPeriod({ cse: 600, mi: 50, nfo: 250, noa: 900, cni: 90, mii: 30, oi: 153 });

    const r = computeRatios(cur, prev, DEFAULT_CONFIG);

    // avg(CSE+MI) = avg(650, 550) = 600; (CNI+MII) = 120 → ROTCE = 0.20.
    expect(r.ROTCE).not.toBeNull();
    expect(r.ROTCE!).toBeCloseTo(0.20, 6);

    // RNOA = OI/avgNOA = 153/850 = 0.18. ROTCE must NOT equal it — otherwise the
    // metric is a redundant restatement of RNOA (the audit's trap).
    expect(r.RNOA!).toBeCloseTo(0.18, 6);
    expect(r.ROTCE!).not.toBeCloseTo(r.RNOA!, 4);

    // Guard against the old double-count form OI/avg(NOA+MI) = 153/900 = 0.17.
    expect(r.ROTCE!).not.toBeCloseTo(0.17, 4);
  });
});
