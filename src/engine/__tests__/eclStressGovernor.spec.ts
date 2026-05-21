import { describe, it, expect } from "vitest";
import { computeBankValuation } from "../bankValuation";
import type { BankPeriodMetrics } from "../bankPipeline";
import type { BankQualityPeriod } from "../bankQualityIndicators";

/**
 * ECL Stress Governor Tests (Phase D3)
 *
 * Tests the two-segment linear fade on justified P/B when uncovered
 * Stage 3 + restructured exceeds healthy thresholds.
 *
 * Threshold calibration (Indian NBFC distress history):
 *   < 2%  uncovered: no fade (Bajaj, Cholamandalam, Sundaram)
 *   2-5%  uncovered: linear 1.0 → 0.5 (vehicle-finance mild stress)
 *   5-10% uncovered: linear 0.5 → 0.25 (DHFL, IL&FS pre-collapse)
 *   > 10% uncovered: floor 0.25 (microfinance crisis, pre-IBC)
 *
 * Composite metric:
 *   uncovered_stress = stage3 × (1 − ecl_coverage/100) + restructured × 0.5
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePeriod(
  periodEnd: string,
  equity: number,
  pat: number,
  quality: Partial<BankQualityPeriod> | null,
): BankPeriodMetrics {
  return {
    period_end: periodEnd,
    totalAssets: equity * 6,
    totalEquity: equity,
    advances: equity * 5,
    deposits: null,
    investments: null,
    borrowings: equity * 4,
    cashAndBalanceWithRBI: null,
    interestEarned: pat * 4,
    interestExpended: pat * 2,
    nii: pat * 2,
    otherIncome: pat * 0.3,
    operatingExpenses: pat * 0.8,
    provisions: pat * 0.2,
    pat,
    pbt: pat * 1.3,
    dividendPaid: pat * 0.2,
    nim: 0.04,
    roa: pat / (equity * 6),
    roe: pat / equity,
    creditCost: 0.02,
    costToIncome: 0.35,
    casaRatio: null,
    nonConvertibleDebentures: null,
    termLoansFromBanks: null,
    termLoansFromInstitutions: null,
    termLoansFromOthers: null,
    leverage: 4.0,
    costOfBorrowings: 0.08,
    yieldOnAdvances: 0.14,
    spread: 0.06,
    debtMix: null,
    quality: quality ? { period_end: periodEnd, ...quality } as BankQualityPeriod : null,
  };
}

function makeMetrics(
  stage3: number | null,
  eclCoverage: number | null,
  restructured: number | null,
  stage2: number | null = null,
): BankPeriodMetrics[] {
  // 5 years of history (needed for sustainable ROE median)
  const periods: BankPeriodMetrics[] = [];
  for (let y = 2020; y <= 2024; y++) {
    const isLatest = y === 2024;
    const quality: Partial<BankQualityPeriod> | null = isLatest
      ? {
          stage3_pct: stage3,
          ecl_coverage_pct: eclCoverage,
          restructured_pct: restructured,
          stage2_pct: stage2,
          crar_pct: 22.0,  // healthy CRAR so governor doesn't interfere
        }
      : {
          stage3_pct: stage3 != null ? stage3 * 0.9 : null,  // slightly lower in prior years
          ecl_coverage_pct: eclCoverage,
          restructured_pct: null,
          stage2_pct: null,
          crar_pct: 22.0,
        };
    periods.push(makePeriod(
      `${y}-03-31`,
      10000,  // equity 10,000 Cr
      2000,   // PAT 2,000 Cr → ROE 20%
      quality,
    ));
  }
  return periods;
}

import type { EngineConfig } from "../types";

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

describe("ECL Stress Governor (Phase D3)", () => {

  describe("healthy NBFC — no fade", () => {
    it("Bajaj-like: Stage 3 = 0.96%, ECL coverage = 53% → uncovered 0.45%, no fade", () => {
      const metrics = makeMetrics(0.96, 53.22, null);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.eclStressGovernor).toBeDefined();
      expect(result.eclStressGovernor!.status).toBe("computed");
      expect(result.eclStressGovernor!.fadeFactor).toBe(1.0);
      expect(result.eclStressGovernor!.uncoveredStressPct).toBeCloseTo(0.449, 1);
      expect(result.eclStressGovernor!.message).toContain("no fade applied");
    });

    it("Stage 3 = 1.5%, ECL coverage = 60% → uncovered 0.6%, no fade", () => {
      const metrics = makeMetrics(1.5, 60, null);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.eclStressGovernor!.fadeFactor).toBe(1.0);
      expect(result.eclStressGovernor!.uncoveredStressPct).toBeCloseTo(0.6, 1);
    });
  });

  describe("warning zone — linear fade 1.0 → 0.5 over [2%, 5%]", () => {
    it("uncovered 2.5% → factor ≈ 0.917", () => {
      // stage3=5%, coverage=50% → uncovered = 5*(1-0.5) = 2.5%
      const metrics = makeMetrics(5.0, 50, null);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.eclStressGovernor!.status).toBe("computed");
      // t = (2.5 - 2) / (5 - 2) = 0.167; factor = 1 - 0.167*0.5 = 0.917
      expect(result.eclStressGovernor!.fadeFactor).toBeCloseTo(0.917, 2);
      expect(result.eclStressGovernor!.message).toContain("Fade factor");
    });

    it("uncovered 3.5% → factor ≈ 0.75", () => {
      // stage3=7%, coverage=50% → uncovered = 7*(1-0.5) = 3.5%
      const metrics = makeMetrics(7.0, 50, null);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      // t = (3.5 - 2) / (5 - 2) = 0.5; factor = 1 - 0.5*0.5 = 0.75
      expect(result.eclStressGovernor!.fadeFactor).toBeCloseTo(0.75, 2);
    });

    it("uncovered exactly 5% → factor = 0.5 (boundary)", () => {
      // stage3=10%, coverage=50% → uncovered = 10*(1-0.5) = 5.0%
      const metrics = makeMetrics(10.0, 50, null);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      // At exactly 5%, enters second segment: factor = MID_FACTOR = 0.5
      expect(result.eclStressGovernor!.fadeFactor).toBeCloseTo(0.5, 2);
    });
  });

  describe("distress zone — linear fade 0.5 → 0.25 over [5%, 10%]", () => {
    it("uncovered 7.5% → factor ≈ 0.375", () => {
      // stage3=15%, coverage=50% → uncovered = 15*(1-0.5) = 7.5%
      const metrics = makeMetrics(15.0, 50, null);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      // t = (7.5 - 5) / (10 - 5) = 0.5; factor = 0.5 - 0.5*0.25 = 0.375
      expect(result.eclStressGovernor!.fadeFactor).toBeCloseTo(0.375, 2);
    });

    it("uncovered > 10% → floor factor 0.25", () => {
      // stage3=25%, coverage=50% → uncovered = 12.5%
      const metrics = makeMetrics(25.0, 50, null);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.eclStressGovernor!.fadeFactor).toBe(0.25);
    });
  });

  describe("restructured book contribution", () => {
    it("restructured 2% adds 1% to uncovered stress (0.5× weight)", () => {
      // stage3=2%, coverage=50% → uncovered_stage3 = 1%
      // restructured=2% → adds 1% → total = 2%
      // At exactly 2% → still no fade (< threshold)
      const metrics = makeMetrics(2.0, 50, 2.0);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.eclStressGovernor!.uncoveredStressPct).toBeCloseTo(2.0, 1);
      // At exactly 2.0 → enters warning zone, t=0, factor=1.0
      expect(result.eclStressGovernor!.fadeFactor).toBe(1.0);
    });

    it("restructured 4% pushes healthy book into warning zone", () => {
      // stage3=1%, coverage=60% → uncovered_stage3 = 0.4%
      // restructured=4% → adds 2% → total = 2.4%
      const metrics = makeMetrics(1.0, 60, 4.0);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.eclStressGovernor!.uncoveredStressPct).toBeCloseTo(2.4, 1);
      // t = (2.4 - 2) / (5 - 2) = 0.133; factor = 1 - 0.133*0.5 ≈ 0.933
      expect(result.eclStressGovernor!.fadeFactor).toBeCloseTo(0.933, 2);
    });
  });

  describe("missing data handling", () => {
    it("ECL coverage missing → assumes 0% (worst case), flags in message", () => {
      // stage3=3%, coverage=null → uncovered = 3% (full stage3 treated as uncovered)
      const metrics = makeMetrics(3.0, null, null);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.eclStressGovernor!.uncoveredStressPct).toBeCloseTo(3.0, 1);
      expect(result.eclStressGovernor!.fadeFactor).toBeLessThan(1.0);
      expect(result.eclStressGovernor!.message).toContain("ECL coverage not reported");
      expect(result.eclStressGovernor!.message).toContain("assumed 0%");
    });

    it("Stage 3 missing → status skipped, no fade", () => {
      const metrics = makeMetrics(null, null, null);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.eclStressGovernor!.status).toBe("skipped");
      expect(result.eclStressGovernor!.fadeFactor).toBe(1.0);
      expect(result.eclStressGovernor!.message).toContain("stage3_pct missing");
    });

    it("not NBFC → eclStressGovernor is undefined", () => {
      const metrics = makeMetrics(5.0, 50, null);
      const result = computeBankValuation(metrics, cfg(), null, null, false, false);
      expect(result.eclStressGovernor).toBeUndefined();
    });
  });

  describe("Stage 2 advisory", () => {
    it("Stage 2 > 3% triggers watchlist warning in message", () => {
      const metrics = makeMetrics(2.0, 60, null, 6.0);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.eclStressGovernor!.latestStage2Pct).toBe(6.0);
      expect(result.eclStressGovernor!.message).toContain("Stage 2 watchlist elevated");
    });

    it("Stage 2 ≤ 3% does not trigger watchlist warning", () => {
      const metrics = makeMetrics(1.0, 60, null, 2.5);
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);
      expect(result.eclStressGovernor!.message).not.toContain("Stage 2 watchlist");
    });
  });

  describe("interaction with CRAR governor", () => {
    it("both governors fire independently — CRAR governs g, ECL governs P/B", () => {
      // Low CRAR (16%) + high uncovered stress (3%)
      const metrics = makeMetrics(6.0, 50, null);
      // Override CRAR to be low
      for (const m of metrics) {
        if (m.quality) m.quality.crar_pct = 16.0;
      }
      const result = computeBankValuation(metrics, cfg(), null, null, false, true);

      // CRAR governor should have throttled g
      expect(result.crarGovernor).toBeDefined();
      expect(result.crarGovernor!.status).toBe("computed");
      expect(result.crarGovernor!.effectiveG).toBeLessThan(0.05);

      // ECL governor should have faded P/B
      expect(result.eclStressGovernor).toBeDefined();
      expect(result.eclStressGovernor!.status).toBe("computed");
      expect(result.eclStressGovernor!.fadeFactor).toBeLessThan(1.0);

      // Both are orthogonal — no double-counting
      expect(result.terminalGrowth).toBeLessThan(0.05);  // g was throttled
      expect(result.justifiedPB.reason).toContain("ECL stress fade");  // P/B was faded
    });
  });

  describe("justified P/B value is actually modified", () => {
    it("faded P/B produces lower intrinsic value than unfaded", () => {
      // Both use identical financials (ROE 20%, ke 12%, g 5%) — only asset quality differs.
      // Stress: stage3=6%, coverage=50% → uncovered = 3% → in warning zone, factor < 1
      const stressMetrics = makeMetrics(6.0, 50, null);
      const stressResult = computeBankValuation(stressMetrics, cfg(), null, null, false, true);

      // Healthy: stage3=0.5%, coverage=80% → uncovered = 0.1% → no fade
      const healthyMetrics = makeMetrics(0.5, 80, null);
      const healthyResult = computeBankValuation(healthyMetrics, cfg(), null, null, false, true);

      // Both should be computed (same ROE/ke/g, only quality differs)
      expect(stressResult.justifiedPB.status).toBe("computed");
      expect(healthyResult.justifiedPB.status).toBe("computed");
      expect(stressResult.justifiedPB.intrinsicValue).not.toBeNull();
      expect(healthyResult.justifiedPB.intrinsicValue).not.toBeNull();

      // ECL fade should have reduced the stressed result
      expect(stressResult.eclStressGovernor!.fadeFactor).toBeLessThan(1.0);
      expect(healthyResult.eclStressGovernor!.fadeFactor).toBe(1.0);

      // Stressed should have lower intrinsic value
      expect(stressResult.justifiedPB.intrinsicValue!).toBeLessThan(
        healthyResult.justifiedPB.intrinsicValue!
      );

      // The reason should document the fade
      expect(stressResult.justifiedPB.reason).toContain("ECL stress fade");
    });
  });
});
