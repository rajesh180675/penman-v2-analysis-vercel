import { describe, expect, it } from "vitest";
import { runIdentityAssertions } from "../identityTests";
import { RecastPeriod } from "../types";

function mkPeriod(period_end: string, scale: number): RecastPeriod {
  const TA = 1000 * scale;
  const FA = 200 * scale;
  const OA = TA - FA;
  const FO = 150 * scale;
  const OL = 350 * scale;
  const NOA = OA - OL;
  const NFO = FO - FA;
  const CSE = NOA - NFO;
  const CNI = 120 * scale;
  const NFE = 20 * scale;
  const MII = 0;
  const OI = CNI + NFE + MII;
  return {
    period_end,
    bs: {
      TA,
      CSE,
      MI: 0,
      FA,
      FO,
      OA,
      OL,
      OL_TradePayables: 100,
      OL_OtherCurrentLiabilities: 50,
      OL_ProvisionsCurrent: 20,
      OL_ProvisionsLongTerm: 30,
      OL_CurrentTaxLiabilities: 10,
      OL_NonCurrentTaxLiabilities: 10,
      OL_DeferredTaxLiabilitiesNet: 5,
      OL_OtherNonCurrentLiabilities: 125,
      NOA,
      NFO,
      DTL: 5,
      PensionObl: 0,
      OL_ex_DTL: OL - 5,
      Goodwill: 0,
      CurrentAssets: 500,
      CurrentLiabilities: 250,
      Inventory: 100,
      TradeReceivables: 100,
      TradePayables: 100,
      PPE: 300,
      LIFO_reserve: 0,
      separationScore: 90,
    },
    is: {
      Sales: 800 * scale,
      TaxExpense: 40,
      taxRate: 0.25,
      PAT: 100,
      OCI: 0,
      TCI: 120,
      TCI_NCI: 0,
      CNI,
      FinanceCost: 30,
      FinanceIncome: 10,
      FinanceIncomeRung: 2,
      PreferredDividend: 0,
      NFE,
      OI,
      OtherItems: 0,
      OI_from_sales: OI,
      MII,
      COGS: 500,
    },
    cu: {
      UOI: 0,
      CoreOI: OI,
      UFE: 0,
      CoreNFE: NFE,
      ExceptionalItemsAfterTax: 0,
      OCITotal: 0,
    },
    cf: {
      CFO: 150,
      Capex: 40,
      DividendPaid: 20,
      EquityIssued: 0,
      ShareBuybacks: 0,
      InterestReceived: 5,
      DividendReceived: 0,
      FCF_accounting: 0,
      FCF_cash: 110,
      d_t: 20,
      d_t_formula: 20,
      d_t_discrepancy: 0,
      EBITDA: 140,
    },
    ratios: {
      ROCE: 0.12,
      RNOA: 0.15,
      NBC: 0.05,
      SPREAD: 0.1,
      FLEV: 0.2,
      PM: 0.12,
      ATO: 1.25,
      SalesPM: 0.12,
      ATO_star: 1.0,
      OtherItemsRatio: 0,
      ROCE_bridge_residual: 0,
      io: 1,
      ROOA: 0.13,
      OLLEV: 0.4,
      OLSPREAD: 0.06,
      RNOA_check: 0.15,
      ROTCE: 0.11,
      MSR: 1,
      CoreSalesPM: 0.12,
      CoreOtherItems_OA: 0,
      UOI_OA: 0,
      CoreNBC: 0.05,
      UFE_NFO: 0,
      CoreSPREAD: 0.1,
      ROCE_eq16_reconstructed: 0.12,
      ROCE_eq16_error: 0,
      required_return_per_sales: 0.04,
      value_creating_margin: 0.08,
      CSE_eq8_check: 100,
      CSE_eq8_error_pct: 0,
      current_ratio: 2,
      quick_ratio: 1.6,
      days_receivable: 45,
      days_payable: 35,
      days_inventory: 50,
      cash_conversion_cycle: 60,
      accrual_ratio_bs: 0,
      accrual_ratio_cf: 0,
      cash_conversion_ratio: 1,
      interest_coverage: 6,
      NOA_growth: 0.02,
      CNI_growth: 0.03,
      OI_growth: 0.03,
      Sales_growth: 0.04,
      noaSmall: false,
      separationScore: 90,
    },
    ri: { RE: 20, ReOI: 30 },
    quality: {
      piotroski_roa: 1,
      piotroski_delta_roa: 1,
      piotroski_cfo: 1,
      piotroski_accrual: 1,
      piotroski_leverage: 1,
      piotroski_liquidity: 1,
      piotroski_dilution: 1,
      piotroski_margin: 1,
      piotroski_turnover: 1,
      piotroski_total: 9,
      beneish_dsri: 1,
      beneish_gmi: 1,
      beneish_aqi: 1,
      beneish_sgi: 1,
      beneish_depi: 1,
      beneish_sgai: 1,
      beneish_lvgi: 1,
      beneish_tata: 0,
      beneish_mscore: -2,
      altman_wc_ta: 0.2,
      altman_re_ta: 0.3,
      altman_ebit_ta: 0.2,
      altman_bve_tl: 0.7,
      altman_s_ta: 1,
      altman_zprime: 3.2,
    },
  };
}

describe("identity assertions A1-A9", () => {
  it("passes synthetic balanced periods", () => {
    const p1 = mkPeriod("2024-03-31", 1);
    const p2 = mkPeriod("2025-03-31", 1.05);
    p2.cf.FCF_accounting = p2.is.OI - (p2.bs.NOA - p1.bs.NOA);
    p2.cf.d_t_formula = p2.cf.FCF_accounting - p2.is.NFE + (p2.bs.NFO - p1.bs.NFO);
    p2.ratios!.RNOA = p2.is.OI / ((p2.bs.NOA + p1.bs.NOA) / 2);
    p2.ratios!.ROCE = p2.is.CNI / ((p2.bs.CSE + p1.bs.CSE) / 2);
    p2.ratios!.ATO = p2.is.Sales / ((p2.bs.NOA + p1.bs.NOA) / 2);
    p2.ratios!.SalesPM = p2.is.OI / p2.is.Sales;
    p2.ratios!.OtherItemsRatio = 0;
    p2.ratios!.FLEV = p2.bs.NFO / p2.bs.CSE;
    p2.ratios!.NBC = p2.is.NFE / ((p2.bs.NFO + p1.bs.NFO) / 2);
    p2.ratios!.SPREAD = p2.ratios!.RNOA - p2.ratios!.NBC;

    const report = runIdentityAssertions([p1, p2]);
    expect(report.failed).toBe(0);
  });
});
