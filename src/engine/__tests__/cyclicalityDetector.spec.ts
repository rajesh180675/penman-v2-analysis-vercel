import { describe, it, expect } from "vitest";
import { assessCyclicality } from "../cyclicalityDetector";
import type { RecastPeriod } from "../types";

function mkPeriod(period_end: string, corePM: number, rnoa: number = 0.10): RecastPeriod {
  return {
    period_end,
    ratios: {
      RNOA: rnoa,
      SPREAD: rnoa - 0.08,
      ROCE: rnoa + 0.02,
      NBC: 0.05, FLEV: 0.25,
      PM: corePM,
      ATO: 1.0,
      SalesPM: corePM,
      ATO_star: 1.0,
      OtherItemsRatio: 0,
      ROCE_bridge_residual: 0,
      io: 0.05,
      ROOA: rnoa,
      OLLEV: 0,
      OLSPREAD: 0,
      RNOA_check: rnoa,
      ROTCE: rnoa,
      MSR: 0,
      CoreSalesPM: corePM,
      CoreOtherItems_OA: 0,
      UOI_OA: 0,
      CoreNBC: 0.05,
      UFE_NFO: 0,
      CoreSPREAD: rnoa - 0.08,
      ROCE_eq16_reconstructed: rnoa,
      ROCE_eq16_error: 0,
      eq16_step1_residual: 0,
      eq16_step2_residual: 0,
      eq16_step3_residual: 0,
      eq16_flag: "OK",
      eq16_diagnosis: null,
      ROOA_spec: rnoa,
      imputed_io_spec: 0.05,
      required_return_per_sales: null,
      value_creating_margin: null,
      CSE_eq8_check: null,
      CSE_eq8_error_pct: null,
      current_ratio: 1.5, quick_ratio: 1.0,
      days_receivable: 45, days_payable: 36, days_inventory: 90,
      cash_conversion_cycle: 99, accrual_ratio_bs: 0.02, accrual_ratio_cf: 0.02,
      cash_conversion_ratio: 1.1, interest_coverage: 8,
      NOA_growth: 0.05, CNI_growth: 0.08, OI_growth: 0.08, Sales_growth: 0.08,
      noaSmall: false, separationScore: 1,
      accrual_regime: "NORMAL",
      dirty_surplus: 0, dirty_surplus_pct_cse: 0,
      freeOL: null, interestBearingOL: null,
      OLLEV_check: null, RNOA_vs_OLLEV_residual: null,
    employeeCostRatio: null,
    },
  } as RecastPeriod;
}

describe("assessCyclicality — Phase I robustness", () => {
  describe("insufficient-data cases", () => {
    it("returns insufficient-data for null/undefined input", () => {
      expect(assessCyclicality(null).classification).toBe("insufficient-data");
      expect(assessCyclicality(undefined).classification).toBe("insufficient-data");
      expect(assessCyclicality([]).classification).toBe("insufficient-data");
    });

    it("returns insufficient-data when fewer than 5 periods", () => {
      const periods = Array.from({ length: 4 }, (_, i) =>
        mkPeriod(`${2020 + i}-03-31`, 0.15),
      );
      const result = assessCyclicality(periods);
      expect(result.classification).toBe("insufficient-data");
      expect(result.reason).toMatch(/Need ≥5 periods/);
    });

    it("returns insufficient-data when no metric has ≥5 valid observations", () => {
      const periods = Array.from({ length: 6 }, (_, i) => {
        const p = mkPeriod(`${2020 + i}-03-31`, 0.15);
        // Wipe both metrics
        (p.ratios as { CoreSalesPM: number | null }).CoreSalesPM = null;
        (p.ratios as { RNOA: number | null }).RNOA = null;
        return p;
      });
      const result = assessCyclicality(periods);
      expect(result.classification).toBe("insufficient-data");
      expect(result.reason).toMatch(/Neither CoreSalesPM nor RNOA/);
    });
  });

  describe("non-cyclical companies", () => {
    it("classifies stable margins as non-cyclical (TCS-like)", () => {
      // 7 years of 22-25% margins, low CV
      const margins = [0.22, 0.23, 0.24, 0.25, 0.24, 0.23, 0.24];
      const periods = margins.map((m, i) =>
        mkPeriod(`${2018 + i}-03-31`, m),
      );
      const result = assessCyclicality(periods);
      expect(result.classification).toBe("non-cyclical");
      expect(result.cv!).toBeLessThan(0.20);
      expect(result.metricUsed).toBe("core-pm");
    });
  });

  describe("cyclical companies", () => {
    it("classifies high-CV series as cyclical-peak when latest is high (Tata Steel FY22)", () => {
      // 7 years of margins: trough=8%, normal=12-15%, peak=25%
      const margins = [0.10, 0.12, 0.08, 0.14, 0.15, 0.13, 0.25]; // FY22 peak last
      const periods = margins.map((m, i) =>
        mkPeriod(`${2016 + i}-03-31`, m),
      );
      const result = assessCyclicality(periods);
      expect(result.classification).toBe("cyclical-peak");
      expect(result.cv!).toBeGreaterThan(0.20);
      expect(result.zScore!).toBeGreaterThan(0.75);
      expect(result.reason).toMatch(/peak-cycle/);
      expect(result.peakValue).toBeGreaterThan(result.medianValue!);
    });

    it("classifies high-CV series as cyclical-trough when latest is low (Tata Steel FY24)", () => {
      // 7 years: peak years were earlier, latest is trough
      const margins = [0.15, 0.20, 0.25, 0.22, 0.18, 0.12, 0.08];
      const periods = margins.map((m, i) =>
        mkPeriod(`${2018 + i}-03-31`, m),
      );
      const result = assessCyclicality(periods);
      expect(result.classification).toBe("cyclical-trough");
      expect(result.zScore!).toBeLessThan(-0.75);
      expect(result.reason).toMatch(/trough-cycle/);
    });

    it("classifies high-CV series as cyclical-midcycle when latest is near median", () => {
      // High CV but latest equals median
      const margins = [0.05, 0.20, 0.10, 0.18, 0.06, 0.22, 0.13];
      const periods = margins.map((m, i) =>
        mkPeriod(`${2018 + i}-03-31`, m),
      );
      const result = assessCyclicality(periods);
      expect(result.classification).toBe("cyclical-midcycle");
      expect(Math.abs(result.zScore!)).toBeLessThan(0.75);
      expect(result.reason).toMatch(/mid-cycle/);
    });
  });

  describe("metric fallback", () => {
    it("falls back to RNOA when CoreSalesPM is null", () => {
      const periods: RecastPeriod[] = [];
      const rnoa = [0.05, 0.18, 0.08, 0.20, 0.12, 0.22, 0.10];
      for (let i = 0; i < rnoa.length; i++) {
        const p = mkPeriod(`${2018 + i}-03-31`, 0.15, rnoa[i]);
        (p.ratios as { CoreSalesPM: number | null }).CoreSalesPM = null;
        periods.push(p);
      }
      const result = assessCyclicality(periods);
      expect(result.metricUsed).toBe("rnoa");
      expect(["cyclical-peak", "cyclical-trough", "cyclical-midcycle"]).toContain(result.classification);
    });
  });

  describe("anchors", () => {
    it("provides trough/peak/median anchors for cycle-aware valuation", () => {
      const margins = [0.05, 0.20, 0.08, 0.18, 0.10, 0.22, 0.13];
      const periods = margins.map((m, i) =>
        mkPeriod(`${2018 + i}-03-31`, m),
      );
      const result = assessCyclicality(periods);
      expect(result.troughValue).not.toBeNull();
      expect(result.peakValue).not.toBeNull();
      expect(result.troughValue!).toBeLessThan(result.medianValue!);
      expect(result.peakValue!).toBeGreaterThan(result.medianValue!);
    });
  });
});
