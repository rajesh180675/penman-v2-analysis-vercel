/* ================================================================
   Cash-lens FCFF DCF (#poly-paradigm Phase 1.1).

   The whole point of this lens is INDEPENDENCE from the Penman-Nissim
   accrual recast: it must value off cf.FCF_cash alone and ignore NOA/OI/CNI.
   The independence test is therefore load-bearing — it proves the lens can
   genuinely DISAGREE with the accrual models (which is what the Phase 1.2
   reconciliation gate needs). The skip tests prove it never emits a
   misleading number (too-few periods, no Gordon spread) — honest-null, not
   zero. Negative free cash flow is evidence, not a skip: it is valued.

   Fixtures are deliberately minimal: computeCashFlowDcf reads exactly four
   fields (kwStructural, cf.FCF_cash, bs.NFO, bs.MI). NOA/OI are populated
   ONLY so the independence test can vary them and assert the output is
   unaffected. The cast documents "only these fields are under test".
================================================================ */

import { describe, expect, it } from "vitest";
import { computeCashFlowDcf } from "../cashFlowDcf";
import { evaluateReconciliationResiduals } from "../reconciliationResiduals";
import { buildValuationTriangulationEvidence } from "../valuationTriangulation";
import { DEFAULT_CONFIG, EngineConfig, RecastPeriod } from "../types";

interface PeriodOpts {
  fcf: number;
  kwStructural?: number | null;
  NFO?: number;
  MI?: number;
  NOA?: number;
  OI?: number;
}

/** Minimal RecastPeriod carrying only the fields the DCF reads (+ NOA/OI noise). */
function mkPeriod(period_end: string, o: PeriodOpts): RecastPeriod {
  return {
    period_end,
    kwStructural: o.kwStructural === undefined ? 0.1 : o.kwStructural,
    bs: { NFO: o.NFO ?? 0, MI: o.MI ?? 0, NOA: o.NOA ?? 500 },
    is: { OI: o.OI ?? 80 },
    cf: { FCF_cash: o.fcf },
  } as unknown as RecastPeriod;
}

const CONFIG: EngineConfig = { ...DEFAULT_CONFIG };

describe("computeCashFlowDcf — independent cash lens", () => {
  it("values a clean rising-FCF series and bridges EV → equity by −NFO −MI", () => {
    const periods = [
      mkPeriod("2022-03-31", { fcf: 100, NFO: 200, MI: 50 }),
      mkPeriod("2023-03-31", { fcf: 110, NFO: 200, MI: 50 }),
      mkPeriod("2024-03-31", { fcf: 120, NFO: 200, MI: 50 }),
    ];
    const r = computeCashFlowDcf(periods, CONFIG, 100);
    expect(r).not.toBeNull();
    expect(r!.enterpriseValue).toBeGreaterThan(0);
    // Equity = EV − net debt − minority, exactly.
    expect(r!.equityValue).toBeCloseTo(r!.enterpriseValue - 200 - 50, 6);
    expect(r!.perShare).toBeCloseTo(r!.equityValue / 100, 6);
    expect(r!.kw).toBe(0.1);
    expect(r!.baseFcf).toBe(110); // median of [100,110,120]
  });

  it("subtracts the minority claim the accrual bridge settled on, not its book", () => {
    const periods = [
      mkPeriod("2022-03-31", { fcf: 100, NFO: 200, MI: 50 }),
      mkPeriod("2023-03-31", { fcf: 110, NFO: 200, MI: 50 }),
      mkPeriod("2024-03-31", { fcf: 120, NFO: 200, MI: 50 }),
    ];
    const r = computeCashFlowDcf(periods, CONFIG, 100, { minorityClaim: 20 })!;
    expect(r.equityValue).toBeCloseTo(r.enterpriseValue - 200 - 20, 6);
  });

  it("is INDEPENDENT of the accrual recast: NOA/OI changes do not move the value", () => {
    const accrualA = [
      mkPeriod("2022-03-31", { fcf: 100, NOA: 500, OI: 80 }),
      mkPeriod("2023-03-31", { fcf: 110, NOA: 520, OI: 85 }),
      mkPeriod("2024-03-31", { fcf: 120, NOA: 540, OI: 90 }),
    ];
    // Same cash flow, NFO, MI, kw — wildly different accrual NOA/OI.
    const accrualB = [
      mkPeriod("2022-03-31", { fcf: 100, NOA: 50, OI: 8 }),
      mkPeriod("2023-03-31", { fcf: 110, NOA: 4000, OI: 1200 }),
      mkPeriod("2024-03-31", { fcf: 120, NOA: -300, OI: -50 }),
    ];
    const ra = computeCashFlowDcf(accrualA, CONFIG, 100)!;
    const rb = computeCashFlowDcf(accrualB, CONFIG, 100)!;
    expect(rb.enterpriseValue).toBeCloseTo(ra.enterpriseValue, 9);
    expect(rb.equityValue).toBeCloseTo(ra.equityValue, 9);
  });

  it("falls back to config kw (positive) when no structural kw is stamped", () => {
    const periods = [
      mkPeriod("2023-03-31", { fcf: 100, kwStructural: null }),
      mkPeriod("2024-03-31", { fcf: 110, kwStructural: null }),
    ];
    const r = computeCashFlowDcf(periods, CONFIG, 100);
    expect(r).not.toBeNull();
    expect(r!.kw).toBeGreaterThan(0);
  });

  it("skips honestly (null) with fewer than two periods", () => {
    expect(computeCashFlowDcf([mkPeriod("2024-03-31", { fcf: 100 })], CONFIG, 100)).toBeNull();
    expect(computeCashFlowDcf([], CONFIG, 100)).toBeNull();
  });

  it("values a non-positive base instead of skipping it: the equity comes out below the bridge", () => {
    // DMart-shaped: the business consumed cash over the window. Median of
    // [-10,-5,-8] = -8, so the enterprise value is negative and so, with no
    // net cash to offset it, is the equity.
    const periods = [
      mkPeriod("2022-03-31", { fcf: -10 }),
      mkPeriod("2023-03-31", { fcf: -5 }),
      mkPeriod("2024-03-31", { fcf: -8 }),
    ];
    const r = computeCashFlowDcf(periods, CONFIG, 100);
    expect(r).not.toBeNull();
    expect(r!.baseFcf).toBe(-8);
    expect(r!.enterpriseValue).toBeLessThan(0);
    expect(r!.perShare).toBeLessThan(0);
  });

  it("lets a cash-consuming business fail the triangulation it used to skip", () => {
    // The skip left one paradigm, so the check was absent and production-ready
    // went uncorroborated, while a small positive flow (NTPC) failed it.
    const periods = [
      mkPeriod("2022-03-31", { fcf: -10 }),
      mkPeriod("2023-03-31", { fcf: -5 }),
      mkPeriod("2024-03-31", { fcf: -8 }),
    ];
    const evidence = buildValuationTriangulationEvidence({
      scenarios: [{ key: "base", valuation: { perShare: { intrinsic_re_per_share: 369, intrinsic_reoi_per_share: 368 } } } as never],
      cashFlowDcf: computeCashFlowDcf(periods, CONFIG, 100),
    });
    const check = evaluateReconciliationResiduals({
      config: CONFIG,
      valuationTriangulation: evidence,
    }).checks.find((entry) => entry.key === "valuation-triangulation");
    expect(check?.status).toBe("failed");
    expect(check?.detail).toContain("compared as ₹0");
  });

  it("returns null per-share (but a finite equity value) when shares are unavailable", () => {
    const periods = [
      mkPeriod("2023-03-31", { fcf: 100 }),
      mkPeriod("2024-03-31", { fcf: 110 }),
    ];
    const r = computeCashFlowDcf(periods, CONFIG, null);
    expect(r).not.toBeNull();
    expect(r!.perShare).toBeNull();
    expect(Number.isFinite(r!.equityValue)).toBe(true);
  });

  it("fails closed when terminal growth does not clear the kw−g spread guard", () => {
    const periods = [
      mkPeriod("2023-03-31", { fcf: 100, kwStructural: 0.12 }),
      mkPeriod("2024-03-31", { fcf: 110, kwStructural: 0.12 }),
    ];
    // An explicit-period-only positive value would look computed even though
    // the terminal model is invalid. Honest null keeps it out of synthesis.
    expect(computeCashFlowDcf(periods, CONFIG, 100, { terminalGrowth: 0.4 })).toBeNull();
    expect(computeCashFlowDcf(periods, CONFIG, 100, { terminalGrowth: 0.115 })).toBeNull();
  });

  it("computes when terminal growth leaves more than the minimum spread", () => {
    const periods = [
      mkPeriod("2023-03-31", { fcf: 100, kwStructural: 0.12 }),
      mkPeriod("2024-03-31", { fcf: 110, kwStructural: 0.12 }),
    ];
    const r = computeCashFlowDcf(periods, CONFIG, 100, { terminalGrowth: 0.11 });
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.enterpriseValue)).toBe(true);
    expect(r!.enterpriseValue).toBeGreaterThan(0);
  });
});
