import { describe, it, expect } from "vitest";
import {
  makeFadeArray,
  computeOwnerEarningsDcf,
  solveImpliedKeFromOwnerEarnings,
  solveImpliedTerminalRoicFromValue,
  solveImpliedGrowthForTarget,
} from "../solvers";

/**
 * Unit coverage for the pure numerical solver/DCF cluster extracted from
 * valuationCommandCenter.ts. The bisection solvers were previously reachable
 * only through the 646-LOC buildCoreCommandCenter orchestrator; these tests
 * exercise them in isolation. The strongest checks are round-trips: each solver
 * must invert the forward DCF it is solving against.
 */

describe("makeFadeArray", () => {
  it("fades geometrically from base toward target", () => {
    const arr = makeFadeArray(0.2, 0.5, 0.04, 4);
    expect(arr).toHaveLength(4);
    // next = alpha*prev + (1-alpha)*target ; alpha=0.5, target=0.04
    expect(arr[0]).toBeCloseTo(0.5 * 0.2 + 0.5 * 0.04, 10); // 0.12
    expect(arr[1]).toBeCloseTo(0.5 * arr[0] + 0.5 * 0.04, 10);
    // monotonically approaches target from above
    expect(arr[3]).toBeLessThan(arr[0]);
    expect(arr[3]).toBeGreaterThan(0.04);
  });

  it("returns empty array for zero horizon", () => {
    expect(makeFadeArray(0.1, 0.5, 0.03, 0)).toEqual([]);
  });
});

describe("computeOwnerEarningsDcf", () => {
  it("returns null when base owner earnings is null", () => {
    expect(computeOwnerEarningsDcf(null, [0.1, 0.1], 0.12, 0.02)).toBeNull();
  });

  it("produces a positive value for positive earnings and ke > g", () => {
    const v = computeOwnerEarningsDcf(100, [0.1, 0.1, 0.1], 0.12, 0.02);
    expect(v).not.toBeNull();
    expect(v as number).toBeGreaterThan(0);
  });

  it("suppresses the terminal value when ke - terminalGrowth <= 0.005", () => {
    // ke barely above terminalGrowth -> terminal branch is skipped (returns PV only)
    const withTerminal = computeOwnerEarningsDcf(100, [0.05], 0.10, 0.02) as number;
    const noTerminal = computeOwnerEarningsDcf(100, [0.05], 0.021, 0.02) as number;
    expect(noTerminal).toBeLessThan(withTerminal);
  });

  it("is monotonically decreasing in ke", () => {
    const path = [0.08, 0.08, 0.08];
    const low = computeOwnerEarningsDcf(100, path, 0.08, 0.02) as number;
    const high = computeOwnerEarningsDcf(100, path, 0.18, 0.02) as number;
    expect(low).toBeGreaterThan(high);
  });
});

describe("solveImpliedKeFromOwnerEarnings (round-trip vs computeOwnerEarningsDcf)", () => {
  it("recovers the ke used to generate the target price", () => {
    const ownerEarningsPerShare = 100;
    const growthPath = [0.1, 0.1, 0.1, 0.08, 0.06];
    const terminalGrowth = 0.02;
    const trueKe = 0.13;
    const targetPrice = computeOwnerEarningsDcf(ownerEarningsPerShare, growthPath, trueKe, terminalGrowth) as number;

    const solved = solveImpliedKeFromOwnerEarnings({
      targetPrice,
      ownerEarningsPerShare,
      growthPath,
      terminalGrowth,
    });
    expect(solved).not.toBeNull();
    expect(solved as number).toBeCloseTo(trueKe, 4);
  });

  it("returns null for non-positive target price or earnings", () => {
    expect(
      solveImpliedKeFromOwnerEarnings({
        targetPrice: 0,
        ownerEarningsPerShare: 100,
        growthPath: [0.1],
        terminalGrowth: 0.02,
      })
    ).toBeNull();
    expect(
      solveImpliedKeFromOwnerEarnings({
        targetPrice: 1000,
        ownerEarningsPerShare: null,
        growthPath: [0.1],
        terminalGrowth: 0.02,
      })
    ).toBeNull();
  });

  it("returns null when the target lies outside the bracketable ke band", () => {
    // An absurdly high price cannot be matched by any ke in [0.04, 0.40].
    const solved = solveImpliedKeFromOwnerEarnings({
      targetPrice: 1e9,
      ownerEarningsPerShare: 100,
      growthPath: [0.1, 0.1, 0.1],
      terminalGrowth: 0.02,
    });
    expect(solved).toBeNull();
  });
});

describe("solveImpliedTerminalRoicFromValue (closed form)", () => {
  it("matches the analytic implied ROIC formula", () => {
    const targetPrice = 200;
    const shares = 10;
    const cse0 = 500;
    const noaT = 800;
    const kw = 0.11;
    const equityValue = targetPrice * shares; // 2000
    const expected = kw + ((equityValue - cse0) * kw) / noaT;

    const solved = solveImpliedTerminalRoicFromValue({ targetPrice, shares, cse0, noaT, kw });
    expect(solved).not.toBeNull();
    expect(solved as number).toBeCloseTo(expected, 10);
  });

  it("returns null for guard violations and out-of-band ROIC", () => {
    expect(solveImpliedTerminalRoicFromValue({ targetPrice: null, shares: 10, cse0: 1, noaT: 1, kw: 0.1 })).toBeNull();
    expect(solveImpliedTerminalRoicFromValue({ targetPrice: 100, shares: 0, cse0: 1, noaT: 1, kw: 0.1 })).toBeNull();
    expect(solveImpliedTerminalRoicFromValue({ targetPrice: 100, shares: 10, cse0: 1, noaT: 0, kw: 0.1 })).toBeNull();
    // implied ROIC > 2.0 -> rejected
    expect(
      solveImpliedTerminalRoicFromValue({ targetPrice: 1e6, shares: 100, cse0: 0, noaT: 1, kw: 0.1 })
    ).toBeNull();
  });
});

describe("solveImpliedGrowthForTarget (round-trip via makeFadeArray + DCF)", () => {
  it("recovers the base growth used to generate the target price", () => {
    const ownerEarningsPerShare = 80;
    const ke = 0.12;
    const terminalGrowth = 0.02;
    const normalizedGrowth = 0.05;
    const horizon = 5;
    const growthFadeAlpha = 0.6;
    const trueGrowth = 0.15;

    const path = makeFadeArray(trueGrowth, growthFadeAlpha, normalizedGrowth, horizon);
    const targetPrice = computeOwnerEarningsDcf(ownerEarningsPerShare, path, ke, terminalGrowth) as number;

    const solved = solveImpliedGrowthForTarget({
      ownerEarningsPerShare,
      targetPrice,
      ke,
      terminalGrowth,
      normalizedGrowth,
      horizon,
      growthFadeAlpha,
    });
    expect(solved).not.toBeNull();
    expect(solved as number).toBeCloseTo(trueGrowth, 4);
  });

  it("returns null for non-positive target or null earnings", () => {
    expect(
      solveImpliedGrowthForTarget({
        ownerEarningsPerShare: null,
        targetPrice: 100,
        ke: 0.12,
        terminalGrowth: 0.02,
        normalizedGrowth: 0.05,
        horizon: 5,
        growthFadeAlpha: 0.6,
      })
    ).toBeNull();
    expect(
      solveImpliedGrowthForTarget({
        ownerEarningsPerShare: 80,
        targetPrice: 0,
        ke: 0.12,
        terminalGrowth: 0.02,
        normalizedGrowth: 0.05,
        horizon: 5,
        growthFadeAlpha: 0.6,
      })
    ).toBeNull();
  });
});
