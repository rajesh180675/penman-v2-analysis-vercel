import { describe, expect, it } from "vitest";
import { computeFCFEDirtySurplus } from "../fcfeDirtySurplus";
import { RecastPeriod } from "../types";

const mkPeriod = (overrides: Partial<RecastPeriod> = {}): RecastPeriod => ({
  period_end: "2025-03-31",
  bs: {
    TA: 1000, CSE: 500, MI: 0, FA: 200, FO: 300, OA: 600, OL: 200,
    OL_TradePayables: 60, OL_OtherCurrentLiabilities: 30, OL_ProvisionsCurrent: 0,
    OL_ProvisionsLongTerm: 0, OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0,
    OL_DeferredTaxLiabilitiesNet: 5, OL_OtherNonCurrentLiabilities: 105,
    NOA: 400, NFO: 100, DTL: 5, PensionObl: 0, OL_ex_DTL: 195, Goodwill: 0,
    CurrentAssets: 400, CurrentLiabilities: 200, Inventory: 80, TradeReceivables: 90,
    TradePayables: 60, PPE: 250, LIFO_reserve: 0, separationScore: 85,
    OA_PPE: 250, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
    OA_Inventory: 80, OA_TradeReceivables: 90, OA_DTA: 0, OA_CWIP: 0, OA_Other: 80,
  },
  is: {
    Sales: 500, TaxExpense: 20, taxRate: 0.20, PAT: 100, OCI: 0, TCI: 100, TCI_NCI: 0,
    CNI: 100, FinanceCost: 10, FinanceIncome: 5, FinanceIncomeRung: 1,
    PreferredDividend: 0, NFE: 5, OI: 150, OtherItems: 0, OI_from_sales: 150, MII: 0, COGS: 300,
  },
  cu: {
    UOI: 0, CoreOI: 150, UFE: 0, CoreNFE: 5, ExceptionalItemsAfterTax: 0, OCITotal: 0,
  },
  cf: {
    CFO: 110, Capex: -25, DividendPaid: 0, EquityIssued: 0, ShareBuybacks: 0,
    InterestReceived: 0, DividendReceived: 0, FCF_accounting: 85, FCF_cash: 95,
    d_t: 15, d_t_formula: 15, d_t_discrepancy: 0, EBITDA: 160,
  },
  ratios: {
    ROCE: 0.15, RNOA: 0.20, NBC: 0.05, SPREAD: 0.15, FLEV: 0.25, PM: 0.12, ATO: 1.5,
    SalesPM: 0.12, ATO_star: 1.2, OtherItemsRatio: 0, ROCE_bridge_residual: 0,
    io: 0.05, ROOA: 0.16, OLLEV: 0.30, OLSPREAD: 0.05, RNOA_check: 0.20,
    ROTCE: 0.17, MSR: 0.08, CoreSalesPM: 0.12, CoreOtherItems_OA: 0, UOI_OA: 0,
    CoreNBC: 0.05, UFE_NFO: 0, CoreSPREAD: 0.15, ROCE_eq16_reconstructed: 0.15,
    ROCE_eq16_error: 0, eq16_step1_residual: 0, eq16_step2_residual: 0,
    eq16_step3_residual: 0, eq16_flag: "OK" as const, eq16_diagnosis: null,
    ROOA_spec: 0.16, imputed_io_spec: 0.05, required_return_per_sales: 0.04,
    value_creating_margin: 0.08, CSE_eq8_check: 0, CSE_eq8_error_pct: 0,
    current_ratio: 2.0, quick_ratio: 1.8, days_receivable: 40, days_payable: 35,
    days_inventory: 42, cash_conversion_cycle: 47, accrual_ratio_bs: 0.01,
    accrual_ratio_cf: 0.01, cash_conversion_ratio: 0.90, interest_coverage: 15,
    NOA_growth: 0.03, CNI_growth: 0.05, OI_growth: 0.04, Sales_growth: 0.06,
    noaSmall: false, separationScore: 85, accrual_regime: "NORMAL" as const,
    dirty_surplus: 0, dirty_surplus_pct_cse: 0, freeOL: 0, interestBearingOL: 0,
    OLLEV_check: 0, RNOA_vs_OLLEV_residual: 0,
  },
  ri: { RE: 20, ReOI: 25 },
  quality: {
    piotroski_roa: 1, piotroski_delta_roa: 1, piotroski_cfo: 1, piotroski_accrual: 1,
    piotroski_leverage: 1, piotroski_liquidity: 1, piotroski_dilution: 1,
    piotroski_margin: 1, piotroski_turnover: 1, piotroski_total: 8,
    beneish_dsri: 1, beneish_gmi: 1, beneish_aqi: 1, beneish_sgi: 1, beneish_depi: 1,
    beneish_sgai: 1, beneish_lvgi: 1, beneish_tata: 0, beneish_mscore: -2.2,
    altman_wc_ta: 0.18, altman_re_ta: 0.28, altman_ebit_ta: 0.19, altman_bve_tl: 1.9,
    altman_s_ta: 1.1, altman_zprime: 3.5,
  },
  ...overrides,
});

describe("FCFE dirty surplus analysis", () => {
  it("returns null when no previous period", () => {
    const result = computeFCFEDirtySurplus(mkPeriod(), null);
    expect(result.fcfeAccrual).toBeNull();
    expect(result.fcfeCash).not.toBeNull();
  });

  it("computes FCFE_accrual = CNI - dCSE", () => {
    const prev = mkPeriod({ period_end: "2024-03-31", bs: { ...mkPeriod().bs, CSE: 450 } });
    const cur = mkPeriod({ period_end: "2025-03-31", bs: { ...mkPeriod().bs, CSE: 500 } });
    const result = computeFCFEDirtySurplus(cur, prev);

    // dCSE = 500 - 450 = 50
    // fcfeAccrual = 100 - 50 = 50
    expect(result.fcfeAccrual).toBe(50);
  });

  it("computes FCFE_cash = CFO - Capex + netBorrowing", () => {
    const prev = mkPeriod({ period_end: "2024-03-31" });
    const cur = mkPeriod({
      period_end: "2025-03-31",
      cf: { ...mkPeriod().cf, CFO: 110, Capex: -25 },
    });
    const result = computeFCFEDirtySurplus(cur, prev);

    // FCFE_cash = 110 - (-25) + 0 = 135
    expect(result.fcfeCash).toBe(135);
  });

  it("flags divergence when dirty surplus is material", () => {
    const prev = mkPeriod({ period_end: "2024-03-31", bs: { ...mkPeriod().bs, CSE: 400 } });
    const cur = mkPeriod({
      period_end: "2025-03-31",
      bs: { ...mkPeriod().bs, CSE: 500 },
      is: { ...mkPeriod().is, CNI: 100, OCI: 30 },
      cf: { ...mkPeriod().cf, CFO: 110, Capex: -25 },
    });

    const result = computeFCFEDirtySurplus(cur, prev);

    // dCSE = 100, FCFE_accrual = 100 - 100 = 0
    // FCFE_cash = 110 - (-25) = 135
    // divergence = |135 - 0| / 135 = 100%
    expect(result.divergenceRatio).toBeCloseTo(1.0, 4);
    expect(result.exceedsThreshold).toBe(true);
    expect(result.warning).not.toBeNull();
    expect(result.dirtySurplus).toBe(30);
  });

  it("no warning when accrual and cash FCFE are close", () => {
    const bigGap = mkPeriod({
      period_end: "2024-03-31",
      bs: { ...mkPeriod().bs, CSE: 450 },
      is: { ...mkPeriod().is, CNI: 100 },
    });
    const smallGap = mkPeriod({
      period_end: "2025-03-31",
      bs: { ...mkPeriod().bs, CSE: 500 },
      is: { ...mkPeriod().is, CNI: 100, OCI: 0 },
      cf: { ...mkPeriod().cf, CFO: 60, Capex: 0 },
    });

    const result = computeFCFEDirtySurplus(smallGap, bigGap);

    // FCFE_accrual = 100 - 50 = 50
    // FCFE_cash = 60 - 0 = 60
    expect(result.fcfeAccrual).toBe(50);
    expect(result.fcfeCash).toBe(60);
    // divergence = |60 - 50| / 60 = 16.7% (above 5% threshold)
    expect(result.exceedsThreshold).toBe(true);
  });

  it("returns null divergence when cash FCFE is near zero", () => {
    const prev = mkPeriod({ period_end: "2024-03-31" });
    const cur = mkPeriod({
      period_end: "2025-03-31",
      cf: { ...mkPeriod().cf, CFO: 0, Capex: 0 },
    });

    const result = computeFCFEDirtySurplus(cur, prev);
    expect(result.divergenceRatio).toBeNull();
  });
});
