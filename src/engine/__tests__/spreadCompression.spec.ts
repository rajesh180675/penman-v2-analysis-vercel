import { describe, it, expect } from "vitest";
import { computeBankValuation } from "../bankValuation";
import type { BankPeriodMetrics } from "../bankPipeline";
import type { BankQualityPeriod } from "../bankQualityIndicators";
import type { EngineConfig } from "../types";

/**
 * Spread Compression / Cost-of-Funds Sensitivity Tests (Phase D3b)
 *
 * Tests the diagnostic that stress-tests NBFC ROA under wholesale
 * funding cost shocks (+150bps IL&FS-level, +250bps severe).
 *
 * This lens is INFORMATIONAL — does not modify valuation.
 */

function cfg(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    ke: 0.12,
    kd_pretax: 0.08,
    tax_rate_for_kd: 0.25,
    risk_free_rate: 0.07,
    equity_risk_premium: 0.05,
    terminal_growth_rate: 0.05,
    ...overrides,
  } as EngineConfig;
}

function makePeriod(
  periodEnd: string,
  overrides: {
    costOfBorrowings?: number | null;
    yieldOnAdvances?: number | null;
    spread?: number | null;
    roa?: number | null;
    advances?: number | null;
    totalAssets?: number | null;
  } = {},
): BankPeriodMetrics {
  const cob = overrides.costOfBorrowings ?? 0.08;
  const yoa = overrides.yieldOnAdvances ?? 0.14;
  const spread = overrides.spread ?? (yoa - cob);
  return {
    period_end: periodEnd,
    totalAssets: overrides.totalAssets ?? 100000,
    totalEquity: 15000,
    advances: overrides.advances ?? 82000,
    deposits: null,
    investments: null,
    borrowings: 70000,
    cashAndBalanceWithRBI: null,
    interestEarned: 11000,
    interestExpended: -5600,
    nii: 5400,
    otherIncome: 1500,
    operatingExpenses: 2500,
    provisions: 500,
    pat: 3000,
    pbt: 4000,
    dividendPaid: 600,
    nim: 0.06,
    roa: overrides.roa ?? 0.03,
    roe: 0.20,
    creditCost: 0.015,
    costToIncome: 0.35,
    casaRatio: null,
    nonConvertibleDebentures: null,
    termLoansFromBanks: null,
    termLoansFromInstitutions: null,
    termLoansFromOthers: null,
    leverage: 4.5,
    costOfBorrowings: cob,
    yieldOnAdvances: yoa,
    spread,
    debtMix: null,
    quality: {
      period_end: periodEnd,
      crar_pct: 22.0,
      stage3_pct: 1.0,
      ecl_coverage_pct: 60,
    } as BankQualityPeriod,
  };
}

function makeMetrics(
  cobSeries: number[],
  yieldOnAdv: number = 0.14,
  roa: number = 0.03,
): BankPeriodMetrics[] {
  return cobSeries.map((cob, i) => makePeriod(
    (2020 + i) + "-03-31",
    { costOfBorrowings: cob, yieldOnAdvances: yieldOnAdv, spread: yieldOnAdv - cob, roa },
  ));
}

describe("Spread Compression Check (Phase D3b)", () => {

  describe("normal spread — healthy NBFC", () => {
    it("stable CoB, spread near median → severity normal", () => {
      // 5 years of stable 8% CoB, 14% yield → 600bps spread
      const metrics = makeMetrics([0.08, 0.08, 0.08, 0.08, 0.08]);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.spreadCompression).toBeDefined();
      expect(result.spreadCompression!.status).toBe("computed");
      expect(result.spreadCompression!.severity).toBe("normal");
      expect(result.spreadCompression!.latestSpread).toBeCloseTo(0.06, 3);
      expect(result.spreadCompression!.spreadRatio).toBeCloseTo(1.0, 1);
    });

    it("CoB trend stable → cobTrendBps near zero", () => {
      const metrics = makeMetrics([0.08, 0.08, 0.08, 0.08, 0.08]);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.spreadCompression!.cobTrendBps).toBeCloseTo(0, 0);
    });
  });

  describe("compressed spread — warning zone", () => {
    it("CoB rising, spread below 75% of median → severity compressed", () => {
      // CoB rising from 8% to 11.5% while yield stays at 14% → spread compresses
      const metrics = makeMetrics([0.08, 0.09, 0.10, 0.11, 0.115]);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.spreadCompression!.status).toBe("computed");
      expect(result.spreadCompression!.severity).toBe("compressed");
      expect(result.spreadCompression!.latestSpread).toBeCloseTo(0.025, 3);
      expect(result.spreadCompression!.cobTrendBps).toBeGreaterThan(0);
    });

    it("message includes stress scenario ROA numbers", () => {
      const metrics = makeMetrics([0.08, 0.09, 0.10, 0.11, 0.115], 0.14, 0.03);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.spreadCompression!.message).toContain("150bps");
      expect(result.spreadCompression!.message).toContain("250bps");
    });
  });

  describe("expanding spread — favorable", () => {
    it("CoB falling, spread above 115% of median → severity expanding", () => {
      // CoB falling from 10% to 7% while yield stays at 14%
      const metrics = makeMetrics([0.10, 0.095, 0.09, 0.08, 0.07]);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.spreadCompression!.status).toBe("computed");
      expect(result.spreadCompression!.severity).toBe("expanding");
      expect(result.spreadCompression!.latestSpread).toBeCloseTo(0.07, 3);
    });
  });

  describe("stress test ROA computation", () => {
    it("+150bps shock reduces ROA by ~1.23% (82% advances/assets × 1.5%)", () => {
      const metrics = makeMetrics([0.08, 0.08, 0.08, 0.08, 0.08], 0.14, 0.03);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      const sc = result.spreadCompression!;
      // advances/assets = 82000/100000 = 0.82
      // ROA impact = 0.015 × 0.82 = 0.0123
      // Stressed ROA = 0.03 - 0.0123 = 0.0177
      expect(sc.stressedROA_150bps).toBeCloseTo(0.0177, 3);
      expect(sc.stressedROA_250bps).toBeCloseTo(0.0095, 3);
      expect(sc.currentROA).toBeCloseTo(0.03, 3);
    });

    it("thin-spread NBFC goes loss-making under +250bps shock", () => {
      // CoB 11%, yield 13% → spread 200bps, ROA 1%
      const metrics = makeMetrics([0.10, 0.105, 0.11, 0.11, 0.11], 0.13, 0.01);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      const sc = result.spreadCompression!;
      // Stressed ROA = 0.01 - 0.025*0.82 = 0.01 - 0.0205 = -0.0105
      expect(sc.stressedROA_250bps).toBeLessThan(0);
    });
  });

  describe("missing data handling", () => {
    it("fewer than 3 periods with spread → status skipped", () => {
      // Only 2 periods have spread data — need ≥3 for the check to fire.
      // Use raw period objects to bypass makePeriod's ?? defaults.
      const base = makePeriod("2022-03-31", { costOfBorrowings: 0.08, yieldOnAdvances: 0.14, spread: 0.06 });
      const p1 = { ...base, period_end: "2023-03-31", costOfBorrowings: null as number | null, yieldOnAdvances: null as number | null, spread: null as number | null };
      const p2 = makePeriod("2024-03-31", { costOfBorrowings: 0.08, yieldOnAdvances: 0.14, spread: 0.06 });
      const p3 = { ...base, period_end: "2025-03-31", costOfBorrowings: null as number | null, yieldOnAdvances: null as number | null, spread: null as number | null };
      const metrics = [p1, p2, p3];
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.spreadCompression!.status).toBe("skipped");
      expect(result.spreadCompression!.message).toContain("need");
    });

    it("not NBFC → spreadCompression is undefined", () => {
      const metrics = makeMetrics([0.08, 0.08, 0.08, 0.08, 0.08]);
      const result = computeBankValuation(metrics, cfg(), null, null, false, false);
      expect(result.spreadCompression).toBeUndefined();
    });
  });

  describe("does NOT modify valuation", () => {
    it("compressed spread does not change justifiedPB intrinsicValue", () => {
      // Same financials, different CoB history
      const normalMetrics = makeMetrics([0.08, 0.08, 0.08, 0.08, 0.08]);
      const stressMetrics = makeMetrics([0.08, 0.09, 0.10, 0.11, 0.115]);

      const normalResult = computeBankValuation(normalMetrics, cfg(), null, null, false, true);
      const stressResult = computeBankValuation(stressMetrics, cfg(), null, null, false, true);

      // Both should have same justifiedPB (spread compression is informational only)
      // Note: they have same ROE/equity/ke/g so Gordon P/B is identical
      expect(normalResult.justifiedPB.intrinsicValue).toBe(stressResult.justifiedPB.intrinsicValue);
    });
  });
});
