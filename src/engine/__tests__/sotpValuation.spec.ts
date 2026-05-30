import { describe, expect, it } from "vitest";
import {
  buildSOTPValuation,
  estimateConglomerateDiscount,
  SOTP_PRESETS,
  SegmentDefinition,
} from "../sotpValuation";
import { RecastPeriod } from "../types";

const mkPeriod = (operatingIncome: number, noa: number, taxRate: number): RecastPeriod => {
  const TA = 1000;
  const FA = 200;
  const OA = TA - FA;
  const FO = 150;
  const OL = 300;
  const NOA = noa || (OA - OL);
  const NFO = FO - FA;
  const CSE = NOA - NFO;
  return {
    period_end: "2025-03-31",
    bs: {
      TA, CSE, MI: 0, FA, FO, OA, OL,
      OL_TradePayables: 80, OL_OtherCurrentLiabilities: 40, OL_ProvisionsCurrent: 0,
      OL_ProvisionsLongTerm: 0, OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 5, OL_OtherNonCurrentLiabilities: 175,
      NOA, NFO, DTL: 5, PensionObl: 0, OL_ex_DTL: OL - 5, Goodwill: 0,
      CurrentAssets: 400, CurrentLiabilities: 250, Inventory: 80, TradeReceivables: 90,
      TradePayables: 80, PPE: 250, LIFO_reserve: 0, separationScore: 85,
      OA_PPE: 250, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 80, OA_TradeReceivables: 90, OA_DTA: 0, OA_CWIP: 0,
      OA_Other: OA - 420,
    },
    is: {
      Sales: 800, TaxExpense: 30, taxRate, PAT: 100, OCI: 0, TCI: 100, TCI_NCI: 0,
      CNI: 100, FinanceCost: 10, FinanceIncome: 5, FinanceIncomeRung: 1,
      PreferredDividend: 0, NFE: 5, OI: operatingIncome, OtherItems: 0,
      OI_from_sales: operatingIncome, MII: 0, COGS: 500,
    },
    cu: { UOI: 0, CoreOI: operatingIncome, UFE: 0, CoreNFE: 5, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: {
      CFO: 120, Capex: 30, DividendPaid: 15, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 0, DividendReceived: 0, FCF_accounting: 90, FCF_cash: 110,
      d_t: 15, d_t_formula: 15, d_t_discrepancy: 0, EBITDA: 130,
    },
    ratios: {
      ROCE: 0.15, RNOA: 0.18, NBC: 0.05, SPREAD: 0.13, FLEV: 0.2, PM: 0.12, ATO: 1.5,
      SalesPM: 0.12, ATO_star: 1.2, OtherItemsRatio: 0, ROCE_bridge_residual: 0,
      io: 0.05, ROOA: 0.16, OLLEV: 0.3, OLSPREAD: 0.05, RNOA_check: 0.18,
      ROTCE: 0.17, MSR: 0.1, CoreSalesPM: 0.12, CoreOtherItems_OA: 0, UOI_OA: 0,
      CoreNBC: 0.05, UFE_NFO: 0, CoreSPREAD: 0.13, ROCE_eq16_reconstructed: 0.15,
      ROCE_eq16_error: 0, eq16_step1_residual: 0, eq16_step2_residual: 0,
      eq16_step3_residual: 0, eq16_flag: "OK" as const, eq16_diagnosis: null,
      ROOA_spec: 0.16, imputed_io_spec: 0.05, required_return_per_sales: 0.04,
      value_creating_margin: 0.08, CSE_eq8_check: 0, CSE_eq8_error_pct: 0,
      current_ratio: 1.6, quick_ratio: 1.3, days_receivable: 40, days_payable: 35,
      days_inventory: 45, cash_conversion_cycle: 50, accrual_ratio_bs: 0.02,
      accrual_ratio_cf: 0.01, cash_conversion_ratio: 0.85, interest_coverage: 12,
      NOA_growth: 0.03, CNI_growth: 0.04, OI_growth: 0.04, Sales_growth: 0.05,
      noaSmall: false, separationScore: 85, accrual_regime: "NORMAL" as const,
      dirty_surplus: 0, dirty_surplus_pct_cse: 0, freeOL: 0, interestBearingOL: 0,
      OLLEV_check: 0, RNOA_vs_OLLEV_residual: 0,
    employeeCostRatio: null,
    },
    ri: { RE: 20, ReOI: 25 },
    quality: {
      piotroski_roa: 1, piotroski_delta_roa: 1, piotroski_cfo: 1, piotroski_accrual: 1,
      piotroski_leverage: 1, piotroski_liquidity: 1, piotroski_dilution: 1,
      piotroski_margin: 1, piotroski_turnover: 1, piotroski_total: 8,
      beneish_dsri: 1, beneish_gmi: 1, beneish_aqi: 1, beneish_sgi: 1, beneish_depi: 1,
      beneish_sgai: 1, beneish_lvgi: 1, beneish_tata: 0, beneish_mscore: -2.4,
      altman_wc_ta: 0.15, altman_re_ta: 0.25, altman_ebit_ta: 0.18, altman_bve_tl: 1.8,
      altman_s_ta: 1.2, altman_zprime: 3.6,
    },
  };
};

describe("SOTP valuation", () => {
  describe("estimateConglomerateDiscount", () => {
    it("returns zero discount for single segment", () => {
      const { discount } = estimateConglomerateDiscount([
        { name: "Cement", operatingProfitShare: 1, sectorTemplate: "industrials" },
      ]);
      expect(discount).toBe(0);
    });

    it("returns moderate discount for two segments", () => {
      const { discount } = estimateConglomerateDiscount([
        { name: "Cigarettes", operatingProfitShare: 0.6, sectorTemplate: "consumer-staples" },
        { name: "Hotels", operatingProfitShare: 0.4, sectorTemplate: "services" },
      ]);
      expect(discount).toBeGreaterThan(0);
      expect(discount).toBeLessThan(0.12);
    });

    it("returns higher discount for many diverse segments", () => {
      const { discount } = estimateConglomerateDiscount([
        { name: "A", operatingProfitShare: 0.2, sectorTemplate: "consumer-staples" },
        { name: "B", operatingProfitShare: 0.2, sectorTemplate: "industrials" },
        { name: "C", operatingProfitShare: 0.2, sectorTemplate: "commodities" },
        { name: "D", operatingProfitShare: 0.4, sectorTemplate: "services" },
      ]);
      expect(discount).toBeGreaterThanOrEqual(0.10);
    });

    it("reduces discount when one segment dominates", () => {
      const segments: SegmentDefinition[] = [
        { name: "Cigarettes", operatingProfitShare: 0.80, sectorTemplate: "consumer-staples" },
        { name: "Hotels", operatingProfitShare: 0.20, sectorTemplate: "services" },
      ];
      const { discount } = estimateConglomerateDiscount(segments);
      // 2 segments → base 5%, but 80% dominance → 0.6x multiplier
      expect(discount).toBeLessThan(0.05);
    });
  });

  describe("buildSOTPValuation", () => {
    it("values ITC segments correctly", () => {
      const period = mkPeriod(150, 500, 0.25);
      const result = buildSOTPValuation(period, SOTP_PRESETS.ITC!, 0.13);

      expect(result.segments).toHaveLength(5);
      expect(result.operatingSum).toBeGreaterThan(0);
      expect(result.conglomerateDiscountPct).toBeGreaterThan(0);
      expect(result.discountedSum).toBeLessThan(result.operatingSum);
      expect(result.totalEnterpriseValue).toBeGreaterThan(0);
      expect(result.explanation.length).toBeGreaterThan(5);
    });

    it("single segment = no discount", () => {
      const period = mkPeriod(100, 400, 0.25);
      const result = buildSOTPValuation(period, [
        { name: "Cement", operatingProfitShare: 1, sectorTemplate: "industrials" },
      ], 0.13);

      expect(result.conglomerateDiscountPct).toBe(0);
      expect(result.discountedSum).toBe(result.operatingSum);
    });

    it("splits operating profit by segment share", () => {
      const period = mkPeriod(200, 500, 0.25);
      const result = buildSOTPValuation(period, [
        { name: "A", operatingProfitShare: 0.6, sectorTemplate: "consumer-staples" },
        { name: "B", operatingProfitShare: 0.4, sectorTemplate: "services" },
      ], 0.12);

      expect(result.segments[0]!.operatingProfit).toBeCloseTo(120, 0); // 200 * 0.6
      expect(result.segments[1]!.operatingProfit).toBeCloseTo(80, 0);  // 200 * 0.4
    });

    it("allocates NOA proportionally", () => {
      const period = mkPeriod(100, 600, 0.25);
      const result = buildSOTPValuation(period, [
        { name: "A", operatingProfitShare: 0.6, sectorTemplate: "consumer-staples" },
        { name: "B", operatingProfitShare: 0.4, sectorTemplate: "services" },
      ], 0.12);

      const totalAllocated = result.segments.reduce((s, seg) => s + seg.allocatedNOA, 0);
      expect(totalAllocated).toBeCloseTo(600, 0);
    });

    it("returns null impliedMultiple when denominator is negative", () => {
      const period = mkPeriod(-50, 300, 0.25);
      const result = buildSOTPValuation(period, [
        { name: "A", operatingProfitShare: 1, sectorTemplate: "industrials" },
      ], 0.12);

      expect(result.segments[0]!.impliedMultiple).toBeNull();
    });
  });
});
