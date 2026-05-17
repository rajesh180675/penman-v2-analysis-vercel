import { describe, expect, it } from "vitest";
import { computeValuation } from "../PenmanNissimEngine";
import { DEFAULT_CONFIG, RecastPeriod } from "../types";

/**
 * Phase J2 — equity-side fail-closed when latest CSE ≤ 0.
 * Vodafone Idea-shaped fixture: sustained negative net worth from
 * accumulated losses, but enterprise-side NOA / NFO remain positive
 * because the company still operates a network (capex base) funded
 * largely by debt.
 */
function vodafoneShaped(
  period_end: string,
  values: { CSE: number; NOA: number; NFO: number; CNI: number; OI: number },
): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: values.NOA + Math.max(0, -values.NFO),
      CSE: values.CSE,
      MI: 0,
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
      FinanceCost: 200,
      FinanceIncome: 0,
      FinanceIncomeRung: 1,
      PreferredDividend: 0,
      NFE: 200,
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
      CoreNFE: 200,
      ExceptionalItemsAfterTax: 0,
      OCITotal: 0,
    },
    cf: {
      CFO: 100,
      Capex: 200,
      DividendPaid: 0,
      EquityIssued: 0,
      ShareBuybacks: 0,
      InterestReceived: 0,
      DividendReceived: 0,
      FCF_accounting: -100,
      FCF_cash: -50,
      d_t: 0,
      d_t_formula: 0,
      d_t_discrepancy: 0,
      EBITDA: 100,
    },
  };
}

describe("Phase J2 — equity-side fail-closed on negative net worth", () => {
  it("nulls V_RE_CV1/2/3 and per-share equity values when latest CSE ≤ 0", () => {
    // Five periods of progressively deeper negative equity, ending at -20000 Cr
    const periods: RecastPeriod[] = [
      vodafoneShaped("2021-03-31", { CSE: -5000, NOA: 2_50_000, NFO: 2_55_000, CNI: -8000, OI: -1000 }),
      vodafoneShaped("2022-03-31", { CSE: -8000, NOA: 2_30_000, NFO: 2_38_000, CNI: -6500, OI: -800 }),
      vodafoneShaped("2023-03-31", { CSE: -12000, NOA: 2_20_000, NFO: 2_32_000, CNI: -5000, OI: 200 }),
      vodafoneShaped("2024-03-31", { CSE: -15000, NOA: 2_10_000, NFO: 2_25_000, CNI: -4500, OI: 500 }),
      vodafoneShaped("2025-03-31", { CSE: -20000, NOA: 2_00_000, NFO: 2_20_000, CNI: -3500, OI: 800 }),
    ];

    const cfg = { ...DEFAULT_CONFIG, shares_outstanding: 65_00_00_00_000, market_price: 7.5 };
    const out = computeValuation(periods, 0.12, 0.10, 0.04, cfg);

    expect(out.equityModelsBlocked).toBe(true);
    expect(out.equityBlockedReason).toMatch(/negative|≤ 0/i);
    expect(out.V_RE_CV1).toBeNull();
    expect(out.V_RE_CV2).toBeNull();
    expect(out.V_RE_CV3).toBeNull();
    // Enterprise-side V_ReOI still publishes; downstream consumers can
    // anchor on it for distressed-name analysis.
    expect(out.V_ReOI_CV01).toBeTypeOf("number");
    expect(out.V_ReOI_CV02).toBeTypeOf("number");
    expect(out.V_ReOI_CV03).toBeTypeOf("number");

    // Growth accounting decomposition uses CSE0 — also nulled.
    expect(out.V_no_growth).toBeNull();
    expect(out.growthValue).toBeNull();
    expect(out.growthFraction).toBeNull();

    // Per-share equity-side values nulled, enterprise-side preserved.
    expect(out.perShare?.intrinsic_re_per_share).toBeNull();
    expect(out.perShare?.intrinsic_ddm_per_share).toBeNull();
    expect(out.perShare?.intrinsic_aeg_per_share).toBeNull();
    expect(out.perShare?.intrinsic_fcfe_per_share).toBeNull();
    expect(out.perShare?.implied_pb_re).toBeNull();
    expect(out.perShare?.implied_pe_re).toBeNull();
    expect(out.perShare?.margin_of_safety_re).toBeNull();
    expect(out.perShare?.implied_growth_rate).toBeNull();
    // FCFF per-share is enterprise-level (NOPAT-anchored) — still published.
    expect(out.perShare?.intrinsic_fcff_per_share).toBeTypeOf("number");
    expect(out.perShare?.intrinsic_reoi_per_share).toBeTypeOf("number");
  });

  it("computes equity-side normally when latest CSE > 0 (no regression)", () => {
    // Same shape, but one extra healthy period at the end so latest CSE flips positive
    const periods: RecastPeriod[] = [
      vodafoneShaped("2022-03-31", { CSE: 5000, NOA: 2_30_000, NFO: 2_25_000, CNI: -1000, OI: 1000 }),
      vodafoneShaped("2023-03-31", { CSE: 6000, NOA: 2_20_000, NFO: 2_14_000, CNI: 800, OI: 1500 }),
      vodafoneShaped("2024-03-31", { CSE: 7500, NOA: 2_10_000, NFO: 2_02_500, CNI: 1200, OI: 2000 }),
      vodafoneShaped("2025-03-31", { CSE: 9000, NOA: 2_00_000, NFO: 1_91_000, CNI: 1500, OI: 2200 }),
    ];

    const cfg = { ...DEFAULT_CONFIG, shares_outstanding: 65_00_00_00_000, market_price: 7.5 };
    const out = computeValuation(periods, 0.12, 0.10, 0.04, cfg);

    expect(out.equityModelsBlocked).toBe(false);
    expect(out.V_RE_CV1).toBeTypeOf("number");
    expect(out.V_RE_CV3).toBeTypeOf("number");
    expect(out.V_no_growth).toBeTypeOf("number");
    expect(out.growthFraction).toBeTypeOf("number");
    expect(out.perShare?.intrinsic_re_per_share).toBeTypeOf("number");
  });

  it("blocks even when only the latest period is negative (single-period flip)", () => {
    // History is healthy but latest year wiped out equity (e.g., one-time
    // impairment + AGR demand). Equity-side models still must skip
    // because they anchor on latest CSE.
    const periods: RecastPeriod[] = [
      vodafoneShaped("2022-03-31", { CSE: 8000, NOA: 2_30_000, NFO: 2_22_000, CNI: 800, OI: 1500 }),
      vodafoneShaped("2023-03-31", { CSE: 10000, NOA: 2_20_000, NFO: 2_10_000, CNI: 1000, OI: 1800 }),
      vodafoneShaped("2024-03-31", { CSE: 12000, NOA: 2_10_000, NFO: 1_98_000, CNI: 1200, OI: 2000 }),
      vodafoneShaped("2025-03-31", { CSE: -2000, NOA: 2_00_000, NFO: 2_02_000, CNI: -16000, OI: -1500 }),
    ];

    const out = computeValuation(periods, 0.12, 0.10, 0.04, DEFAULT_CONFIG);
    expect(out.equityModelsBlocked).toBe(true);
    expect(out.V_RE_CV3).toBeNull();
    expect(out.V_ReOI_CV03).toBeTypeOf("number");
  });
});
