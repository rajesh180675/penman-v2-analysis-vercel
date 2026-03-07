import { describe, expect, it } from "vitest";
import { CanonicalOutputRegistry, ConsistencyViolation, computeDirtySurplus, detectPeriodEventFlags, calibrateMonitoringTriggers, firewallCheck } from "../v3Analytics";
import { DEFAULT_CONFIG, RecastPeriod } from "../types";

const mkPeriod = (year: number, pm: number, re: number, cse: number): RecastPeriod => ({
  period_end: `${year}-03-31`,
  bs: {
    TA: 1000, CSE: cse, MI: 0, FA: 100, FO: 50, OA: 900, OL: 250,
    OL_TradePayables: 50, OL_OtherCurrentLiabilities: 40, OL_ProvisionsCurrent: 0, OL_ProvisionsLongTerm: 0,
    OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0, OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 0,
    NOA: 650, NFO: -50, DTL: 0, PensionObl: 0, OL_ex_DTL: 250, Goodwill: 0,
    CurrentAssets: 300, CurrentLiabilities: 200, Inventory: 40, TradeReceivables: 60, TradePayables: 50,
    PPE: 250, LIFO_reserve: 0, separationScore: 90,
    OA_PPE: 250, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0, OA_Inventory: 40,
    OA_TradeReceivables: 60, OA_DTA: 0, OA_CWIP: 0, OA_Other: 550,
  },
  is: {
    Sales: 1000, TaxExpense: 20, taxRate: 0.25, PAT: 120, OCI: 0, TCI: 120, TCI_NCI: 0,
    CNI: 120, FinanceCost: 5, FinanceIncome: 1, FinanceIncomeRung: 1,
    PreferredDividend: 0, NFE: 3, OI: 123, OtherItems: 0, OI_from_sales: 123, MII: 0, COGS: 600,
  },
  cu: { UOI: 0, CoreOI: 123, UFE: 0, CoreNFE: 3, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
  cf: {
    CFO: 140, Capex: 30, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0,
    InterestReceived: 0, DividendReceived: 0, FCF_accounting: 90, FCF_cash: 110,
    d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 140,
  },
  ratios: {
    ROCE: 0.2, RNOA: 0.18, NBC: 0.04, SPREAD: 0.14, FLEV: 0.2, PM: pm, ATO: 1.1, SalesPM: pm,
    ATO_star: 1.1, OtherItemsRatio: 0, ROCE_bridge_residual: 0, io: 0.07, ROOA: 0.18, OLLEV: 0.3, OLSPREAD: 0.02, RNOA_check: 0,
    ROTCE: 0.2, MSR: 0.15, CoreSalesPM: pm, CoreOtherItems_OA: 0, UOI_OA: 0, CoreNBC: 0.04, UFE_NFO: 0,
    CoreSPREAD: 0.14, ROCE_eq16_reconstructed: 0.2, ROCE_eq16_error: 0, eq16_step1_residual: 0, eq16_step2_residual: 0,
    eq16_step3_residual: 0, eq16_flag: "OK", eq16_diagnosis: null, ROOA_spec: 0.18, imputed_io_spec: 0.07,
    required_return_per_sales: 0.05, value_creating_margin: 0.03, CSE_eq8_check: 0, CSE_eq8_error_pct: 0,
    current_ratio: 1.5, quick_ratio: 1.2, days_receivable: 20, days_payable: 18, days_inventory: 15, cash_conversion_cycle: 17,
    accrual_ratio_bs: 0.02, accrual_ratio_cf: 0.01, cash_conversion_ratio: 0.8, interest_coverage: 10,
    NOA_growth: 0.05, CNI_growth: 0.04, OI_growth: 0.04, Sales_growth: 0.05, noaSmall: false, separationScore: 90,
    accrual_regime: "NORMAL", dirty_surplus: 0, dirty_surplus_pct_cse: 0,
  },
  ri: { RE: re, ReOI: re * 0.95 },
  quality: {
    piotroski_roa: 1, piotroski_delta_roa: 1, piotroski_cfo: 1, piotroski_accrual: 1, piotroski_leverage: 1,
    piotroski_liquidity: 1, piotroski_dilution: 1, piotroski_margin: 1, piotroski_turnover: 1, piotroski_total: 8,
    beneish_dsri: 1, beneish_gmi: 1, beneish_aqi: 1, beneish_sgi: 1, beneish_depi: 1, beneish_sgai: 1, beneish_lvgi: 1,
    beneish_tata: 0, beneish_mscore: -2.2, altman_wc_ta: 0.2, altman_re_ta: 0.3, altman_ebit_ta: 0.2, altman_bve_tl: 1.5,
    altman_s_ta: 1.0, altman_zprime: 3.4,
  },
});

describe("Supplementary Path A controls", () => {
  it("enforces canonical registry consistency", () => {
    const r = new CanonicalOutputRegistry();
    r.register("g_effective", 0.05, "S-10.5");
    expect(() => r.register("g_effective", 0.08, "S-14.1")).toThrow(ConsistencyViolation);
  });

  it("calibrates PM trigger on clean period when latest is PM outlier", () => {
    const periods = [
      mkPeriod(2022, 0.24, 80, 500),
      mkPeriod(2023, 0.25, 82, 560),
      mkPeriod(2024, 0.26, 84, 620),
      mkPeriod(2025, 0.60, 86, 680),
    ];
    const ds = computeDirtySurplus(periods, DEFAULT_CONFIG.ke);
    const flags = detectPeriodEventFlags(periods, ds, 0.5, 1.0);
    const out = calibrateMonitoringTriggers(periods, flags, undefined, DEFAULT_CONFIG);
    expect(out.pm_base).toBeLessThan(0.4);
    expect(out.pm_warning).toBeCloseTo(out.pm_base * 0.85, 6);
  });

  it("detects audit marker leakage", () => {
    const violations = firewallCheck("Summary: V3 §14 Composite Confidence: 48/100 ✓ intact");
    expect(violations.length).toBeGreaterThan(0);
  });
});
