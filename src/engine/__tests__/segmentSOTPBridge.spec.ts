import { describe, expect, it } from "vitest";
import { segmentDataToDefinitions, classifySegmentSector, runSOTPFromSegmentData } from "../segmentSOTPBridge";
import { parseSegmentFinanceHTML } from "../segmentParser";
import { readFileSync } from "fs";
import { resolve } from "path";
import { RecastPeriod } from "../types";

const fixturesDir = resolve(__dirname, "../../../public/data/companies/ITC");

const mkPeriod = (): RecastPeriod => {
  const TA = 100000;
  const FA = 20000;
  const OA = TA - FA;
  const FO = 15000;
  const OL = 30000;
  const NOA = OA - OL;
  const NFO = FO - FA;
  const CSE = NOA - NFO;
  return {
    period_end: "2025-03-31",
    bs: {
      TA, CSE, MI: 0, FA, FO, OA, OL,
      OL_TradePayables: 8000, OL_OtherCurrentLiabilities: 4000, OL_ProvisionsCurrent: 0,
      OL_ProvisionsLongTerm: 0, OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 500, OL_OtherNonCurrentLiabilities: 17500,
      NOA, NFO, DTL: 500, PensionObl: 0, OL_ex_DTL: OL - 500, Goodwill: 0,
      CurrentAssets: 40000, CurrentLiabilities: 25000, Inventory: 8000, TradeReceivables: 9000,
      TradePayables: 8000, PPE: 25000, LIFO_reserve: 0, separationScore: 85,
      OA_PPE: 25000, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 8000, OA_TradeReceivables: 9000, OA_DTA: 0, OA_CWIP: 0,
      OA_Other: OA - 42000,
    },
    is: {
      Sales: 73000, TaxExpense: 5000, taxRate: 0.25, PAT: 20000, OCI: 0, TCI: 20000, TCI_NCI: 0,
      CNI: 20000, FinanceCost: 1000, FinanceIncome: 3000, FinanceIncomeRung: 1,
      PreferredDividend: 0, NFE: -2000, OI: 25000, OtherItems: 0,
      OI_from_sales: 25000, MII: 0, COGS: 35000,
    },
    cu: { UOI: 0, CoreOI: 25000, UFE: 0, CoreNFE: -2000, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: {
      CFO: 22000, Capex: 5000, DividendPaid: 15000, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 3000, DividendReceived: 0, FCF_accounting: 17000, FCF_cash: 20000,
      d_t: 15000, d_t_formula: 15000, d_t_discrepancy: 0, EBITDA: 30000,
    },
    ratios: {
      ROCE: 0.45, RNOA: 0.50, NBC: 0.04, SPREAD: 0.46, FLEV: -0.1, PM: 0.34, ATO: 1.5,
      SalesPM: 0.34, ATO_star: 1.2, OtherItemsRatio: 0, ROCE_bridge_residual: 0,
      io: 0.05, ROOA: 0.35, OLLEV: 0.3, OLSPREAD: 0.05, RNOA_check: 0.50,
      ROTCE: 0.45, MSR: 1, CoreSalesPM: 0.34, CoreOtherItems_OA: 0, UOI_OA: 0,
      CoreNBC: 0.04, UFE_NFO: 0, CoreSPREAD: 0.46, ROCE_eq16_reconstructed: 0.45,
      ROCE_eq16_error: 0, eq16_step1_residual: 0, eq16_step2_residual: 0,
      eq16_step3_residual: 0, eq16_flag: "OK" as const, eq16_diagnosis: null,
      ROOA_spec: 0.35, imputed_io_spec: 0.05, required_return_per_sales: 0.04,
      value_creating_margin: 0.30, CSE_eq8_check: 0, CSE_eq8_error_pct: 0,
      current_ratio: 1.6, quick_ratio: 1.3, days_receivable: 40, days_payable: 35,
      days_inventory: 45, cash_conversion_cycle: 50, accrual_ratio_bs: 0.02,
      accrual_ratio_cf: 0.01, cash_conversion_ratio: 0.85, interest_coverage: 25,
      NOA_growth: 0.05, CNI_growth: 0.08, OI_growth: 0.08, Sales_growth: 0.10,
      noaSmall: false, separationScore: 85, accrual_regime: "NORMAL" as const,
      dirty_surplus: 0, dirty_surplus_pct_cse: 0, freeOL: 0, interestBearingOL: 0,
      OLLEV_check: 0, RNOA_vs_OLLEV_residual: 0,
    employeeCostRatio: null,
    },
    ri: { RE: 5000, ReOI: 6000 },
    quality: {
      piotroski_roa: 1, piotroski_delta_roa: 1, piotroski_cfo: 1, piotroski_accrual: 1,
      piotroski_leverage: 1, piotroski_liquidity: 1, piotroski_dilution: 1,
      piotroski_margin: 1, piotroski_turnover: 1, piotroski_total: 9,
      beneish_dsri: 1, beneish_gmi: 1, beneish_aqi: 1, beneish_sgi: 1, beneish_depi: 1,
      beneish_sgai: 1, beneish_lvgi: 1, beneish_tata: 0, beneish_mscore: -2.8,
      altman_wc_ta: 0.15, altman_re_ta: 0.30, altman_ebit_ta: 0.25, altman_bve_tl: 2.5,
      altman_s_ta: 0.73, altman_zprime: 4.2,
    },
  };
};

describe("segmentSOTPBridge", () => {
  describe("classifySegmentSector", () => {
    it("classifies ITC segments correctly", () => {
      expect(classifySegmentSector("FMCG - CIGARETTES")).toBe("consumer-staples");
      expect(classifySegmentSector("FMCG - OTHERS")).toBe("consumer-staples");
      expect(classifySegmentSector("HOTELS")).toBe("services");
      expect(classifySegmentSector("AGRI BUSINESS")).toBe("commodities");
      expect(classifySegmentSector("PAPERBOARDS, PAPER AND PACKAGING")).toBe("industrials");
    });

    it("classifies other sector types", () => {
      expect(classifySegmentSector("Retail Banking")).toBe("services");
      expect(classifySegmentSector("Cement Division")).toBe("industrials");
      expect(classifySegmentSector("Oil Refining")).toBe("commodities");
    });

    it("defaults to industrials for unknown", () => {
      expect(classifySegmentSector("OTHERS")).toBe("industrials");
    });
  });

  describe("segmentDataToDefinitions", () => {
    it("converts ITC segment data to definitions with correct profit shares", () => {
      const html = readFileSync(resolve(fixturesDir, "SegmentFinance_.xls"), "utf-8");
      const segData = parseSegmentFinanceHTML(html);
      expect(segData).not.toBeNull();

      const { definitions, timeSeries } = segmentDataToDefinitions(segData!);

      // Should have definitions for profitable segments
      expect(definitions.length).toBeGreaterThanOrEqual(4);

      // Profit shares should sum to ~1
      const totalShare = definitions.reduce((s, d) => s + d.operatingProfitShare, 0);
      expect(totalShare).toBeCloseTo(1, 1);

      // Cigarettes should be the dominant segment
      const cig = definitions.find(d => d.name.includes("CIGARETTES"));
      expect(cig).toBeDefined();
      expect(cig!.operatingProfitShare).toBeGreaterThan(0.4);

      // Time series should exist for all segments
      expect(timeSeries.length).toBe(6);
      expect(timeSeries[0].years.length).toBe(15);
    });
  });

  describe("runSOTPFromSegmentData", () => {
    it("produces enhanced SOTP result from parsed data", () => {
      const html = readFileSync(resolve(fixturesDir, "SegmentFinance_.xls"), "utf-8");
      const segData = parseSegmentFinanceHTML(html);
      expect(segData).not.toBeNull();

      const period = mkPeriod();
      const result = runSOTPFromSegmentData(segData!, period, 0.13);

      expect(result.dataSource).toBe("parsed");
      expect(result.latestYear).toBe("FY2025");
      expect(result.segments.length).toBeGreaterThanOrEqual(4);
      expect(result.operatingSum).toBeGreaterThan(0);
      expect(result.totalEnterpriseValue).toBeGreaterThan(0);
      expect(result.conglomerateDiscountPct).toBeGreaterThan(0);
      expect(result.segmentTimeSeries.length).toBe(6);
      expect(result.segmentAssets).toBeDefined();
    });
  });
});
