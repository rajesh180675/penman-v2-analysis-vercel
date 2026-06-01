import { describe, expect, it } from "vitest";
import { computeValuation } from "../PenmanNissimEngine";
import { DEFAULT_CONFIG, RecastPeriod } from "../types";
import { CroreShares, INRAbsolute } from "../types/units";

/**
 * Minority-interest equity bridge regression.
 *
 * kw weights the operating entity across CSE+MI+NFO
 * (deriveKwFromStructure), so the enterprise→equity bridge for the COMMON
 * shareholder must subtract BOTH net debt (NFO) AND the minority claim (MI).
 * Before the fix, reoiPer / fcffPer / V_ReOI_CV0x subtracted only NFO0,
 * overstating per-common-share value by the minority interest for any firm
 * with non-wholly-owned subsidiaries.
 *
 * The two fixtures are byte-identical except for MI at the anchor period, and
 * MI feeds NONE of pvReOI / CV_W_3 / EV_FCFF (those are NOA/OI-anchored), so
 * the per-share value MUST drop by exactly MI0/shares.
 */
function healthyPeriod(
  period_end: string,
  values: { CSE: number; MI: number; NOA: number; NFO: number; CNI: number; OI: number },
): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: values.NOA + Math.max(0, -values.NFO) + values.MI,
      CSE: values.CSE,
      MI: values.MI,
      FA: Math.max(0, -values.NFO),
      FO: Math.max(0, values.NFO),
      OA: values.NOA,
      OL: 0,
      OL_TradePayables: 0,
      OL_OtherCurrentLiabilities: 0,
      OL_ProvisionsCurrent: 0,
      OL_ProvisionsLongTerm: 0,
      OL_CurrentTaxLiabilities: 0,
      OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 0,
      OL_OtherNonCurrentLiabilities: 0,
      NOA: values.NOA,
      NFO: values.NFO,
      DTL: 0,
      PensionObl: 0,
      OL_ex_DTL: 0,
      Goodwill: 0,
      CurrentAssets: 200,
      CurrentLiabilities: 100,
      Inventory: 20,
      TradeReceivables: 30,
      TradePayables: 0,
      PPE: values.NOA * 0.8,
      LIFO_reserve: 0,
      separationScore: 90,
      OA_PPE: values.NOA * 0.8,
      OA_ROU: 0,
      OA_Goodwill: 0,
      OA_OtherIntangibles: 0,
      OA_Inventory: 20,
      OA_TradeReceivables: 30,
      OA_DTA: 0,
      OA_CWIP: 0,
      OA_Other: values.NOA * 0.2,
    },
    is: {
      Sales: 4000,
      TaxExpense: 0,
      taxRate: 0,
      PAT: values.CNI,
      OCI: 0,
      TCI: values.CNI,
      TCI_NCI: 0,
      CNI: values.CNI,
      FinanceCost: 100,
      FinanceIncome: 0,
      FinanceIncomeRung: 1,
      PreferredDividend: 0,
      NFE: 100,
      OI: values.OI,
      OtherItems: 0,
      OI_from_sales: values.OI,
      MII: 0,
      COGS: 2500,
    },
    cu: {
      UOI: 0,
      CoreOI: values.OI,
      UFE: 0,
      CoreNFE: 100,
      ExceptionalItemsAfterTax: 0,
      OCITotal: 0,
    },
    cf: {
      CFO: 600,
      Capex: 200,
      DividendPaid: 100,
      EquityIssued: 0,
      ShareBuybacks: 0,
      InterestReceived: 0,
      DividendReceived: 0,
      FCF_accounting: 400,
      FCF_cash: 400,
      d_t: 100,
      d_t_formula: 100,
      d_t_discrepancy: 0,
      EBITDA: 900,
    },
  };
}

describe("minority-interest equity bridge", () => {
  const cfg = { ...DEFAULT_CONFIG, shares_outstanding: CroreShares(1000), market_price: INRAbsolute(50) };
  const MI0 = 4000;

  function run(mi: number) {
    // MI lives ONLY at the anchor (period 0); later periods keep MI=0 so the
    // ReOI series (NOA/OI-driven) is identical across both runs.
    const periods: RecastPeriod[] = [
      healthyPeriod("2022-03-31", { CSE: 12000, MI: mi, NOA: 20000, NFO: 8000, CNI: 1400, OI: 2000 }),
      healthyPeriod("2023-03-31", { CSE: 13000, MI: 0, NOA: 21000, NFO: 8000, CNI: 1500, OI: 2100 }),
      healthyPeriod("2024-03-31", { CSE: 14000, MI: 0, NOA: 22000, NFO: 8000, CNI: 1600, OI: 2200 }),
      healthyPeriod("2025-03-31", { CSE: 15000, MI: 0, NOA: 23000, NFO: 8000, CNI: 1700, OI: 2300 }),
    ];
    return computeValuation(periods, 0.12, 0.10, 0.04, cfg);
  }

  it("drops common per-share value by exactly MI0/shares when minorities are present", () => {
    const sh = 1000;
    const noMi = run(0);
    const withMi = run(MI0);

    expect(noMi.perShare?.intrinsic_reoi_per_share).toBeTypeOf("number");
    expect(withMi.perShare?.intrinsic_reoi_per_share).toBeTypeOf("number");

    const reoiDrop = noMi.perShare!.intrinsic_reoi_per_share! - withMi.perShare!.intrinsic_reoi_per_share!;
    const fcffDrop = noMi.perShare!.intrinsic_fcff_per_share! - withMi.perShare!.intrinsic_fcff_per_share!;

    expect(reoiDrop).toBeCloseTo(MI0 / sh, 6);
    expect(fcffDrop).toBeCloseTo(MI0 / sh, 6);
  });

  it("keeps the V_ReOI_CV03 aggregate consistent with the per-share number", () => {
    const sh = 1000;
    const withMi = run(MI0);
    // The aggregate common-equity value divided by shares must equal the
    // published per-share value — the identity the fix preserves.
    expect(withMi.V_ReOI_CV03! / sh).toBeCloseTo(withMi.perShare!.intrinsic_reoi_per_share!, 6);
  });

  it("leaves CSE-anchored common models (RE) untouched by minority interest", () => {
    // RE / FCFE anchor on CSE and CNI (CNI already nets out minority income),
    // so they must be byte-identical regardless of MI.
    const noMi = run(0);
    const withMi = run(MI0);
    expect(withMi.perShare?.intrinsic_re_per_share).toBeCloseTo(
      noMi.perShare!.intrinsic_re_per_share!,
      6,
    );
    expect(withMi.V_RE_CV3).toBeCloseTo(noMi.V_RE_CV3!, 6);
    // Operating-entity value (EV_ReOI) excludes both NFO and MI — also unchanged.
    expect(withMi.EV_ReOI!).toBeCloseTo(noMi.EV_ReOI!, 6);
  });
});
