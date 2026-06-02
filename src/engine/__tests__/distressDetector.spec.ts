import { describe, it, expect } from "vitest";
import { detectDistress } from "../distressDetector";
import type { RecastPeriod } from "../types";

/**
 * Build a minimal RecastPeriod for distress testing. Only the fields the
 * detector reads are populated; everything else is left as a typed stub
 * so we can keep the fixtures concise.
 */
function period(
  period_end: string,
  overrides: { CSE?: number; NFO?: number; CFO?: number } = {},
): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 0,
      CSE: overrides.CSE ?? 1000,
      MI: 0,
      FA: 0,
      FO: 0,
      OA: 0,
      OL: 0,
      NOA: 0,
      NFO: overrides.NFO ?? 0,
    } as RecastPeriod["bs"],
    is: {} as RecastPeriod["is"],
    cu: {} as RecastPeriod["cu"],
    cf: { CFO: overrides.CFO ?? 0 } as RecastPeriod["cf"],
  };
}

describe("distressDetector", () => {
  it("returns clean state for empty input", () => {
    const result = detectDistress([]);
    expect(result.severity).toBe("none");
    expect(result.hasNegativeEquity).toBe(false);
    expect(result.equityModelsBlocked).toBe(false);
    expect(result.totalPeriods).toBe(0);
  });

  it("returns clean state for null/undefined", () => {
    expect(detectDistress(null).severity).toBe("none");
    expect(detectDistress(undefined).severity).toBe("none");
  });

  it("returns clean state when all periods have positive equity", () => {
    const periods = [
      period("2021-03-31", { CSE: 1000 }),
      period("2022-03-31", { CSE: 1100 }),
      period("2023-03-31", { CSE: 1200 }),
      period("2024-03-31", { CSE: 1300 }),
    ];
    const result = detectDistress(periods);
    expect(result.severity).toBe("none");
    expect(result.hasNegativeEquity).toBe(false);
    expect(result.negativeEquityPeriods).toBe(0);
    expect(result.equityModelsBlocked).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it("flags warning for isolated mid-history negative period (latest still positive)", () => {
    // Single restructuring-charge year, recovered afterwards.
    const periods = [
      period("2020-03-31", { CSE: 800 }),
      period("2021-03-31", { CSE: -200 }),
      period("2022-03-31", { CSE: 400 }),
      period("2023-03-31", { CSE: 700 }),
      period("2024-03-31", { CSE: 1000 }),
    ];
    const result = detectDistress(periods);
    expect(result.severity).toBe("warning");
    expect(result.hasNegativeEquity).toBe(true);
    expect(result.negativeEquityPeriods).toBe(1);
    expect(result.latestCSENegative).toBe(false);
    // Warning should NOT block equity-side models — latest CSE is positive
    expect(result.equityModelsBlocked).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("flags severe when latest CSE is negative", () => {
    const periods = [
      period("2022-03-31", { CSE: 1000 }),
      period("2023-03-31", { CSE: 500 }),
      period("2024-03-31", { CSE: -300 }),
    ];
    const result = detectDistress(periods);
    expect(result.severity).toBe("severe");
    expect(result.latestCSENegative).toBe(true);
    expect(result.equityModelsBlocked).toBe(true);
    expect(result.latestCSE).toBe(-300);
    expect(result.reasons.some((r) => r.includes("Latest"))).toBe(true);
  });

  it("flags warning for recovered multi-period historical negative equity (latest still positive)", () => {
    const periods = [
      period("2020-03-31", { CSE: 1000 }),
      period("2021-03-31", { CSE: -100 }),
      period("2022-03-31", { CSE: -200 }),
      period("2023-03-31", { CSE: 50 }),
      period("2024-03-31", { CSE: 200, CFO: 250 }),
    ];
    const result = detectDistress(periods);
    expect(result.severity).toBe("warning");
    expect(result.latestCSENegative).toBe(false);
    expect(result.equityModelsBlocked).toBe(false);
    expect(result.reasons.some((r) => r.includes("historical negative-equity"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("not current financial distress"))).toBe(true);
  });

  it("flags critical when latest CSE negative + 3+ consecutive + CFO ≤ 0 (Vodafone Idea pattern)", () => {
    // Five consecutive years of negative equity, latest CFO also negative
    const periods = [
      period("2020-03-31", { CSE: -5000, CFO: 5000 }),
      period("2021-03-31", { CSE: -8000, CFO: 4000 }),
      period("2022-03-31", { CSE: -12000, CFO: 3000 }),
      period("2023-03-31", { CSE: -15000, CFO: 2000 }),
      period("2024-03-31", { CSE: -20000, CFO: -500, NFO: -2000 }),
    ];
    const result = detectDistress(periods);
    expect(result.severity).toBe("critical");
    expect(result.equityModelsBlocked).toBe(true);
    expect(result.latestCSENegative).toBe(true);
    expect(result.negativeEquityPeriods).toBe(5);
    // Critical should include going-concern reason
    expect(result.reasons.some((r) => r.includes("going-concern"))).toBe(true);
    // Runway: 2000 / 500 = 4 years
    expect(result.runwayYearsAtCFOBurn).toBeCloseTo(4.0, 1);
  });

  it("does NOT escalate to critical when CFO is positive even with sustained negative equity", () => {
    // Self-funded turnaround: equity still negative but operations cash-positive
    const periods = [
      period("2021-03-31", { CSE: -1000, CFO: 500 }),
      period("2022-03-31", { CSE: -800, CFO: 600 }),
      period("2023-03-31", { CSE: -500, CFO: 700 }),
      period("2024-03-31", { CSE: -200, CFO: 800 }),
    ];
    const result = detectDistress(periods);
    expect(result.severity).toBe("severe");
    expect(result.equityModelsBlocked).toBe(true);
    expect(result.runwayYearsAtCFOBurn).toBeNull();
  });

  it("handles boundary CSE = 0 as negative (insolvent)", () => {
    const periods = [
      period("2022-03-31", { CSE: 100 }),
      period("2023-03-31", { CSE: 50 }),
      period("2024-03-31", { CSE: 0 }),
    ];
    const result = detectDistress(periods);
    expect(result.latestCSENegative).toBe(true);
    expect(result.severity).toBe("severe");
    expect(result.equityModelsBlocked).toBe(true);
  });

  it("ignores null/NaN CSE values in counting", () => {
    const periods = [
      period("2021-03-31", { CSE: 1000 }),
      // Simulate parser gap with explicitly null
      {
        ...period("2022-03-31"),
        bs: { ...period("2022-03-31").bs, CSE: NaN },
      } as RecastPeriod,
      period("2023-03-31", { CSE: 1100 }),
    ];
    const result = detectDistress(periods);
    expect(result.hasNegativeEquity).toBe(false);
    expect(result.severity).toBe("none");
  });

  it("sorts unsorted input before evaluating latest", () => {
    // Pass periods in reverse order; detector should still pick the
    // chronologically latest as the gate.
    const periods = [
      period("2024-03-31", { CSE: -100 }),
      period("2022-03-31", { CSE: 500 }),
      period("2023-03-31", { CSE: 200 }),
    ];
    const result = detectDistress(periods);
    expect(result.latestCSE).toBe(-100);
    expect(result.severity).toBe("severe");
  });
});
