import { describe, expect, it } from "vitest";
import { compareSnapshots, type ForecastSnapshot } from "..";

const snapshot = (over: Partial<ForecastSnapshot> & { ticker: string; madeAt: string }): ForecastSnapshot => ({
  schemaVersion: "2026-10-forecast-snapshot-v3",
  companyType: "consumer",
  cutoffPeriod: "2025-03-31",
  model: "command-center-base",
  basis: { accounts: "consolidated", lendingArm: null },
  assumptions: { ke: 0.12, kw: 0.1, g: 0.04 },
  anchor: { periodEnd: "2025-03-31", sales: 950, operatingIncome: 140, noa: 390, cni: 110, cse: 700 },
  years: [{ periodEnd: "2026-03-31", sales: 1000, operatingIncome: 150, noa: 400, cni: 120, cse: 800 }],
  intrinsicPerShare: 500,
  ...over,
});

describe("compareSnapshots", () => {
  it("records the value, capital-cost and year-one driver moves of a company frozen in both sets", () => {
    const [change] = compareSnapshots(
      [snapshot({ ticker: "AIRTEL", madeAt: "2026-10-17", intrinsicPerShare: 58.7 })],
      [snapshot({
        ticker: "AIRTEL", madeAt: "2026-10-18", intrinsicPerShare: 44,
        assumptions: { ke: 0.1227, kw: 0.1, g: 0.04 },
        years: [{ periodEnd: "2026-03-31", sales: 1000, operatingIncome: 140, noa: 500, cni: 100, cse: 800 }],
      })],
    );
    expect(change!.valueChange).toBeCloseTo((44 - 58.7) / 58.7, 10);
    expect(change!.ke).toBeCloseTo(0.0027, 10);
    expect(change!.kw).toBe(0);
    expect(change!.margin).toEqual({ from: 0.15, to: 0.14 });
    expect(change!.turnover).toEqual({ from: 2.5, to: 2 });
    expect(change!.basisChange).toBeNull();
  });

  it("says when the forecasts are not of the same anchor or business", () => {
    const [change] = compareSnapshots(
      [snapshot({ ticker: "LT", madeAt: "a", basis: { accounts: "consolidated", lendingArm: null } })],
      [snapshot({ ticker: "LT", madeAt: "b", cutoffPeriod: "2026-03-31", basis: { accounts: "consolidated", lendingArm: "L&T Finance" } })],
    );
    expect(change!.basisChange).toBe("anchor 2025-03 → 2026-03; lending arm none → L&T Finance");
  });

  it("measures a move from a negative value against its magnitude, and compares only companies in both sets", () => {
    const changes = compareSnapshots(
      [snapshot({ ticker: "GRASIM", madeAt: "a", intrinsicPerShare: -708 }), snapshot({ ticker: "IDEA", madeAt: "a" })],
      [snapshot({ ticker: "GRASIM", madeAt: "b", intrinsicPerShare: 721 }), snapshot({ ticker: "PAYTM", madeAt: "b" })],
    );
    expect(changes.map((c) => c.ticker)).toEqual(["GRASIM"]);
    expect(changes[0]!.valueChange).toBeCloseTo((721 + 708) / 708, 10);
  });
});
