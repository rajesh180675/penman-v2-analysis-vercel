import { describe, expect, it } from "vitest";
import { crarGovernor } from "../bankValuation/nbfcLenses";
import type { BankPeriodMetrics } from "../bankPipeline";

/**
 * CRAR governor monotonicity regression (#81e).
 *
 * required = NBFC_MIN_CRAR_PCT (15) + NBFC_CRAR_BUFFER_BPS/100 (3) = 18%.
 * headroomBps = (crar − 18) × 100. Three branches throttle g:
 *   headroom ≥ 300 → g                       (full)
 *   0 < headroom < 300 → g × max(h/300, 0.25) (throttled, floored at 0.25×)
 *   headroom ≤ 0 → g × 0.25                   (below-norm floor)
 *
 * Before the floor, the middle branch produced g × (h/300), which drops below
 * 0.25 for headroom < 75bps — so a bank just above the norm got LESS permitted
 * growth than a below-norm bank pinned at the 0.25× floor. That non-monotonicity
 * (and the discontinuity as headroom → 0⁺) is what this guards against.
 */

const G = 0.06;

// crarGovernor only reads m.quality.crar_pct; everything else is irrelevant.
function metricsAtCrar(crarPct: number): BankPeriodMetrics[] {
  return [
    { period_end: "2025-03-31", quality: { crar_pct: crarPct } } as unknown as BankPeriodMetrics,
  ];
}

function effectiveG(crarPct: number): number {
  return crarGovernor(metricsAtCrar(crarPct), G).effectiveG;
}

describe("crarGovernor is monotonic non-decreasing in capital headroom", () => {
  it("a thinly-but-positively-capitalised NBFC never gets less growth than a below-norm one", () => {
    // 18.5% → 50bps headroom: pre-fix g×0.167; post-fix floored to g×0.25.
    // 17.0% → −100bps: below-norm floor g×0.25. Monotonic ⇒ 18.5% ≥ 17%.
    expect(effectiveG(18.5)).toBeGreaterThanOrEqual(effectiveG(17.0));
    // Both pin to the 0.25× floor.
    expect(effectiveG(18.5)).toBeCloseTo(G * 0.25, 10);
    expect(effectiveG(17.0)).toBeCloseTo(G * 0.25, 10);
  });

  it("throttle is non-decreasing across the full headroom sweep", () => {
    const crars = [16, 17, 18, 18.25, 18.5, 18.75, 19, 19.5, 20, 20.5, 21, 22];
    const gs = crars.map(effectiveG);
    for (let i = 1; i < gs.length; i += 1) {
      expect(gs[i]!).toBeGreaterThanOrEqual(gs[i - 1]! - 1e-12);
    }
  });

  it("rewards genuine headroom above the floor band and stops throttling at the +300bps buffer", () => {
    // 19% → 100bps → max(0.333, 0.25) = 0.333× > floor.
    expect(effectiveG(19)).toBeCloseTo(G * (100 / 300), 10);
    expect(effectiveG(19)).toBeGreaterThan(G * 0.25);
    // ≥ 300bps headroom (21%) → no throttle.
    expect(effectiveG(21)).toBeCloseTo(G, 10);
  });
});
