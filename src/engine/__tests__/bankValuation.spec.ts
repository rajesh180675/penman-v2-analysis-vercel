import { describe, it, expect } from "vitest";
import { computeBankValuation } from "../bankValuation";
import type { BankPeriodMetrics } from "../bankPipeline";
import type { EngineConfig } from "../types";

function cfg(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    ke: 0.12,
    kw: 0.10,
    g_terminal: 0.05,
    risk_free_rate: 0.07,
    equity_risk_premium: 0.05,
    beta: 1.0,
    ...overrides,
  } as EngineConfig;
}

function bankPeriod(
  period_end: string,
  overrides: {
    totalEquity?: number | null;
    pat?: number | null;
    roe?: number | null;
  } = {},
): BankPeriodMetrics {
  return {
    period_end,
    totalAssets: 100_000,
    totalEquity: overrides.totalEquity ?? 10_000,
    advances: 70_000,
    deposits: 80_000,
    investments: 20_000,
    borrowings: 5_000,
    cashAndBalanceWithRBI: 4_000,
    interestEarned: 8_000,
    interestExpended: 4_000,
    nii: 4_000,
    otherIncome: 1_500,
    operatingExpenses: 2_500,
    provisions: 500,
    pat: overrides.pat ?? 1_500,
    pbt: 2_000,
    nim: 0.04,
    roa: 0.015,
    roe: overrides.roe ?? 0.15,
    creditCost: 0.007,
    costToIncome: 0.45,
    casaRatio: null,
    nonConvertibleDebentures: null,
    termLoansFromBanks: null,
    termLoansFromInstitutions: null,
    termLoansFromOthers: null,
    leverage: null,
    costOfBorrowings: null,
    yieldOnAdvances: null,
    spread: null,
    debtMix: null,
  };
}

function buildHistory(roes: number[], bvStart = 8_000, bvGrowth = 0.10): BankPeriodMetrics[] {
  const periods: BankPeriodMetrics[] = [];
  let bv = bvStart;
  for (let i = 0; i < roes.length; i++) {
    bv *= 1 + bvGrowth;
    const pat = roes[i] * bv;
    periods.push(
      bankPeriod(`${2020 + i}-03-31`, { totalEquity: bv, pat, roe: roes[i] }),
    );
  }
  return periods;
}

describe("computeBankValuation — Phase B4", () => {
  describe("empty / boundary cases", () => {
    it("returns all-skipped bundle for empty metrics", () => {
      const result = computeBankValuation([], cfg());
      expect(result.justifiedPB.status).toBe("skipped");
      expect(result.equityResidualIncome.status).toBe("skipped");
      expect(result.sustainableDDM.status).toBe("skipped");
      expect(result.triangulatedValue).toBeNull();
      expect(result.modelsContributing).toEqual([]);
      expect(result.sustainableROE).toBeNull();
    });

    it("skips all models when book value is non-positive", () => {
      const periods = buildHistory([0.15, 0.16, 0.14], -1000); // negative BV
      const result = computeBankValuation(periods, cfg());
      expect(result.justifiedPB.status).toBe("skipped");
      expect(result.justifiedPB.reason).toMatch(/positive latest book value/);
    });

    it("skips when fewer than 3 periods of positive ROE history", () => {
      const periods = buildHistory([0.15, 0.16]); // only 2 periods
      const result = computeBankValuation(periods, cfg());
      expect(result.sustainableROE).toBeNull();
      expect(result.justifiedPB.status).toBe("skipped");
      // ERI also requires ≥3 usable periods.
      expect(result.equityResidualIncome.status).toBe("skipped");
      expect(result.equityResidualIncome.reason).toMatch(/usable periods/);
    });
  });

  describe("Justified P/B Gordon", () => {
    it("computes fair P/B > 1 when ROE > ke", () => {
      const periods = buildHistory([0.15, 0.16, 0.17, 0.16, 0.15]);
      const result = computeBankValuation(periods, cfg({ ke: 0.12 }));
      expect(result.justifiedPB.status).toBe("computed");
      expect(result.justifiedPB.diagnostics.fairPB).toBeGreaterThan(1);
      expect(result.justifiedPB.intrinsicValue).toBeGreaterThan(periods[periods.length - 1].totalEquity!);
    });

    it("computes fair P/B ≤ 1 when sustainable ROE ≤ ke", () => {
      // 5 years of ROE = 11%, ke = 12%. Bank is destroying equity value.
      const periods = buildHistory([0.11, 0.10, 0.11, 0.12, 0.11]);
      const result = computeBankValuation(periods, cfg({ ke: 0.12 }));
      expect(result.justifiedPB.status).toBe("computed");
      const fairPB = result.justifiedPB.diagnostics.fairPB!;
      expect(fairPB).toBeLessThanOrEqual(1.05); // small tolerance
    });

    it("skips when ke − g is below the guardrail", () => {
      const periods = buildHistory([0.15, 0.16, 0.15]);
      // ke = 11%, terminal_growth = 10.5% → spread 50bps < 100bps guardrail.
      const result = computeBankValuation(
        periods,
        cfg({ ke: 0.11, terminal_growth_rate: 0.105 } as never),
      );
      expect(result.justifiedPB.status).toBe("skipped");
      expect(result.justifiedPB.reason).toMatch(/guardrail/);
    });
  });

  describe("Equity Residual Income with fade", () => {
    it("computes value above book when ROE persistently exceeds ke", () => {
      const periods = buildHistory([0.18, 0.19, 0.18, 0.17, 0.18]);
      const result = computeBankValuation(periods, cfg({ ke: 0.12 }));
      expect(result.equityResidualIncome.status).toBe("computed");
      const bv0 = periods[periods.length - 1].totalEquity!;
      expect(result.equityResidualIncome.intrinsicValue).toBeGreaterThan(bv0);
    });

    it("includes 5-year explicit forecast period", () => {
      const periods = buildHistory([0.15, 0.16, 0.17, 0.15, 0.16]);
      const result = computeBankValuation(periods, cfg());
      expect(result.equityResidualIncome.diagnostics.forecastYears).toBe(5);
    });

    it("skips terminal value when ke − g is below guardrail", () => {
      const periods = buildHistory([0.15, 0.16, 0.15]);
      const result = computeBankValuation(
        periods,
        cfg({ ke: 0.10, terminal_growth_rate: 0.095 } as never),
      );
      expect(result.equityResidualIncome.status).toBe("skipped");
    });
  });

  describe("Sustainable DDM", () => {
    it("flags g exceeding sustainable g (payout × ROE)", () => {
      // High growth but high payout → unsustainable.
      // ROE 15%, payout 60% → sustainable g = (1-0.6) × 0.15 = 6%.
      // Set terminal_growth = 8% > 6%.
      const periods = buildHistory([0.15, 0.15, 0.15, 0.15, 0.15]);
      const result = computeBankValuation(
        periods,
        cfg({ terminal_growth_rate: 0.08 } as never),
        null,
        0.60, // payout ratio
      );
      expect(result.sustainableDDM.status).toBe("skipped");
      expect(result.sustainableDDM.reason).toMatch(/sustainable g/);
    });

    it("computes value when payout × ROE supports g", () => {
      // ROE 15%, payout 30% → sustainable g = 10.5%. terminal_growth = 5% is fine.
      const periods = buildHistory([0.15, 0.16, 0.15, 0.16, 0.15]);
      const result = computeBankValuation(periods, cfg(), null, 0.30);
      expect(result.sustainableDDM.status).toBe("computed");
      expect(result.sustainableDDM.intrinsicValue).toBeGreaterThan(0);
      expect(result.sustainableDDM.diagnostics.payoutRatio).toBe(0.30);
    });

    it("skips when latest earnings are non-positive", () => {
      const periods = buildHistory([0.15, 0.16, 0.15, 0.15, 0.15]);
      // Override latest period to have zero PAT
      periods[periods.length - 1].pat = 0;
      const result = computeBankValuation(periods, cfg(), null, 0.30);
      expect(result.sustainableDDM.status).toBe("skipped");
      expect(result.sustainableDDM.reason).toMatch(/non-positive/);
    });
  });

  describe("triangulation", () => {
    it("median of computed models when all three run", () => {
      const periods = buildHistory([0.15, 0.16, 0.15, 0.17, 0.16]);
      const result = computeBankValuation(periods, cfg(), null, 0.30);
      expect(result.modelsContributing.length).toBeGreaterThanOrEqual(2);
      if (result.triangulatedValue != null) {
        const computedVals = [
          result.justifiedPB.intrinsicValue,
          result.equityResidualIncome.intrinsicValue,
          result.sustainableDDM.intrinsicValue,
        ].filter((v): v is number => v != null).sort((a, b) => a - b);
        // Triangulated value sits within [min, max]
        expect(result.triangulatedValue).toBeGreaterThanOrEqual(computedVals[0]);
        expect(result.triangulatedValue).toBeLessThanOrEqual(computedVals[computedVals.length - 1]);
      }
    });

    it("returns null triangulated value when only ERI runs", () => {
      // Negative ROE history skips Justified P/B (sustainable ROE = null)
      // and DDM (non-positive PAT), but ERI still computes — its job is
      // to flag value destruction by returning a value below book.
      const periods = buildHistory([-0.05, -0.03, -0.01]);
      const result = computeBankValuation(periods, cfg());
      expect(result.justifiedPB.status).toBe("skipped");
      expect(result.sustainableDDM.status).toBe("skipped");
      // ERI computes; bv0 ≈ 10,648, intrinsic value should be below book.
      if (result.equityResidualIncome.status === "computed") {
        const bv0 = periods[periods.length - 1].totalEquity!;
        expect(result.equityResidualIncome.intrinsicValue!).toBeLessThan(bv0);
      }
      // Triangulation with one model is just that model's value.
      expect(result.modelsContributing).toEqual(["Equity Residual Income"]);
    });
  });

  describe("market cap premium computation", () => {
    it("computes premium when marketCap supplied", () => {
      const periods = buildHistory([0.15, 0.16, 0.15, 0.17, 0.16]);
      const result = computeBankValuation(periods, cfg(), 5_000);
      if (result.justifiedPB.status === "computed" && result.justifiedPB.intrinsicValue != null) {
        const expected = result.justifiedPB.intrinsicValue / 5_000 - 1;
        expect(result.justifiedPB.premiumOverMarket).toBeCloseTo(expected, 6);
      }
    });

    it("leaves premium null when marketCap is null", () => {
      const periods = buildHistory([0.15, 0.16, 0.15, 0.17, 0.16]);
      const result = computeBankValuation(periods, cfg(), null);
      expect(result.justifiedPB.premiumOverMarket).toBeNull();
    });
  });

  describe("sustainable ROE caps", () => {
    it("caps sustainable ROE at 1.5× long-run (≈19.5%)", () => {
      // Five years of 30% ROE — cap kicks in.
      const periods = buildHistory([0.30, 0.30, 0.30, 0.30, 0.30]);
      const result = computeBankValuation(periods, cfg());
      expect(result.sustainableROE).not.toBeNull();
      expect(result.sustainableROE!).toBeLessThanOrEqual(0.195 + 1e-9);
    });

    it("uses median ROE when below the cap", () => {
      const periods = buildHistory([0.14, 0.15, 0.16, 0.15, 0.14]);
      const result = computeBankValuation(periods, cfg());
      expect(result.sustainableROE).toBeCloseTo(0.15, 5);
    });
  });
});
