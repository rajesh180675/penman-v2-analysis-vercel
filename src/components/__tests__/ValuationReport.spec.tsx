import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ValuationReport from "../ValuationReport";
import type { EngineConfig, RecastPeriod } from "../../engine/types";
import { DEFAULT_CONFIG } from "../../engine/types";
import { CroreShares, INRAbsolute } from "../../engine/types/units";

function mkPeriod(period_end: string): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000, CSE: 600, MI: 0, FA: 150, FO: 150, OA: 850, OL: 250,
      NOA: 600, NFO: 0, DTL: 0, PensionObl: 0, OL_ex_DTL: 250, Goodwill: 0,
      CurrentAssets: 400, CurrentLiabilities: 200, Inventory: 90, TradeReceivables: 110, TradePayables: 80,
      PPE: 320, LIFO_reserve: 0, separationScore: 90,
      OA_PPE: 320, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 90, OA_TradeReceivables: 110, OA_DTA: 0, OA_CWIP: 0, OA_Other: 330,
      OL_TradePayables: 80, OL_OtherCurrentLiabilities: 50, OL_ProvisionsCurrent: 10, OL_ProvisionsLongTerm: 10,
      OL_CurrentTaxLiabilities: 10, OL_NonCurrentTaxLiabilities: 10, OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 90,
    },
    is: {
      Sales: 900, TaxExpense: 30, taxRate: 0.25, PAT: 90, OCI: 0, TCI: 90, TCI_NCI: 0,
      CNI: 90, FinanceCost: 10, FinanceIncome: 0, FinanceIncomeRung: 1, PreferredDividend: 0,
      relatedPartyTransactions: 0, auditorChange: false, qualifiedOpinion: false,
      NFE: 10, OI: 100, OtherItems: 0, OI_from_sales: 100, MII: 0, COGS: 600,
    },
    cu: {
      UOI: 0, CoreOI: 100, UFE: 0, CoreNFE: 10, ExceptionalItemsAfterTax: 0, OCITotal: 0,
    },
    cf: {
      CFO: 120, Capex: 40, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 0, DividendReceived: 0, DebtProceeds: 0, DebtRepayment: 0,
      FCF_accounting: 60, FCF_cash: 80, d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 140,
    },
    ratios: {
      ROCE: 0.15, RNOA: 0.12, NBC: 0.03, SPREAD: 0.09, FLEV: 0.2,
      PM: 0.11, ATO: 1.1, SalesPM: 0.11, ATO_star: 1.1,
      OtherItemsRatio: 0, ROCE_bridge_residual: 0, io: 0, ROOA: 0.12, OLLEV: 0.2, OLSPREAD: 0.12, RNOA_check: 0.12,
      ROTCE: 0.15, MSR: 0, CoreSalesPM: 0.11, CoreOtherItems_OA: 0, UOI_OA: 0, CoreNBC: 0.03, UFE_NFO: 0,
      CoreSPREAD: 0.09, ROCE_eq16_reconstructed: 0.15, ROCE_eq16_error: 0, eq16_step1_residual: 0, eq16_step2_residual: 0,
      eq16_step3_residual: 0, eq16_flag: "OK", eq16_diagnosis: null, ROOA_spec: 0.12, imputed_io_spec: 0,
      required_return_per_sales: 0.05, value_creating_margin: 0.06, CSE_eq8_check: 0, CSE_eq8_error_pct: 0,
      current_ratio: 2, quick_ratio: 1.5, days_receivable: 40, days_payable: 30, days_inventory: 35, cash_conversion_cycle: 45,
      accrual_ratio_bs: 0.02, accrual_ratio_cf: 0.01, cash_conversion_ratio: 0.9, interest_coverage: 10,
      NOA_growth: 0.03, CNI_growth: 0.04, OI_growth: 0.05, Sales_growth: 0.04,
      noaSmall: false, separationScore: 90, accrual_regime: "NORMAL", dirty_surplus: 0, dirty_surplus_pct_cse: 0,
      freeOL: 0.3, interestBearingOL: 0, OLLEV_check: 0.2, RNOA_vs_OLLEV_residual: 0,
    employeeCostRatio: null,
    },
    ri: { RE: 20, ReOI: 18 },
    quality: {
      piotroski_roa: 1, piotroski_delta_roa: 1, piotroski_cfo: 1, piotroski_accrual: 1,
      piotroski_leverage: 1, piotroski_liquidity: 1, piotroski_dilution: 1, piotroski_margin: 1,
      piotroski_turnover: 1, piotroski_total: 9,
      beneish_dsri: 1, beneish_gmi: 1, beneish_aqi: 1, beneish_sgi: 1, beneish_depi: 1, beneish_sgai: 1,
      beneish_lvgi: 1, beneish_tata: 0, beneish_mscore: -2.5,
      altman_wc_ta: 0.2, altman_re_ta: 0.2, altman_ebit_ta: 0.2, altman_bve_tl: 1, altman_s_ta: 1, altman_zprime: 3,
    },
  } as RecastPeriod;
}

describe("ValuationReport", () => {
  it("discloses guarded floor for floored incremental ROIC scenario values", () => {
    const data = [mkPeriod("2024-03-31"), mkPeriod("2025-03-31")];
    const config: EngineConfig = {
      ...DEFAULT_CONFIG,
      shares_outstanding: CroreShares(100),
      market_price: INRAbsolute(50),
    };

    const html = renderToStaticMarkup(
      <ValuationReport
        data={data}
        config={config}
        analysisStatus={null}
      />,
    );

    expect(html).toContain("guarded floor");
  });
});
