import { describe, expect, it } from "vitest";
import { segmentDataToDefinitions, classifySegmentSector, runSOTPFromSegmentData, segmentTemplateFor, seriesCagr } from "../segmentSOTPBridge";
import { parseSegmentFinanceHTML, type SegmentData } from "../segmentParser";
import { declaredSectorTemplate } from "../valuationSectorTemplates";
import type { CompanyType, ValuationSectorTemplate } from "../types";

type SegmentTemplateId = Exclude<ValuationSectorTemplate, "auto">;
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { RecastPeriod } from "../types";
import { VALUATION_SECTOR_TEMPLATES } from "../valuationSectorTemplates";

// Raw .xls fixtures are gitignored — present locally, absent in CI.
const fixturesDir = resolve(__dirname, "../../../public/data/companies/ITC");
const itcSegmentXls = resolve(fixturesDir, "SegmentFinance_.xls");
const fixturesAvailable = existsSync(itcSegmentXls);

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
      // As the engine values a cement or steel company (the cyclical type's template).
      expect(classifySegmentSector("Cement Division")).toBe("commodities");
      expect(classifySegmentSector("Oil Refining")).toBe("commodities");
    });

    it("defaults to industrials for unknown, or to the fallback it is given", () => {
      expect(classifySegmentSector("OTHERS")).toBe("industrials");
      expect(classifySegmentSector("OTHERS", "telecom")).toBe("telecom");
    });

    it("matches whole words, not letters inside other words", () => {
      // "it" in Limited / Commodities / Securities / Utilities, "oil" in
      // Toiletries and "media" in Intermediates each classed a segment
      // as something it is not.
      expect(classifySegmentSector("NEELACHAL ISPAT NIGAM LIMITED")).toBe("commodities");
      expect(classifySegmentSector("COMMODITIES TRADING")).toBe("industrials");
      expect(classifySegmentSector("SECURITIES BROKING")).toBe("services");
      expect(classifySegmentSector("POWER UTILITIES")).toBe("utility");
      expect(classifySegmentSector("TOILETRIES")).toBe("consumer-staples");
      expect(classifySegmentSector("DYE INTERMEDIATES")).toBe("industrials");
      expect(classifySegmentSector("IT SERVICES")).toBe("services");
    });
  });

  describe("segmentTemplateFor: every segment the library values", () => {
    // Each company's latest-year segments as its export names them (Capitaline
    // truncates names at 35 characters), with the company type the library
    // gives it and the template that type declares.
    type Case = readonly [string, CompanyType, SegmentTemplateId | null, ReadonlyArray<readonly [string, SegmentTemplateId]>];
    const cases: readonly Case[] = [
      ["Asian Paints", "consumer", "consumer-staples", [["PAINTS", "paint"], ["HOME IMPROVEMENT", "consumer-staples"]]],
      ["Bharti Airtel", "telecom", "telecom", [
        ["MOBILE SERVICES", "telecom"], ["AIRTEL BUSINESS", "telecom"], ["PASSIVE INFRASTRUCTURE SERVICES%", "telecom"],
        ["HOMES SERVICES", "telecom"], ["DIGITAL TV SERVICES", "telecom"], ["OTHERS", "telecom"],
      ]],
      ["Dabur", "consumer", "consumer-staples", [
        ["CONSUMER CARE BUSINESS", "consumer-staples"], ["FOODS", "consumer-staples"], ["RETAIL BUSINESS", "retail"], ["OTHERS", "consumer-staples"],
      ]],
      ["Grasim", "industrial", null, [["CEMENT", "commodities"], ["FIBRE AND PULP", "industrials"], ["CHEMICALS", "industrials"], ["OTHERS", "industrials"]]],
      ["HUL", "consumer", "consumer-staples", [
        ["HOME CARE", "consumer-staples"], ["BEAUTY & WELLBEING", "consumer-staples"], ["PERSONAL PRODUCTS", "consumer-staples"],
        ["PACKAGED FOODS", "consumer-staples"], ["OTHERS", "consumer-staples"],
      ]],
      ["ITC", "conglomerate", null, [
        ["FMCG - CIGARETTES", "consumer-staples"], ["FMCG - OTHERS", "consumer-staples"], ["AGRI BUSINESS", "commodities"],
        ["PAPERBOARDS, PAPER AND PACKAGING", "industrials"], ["HOTELS", "services"], ["OTHERS", "industrials"],
      ]],
      ["Infosys", "it-services", "services", [
        ["FINANCIAL SERVICES", "services"], ["MANUFACTURING", "services"], ["ENERGY & UTILITIES, COMMUNICATION &", "services"],
        ["RETAIL, CONSUMER PACKAGED GOODS AND", "services"], ["TELECOM", "services"], ["HI-TECH", "services"],
        ["LIFE SCIENCES, HEALTHCARE AND INSUR", "services"], ["ALL OTHER SEGMENTS", "services"],
      ]],
      ["L&T", "conglomerate", null, [
        ["INFRASTRUCTURE", "industrials"], ["ENERGY PROJECTS", "industrials"], ["HI-TECH MANUFACTURING", "industrials"],
        ["IT & TECHNOLOGY SERVICES", "services"], ["DEVELOPMENT PROJECTS", "industrials"], ["OTHERS", "industrials"],
      ]],
      ["M&M", "cyclical", "commodities", [
        ["AUTOMOTIVE", "industrials"], ["FARM EQUIPMENT", "industrials"], ["INDUSTRIAL BUSINESSES AND CONSUMER", "industrials"],
      ]],
      ["NTPC", "utility", "utility", [["GENERATION OF ENERGY", "utility"], ["OTHERS", "utility"]]],
      ["Power Grid", "utility", "utility", [
        ["TRANSMISSION SERVICES", "utility"], ["CONSULTANCY SERVICES", "services"], ["TELECOM SERVICES", "telecom"],
      ]],
      ["Reliance", "conglomerate", null, [
        ["O2C", "commodities"], ["RETAIL", "retail"], ["DIGITAL SERVICES", "telecom"], ["OIL AND GAS", "commodities"], ["OTHERS", "industrials"],
      ]],
      ["TCS", "it-services", "services", [
        ["BANKING, FINANCIAL SERVICES & INSUR", "services"], ["MANUFACTURING", "services"], ["RETAIL AND CONSUMER PACKAGED GOODS", "services"],
        ["TELECOM, MEDIA AND ENTERTAINMENT", "services"], ["LIFE SCIENCES AND HEALTHCARE", "services"], ["OTHERS", "services"],
      ]],
      ["Tata Steel", "cyclical", "commodities", [
        ["TATA STEEL INDIA", "commodities"], ["NEELACHAL ISPAT NIGAM LIMITED", "commodities"], ["OTHER INDIAN OPERATIONS", "commodities"],
        ["OTHER TRADE RELATED OPERATIONS", "commodities"], ["SOUTH-EAST ASIAN OPERATIONS", "commodities"], ["TATA STEEL EUROPE", "commodities"],
      ]],
      ["Titan", "consumer", "consumer-staples", [
        ["JEWELLERY", "consumer-staples"], ["WATCHES", "consumer-staples"], ["EYECARE", "consumer-staples"], ["OTHERS", "consumer-staples"],
      ]],
    ];

    for (const [company, companyType, declaredTemplate, segments] of cases) {
      it(`${company}`, () => {
        // The declared template is what the company type gives, as the command center passes it.
        expect(declaredSectorTemplate(undefined, companyType)).toBe(declaredTemplate);
        for (const [name, expected] of segments) {
          expect([name, segmentTemplateFor(name, { companyType, declaredTemplate })]).toEqual([name, expected]);
        }
      });
    }
  });

  describe("segment growth", () => {
    const years = ["FY2025", "FY2024", "FY2023", "FY2022"];
    const segData = (series: Record<string, readonly number[]>): SegmentData => ({
      segmentationType: "business",
      segments: Object.keys(series),
      years,
      data: Object.fromEntries(Object.entries(series).map(([name, revenue]) => [name, Object.fromEntries(years.map((y, i) => [y, {
        revenue: revenue[i] ?? null, interSegmentRevenue: null, result: 100, assets: 1000, liabilities: null, capex: null, depreciation: null, nonCashExpenditure: null,
      }]))])),
      unallocated: {},
      totals: {},
    });

    it("reads the series latest first: a growing segment has a positive CAGR", () => {
      // FY2022 1,000 → FY2025 1,331: 10% a year.
      expect(seriesCagr([1331, 1210, 1100, 1000])).toBeCloseTo(0.1, 12);
      expect(seriesCagr([1000, 1100, 1210, 1331])).toBeCloseTo(1 / 1.1 - 1, 12);
    });

    it("grows a segment at half its CAGR, inside its template's band", () => {
      const { definitions } = segmentDataToDefinitions(segData({
        "PACKAGED FOODS": [1404.928, 1254.4, 1120, 1000], // CAGR 12% → 6%, held at the 5% cap
        "HOME CARE": [1157.625, 1102.5, 1050, 1000], // CAGR 5% → 2.5%, raised to the 3% floor
        "BEAUTY & WELLBEING": [1259.712, 1166.4, 1080, 1000], // CAGR 8% → 4%, inside the band
        "PERSONAL PRODUCTS": [800, 900, 1000, 1100], // shrinking → the floor
      }), 0, { companyType: "consumer", declaredTemplate: "consumer-staples" });
      const g = Object.fromEntries(definitions.map((d) => [d.name, d.terminalGrowthOverride]));
      const staples = VALUATION_SECTOR_TEMPLATES["consumer-staples"];
      expect(g["PACKAGED FOODS"]).toBe(staples.terminalGrowthCap);
      expect(g["HOME CARE"]).toBe(staples.terminalGrowthFloor);
      expect(g["BEAUTY & WELLBEING"]).toBeCloseTo(0.04, 9);
      expect(g["PERSONAL PRODUCTS"]).toBe(staples.terminalGrowthFloor);
    });

    it("leaves a segment with one year of revenue on its template's default", () => {
      const { definitions } = segmentDataToDefinitions(segData({ "PAINTS": [500], "OTHERS": [1331, 1210, 1100, 1000] }));
      expect(definitions.find((d) => d.name === "PAINTS")!.terminalGrowthOverride).toBeUndefined();
    });

    it("measures each year's growth against the year before it", () => {
      const { timeSeries } = segmentDataToDefinitions(segData({ "PACKAGED FOODS": [1331, 1210, 1100, 1000] }));
      const ts = timeSeries[0]!;
      expect(ts.revenueGrowth[0]).toBeCloseTo(0.1, 12); // FY2025 on FY2024
      expect(ts.revenueGrowth[3]).toBeNull(); // the oldest year has no predecessor
    });
  });

  describe("segmentDataToDefinitions", () => {
    it.skipIf(!fixturesAvailable)("converts ITC segment data to definitions with correct profit shares", () => {
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
      expect(timeSeries[0]!.years.length).toBe(15);
    });
  });

  describe("runSOTPFromSegmentData", () => {
    // Synthetic, so it runs where the gitignored .xls fixtures do not (CI).
    it("discounts every segment at the rate it is given, plus its template's adjustment", () => {
      const years = ["FY2025", "FY2024", "FY2023"];
      const row = (revenue: number, result: number, assets: number) => ({
        revenue, interSegmentRevenue: null, result, assets, liabilities: null, capex: null, depreciation: null, nonCashExpenditure: null,
      });
      const segData = {
        segmentationType: "business" as const,
        segments: ["CIGARETTES", "AGRI BUSINESS", "PAPERBOARDS"],
        years,
        data: {
          CIGARETTES: Object.fromEntries(years.map((y, i) => [y, row(30000 - i * 1000, 18000 - i * 500, 20000)])),
          "AGRI BUSINESS": Object.fromEntries(years.map((y, i) => [y, row(15000 - i * 500, 1500 - i * 50, 8000)])),
          PAPERBOARDS: Object.fromEntries(years.map((y, i) => [y, row(8000 - i * 300, 1200 - i * 40, 9000)])),
        },
        unallocated: {},
        totals: {},
      };
      const result = runSOTPFromSegmentData(segData, mkPeriod(), 0.11);
      expect(result.segments.map((s) => s.name).sort()).toEqual(["AGRI BUSINESS", "CIGARETTES", "PAPERBOARDS"]);
      for (const seg of result.segments) {
        const template = VALUATION_SECTOR_TEMPLATES[classifySegmentSector(seg.name)];
        expect(seg.segmentKw).toBeCloseTo(0.11 + template.keAdjustment, 12);
      }
      // The adjustments differ, so a dropped one would show.
      expect(new Set(result.segments.map((s) => s.segmentKw.toFixed(6))).size).toBeGreaterThan(1);
    });

    it.skipIf(!fixturesAvailable)("produces enhanced SOTP result from parsed data", () => {
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
