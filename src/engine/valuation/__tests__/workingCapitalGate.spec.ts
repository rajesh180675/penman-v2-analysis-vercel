/* ================================================================
   Plan 5b PR-5b.3 — Working-capital gate contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import {
  computeCcc,
  evaluateWorkingCapitalGate,
  SECTOR_CCC_P95,
} from "../workingCapitalGate";

function fmcgPeriod(year: number, ccrLevel: "healthy" | "stretched" | "spike" = "healthy") {
  // Tweak inventory/receivables to hit different CCC regimes for FMCG (P95 = 75d).
  const revenue = 10_000;
  const cogs = 6_000;
  let receivables = 500;
  let inventory = 700;
  const payables = 800;
  if (ccrLevel === "stretched") {
    receivables = 1_200;
    inventory = 1_400;
  }
  if (ccrLevel === "spike") {
    receivables = 2_000;
    inventory = 2_400;
  }
  return {
    periodEnd: `${year}-03-31`,
    revenue,
    cogs,
    receivables,
    inventory,
    payables,
  };
}

describe("computeCcc (Plan 5b PR-5b.3)", () => {
  it("classic textbook example: rev 1000, cogs 600, AR 100, inv 80, AP 50", () => {
    const r = computeCcc({
      periodEnd: "2024-03-31",
      revenue: 1000,
      cogs: 600,
      receivables: 100,
      inventory: 80,
      payables: 50,
    });
    expect(r.dso).toBeCloseTo(36.5, 1); // 100/1000 * 365
    expect(r.dio).toBeCloseTo(48.667, 2); // 80/600 * 365
    expect(r.dpo).toBeCloseTo(30.417, 2); // 50/600 * 365
    expect(r.ccc).toBeCloseTo(54.75, 1);
  });

  it("zero revenue/cogs -> 0 components (no NaN leak)", () => {
    const r = computeCcc({
      periodEnd: "2024-03-31",
      revenue: 0,
      cogs: 0,
      receivables: 100,
      inventory: 80,
      payables: 50,
    });
    expect(r.dso).toBe(0);
    expect(r.dio).toBe(0);
    expect(r.dpo).toBe(0);
    expect(r.ccc).toBe(0);
  });

  it("custom days-in-period (quarterly = 90)", () => {
    const r = computeCcc({
      periodEnd: "2024-06-30",
      revenue: 1000,
      cogs: 600,
      receivables: 100,
      inventory: 80,
      payables: 50,
      daysInPeriod: 90,
    });
    expect(r.dso).toBeCloseTo(9, 1); // 100/1000 * 90
  });
});

describe("evaluateWorkingCapitalGate (Plan 5b PR-5b.3)", () => {
  it("flat healthy CCC + below-P95 threshold -> 'healthy'", () => {
    const r = evaluateWorkingCapitalGate({
      periods: [fmcgPeriod(2022), fmcgPeriod(2023), fmcgPeriod(2024)],
      sectorKey: "FMCG",
    });
    expect(r.verdict).toBe("healthy");
    expect(r.latestCcc).toBeLessThan(r.sectorP95);
  });

  it("stretched CCC (>P95) but flat trend -> 'stretched'", () => {
    const r = evaluateWorkingCapitalGate({
      periods: [
        fmcgPeriod(2022, "stretched"),
        fmcgPeriod(2023, "stretched"),
        fmcgPeriod(2024, "stretched"),
      ],
      sectorKey: "FMCG",
    });
    expect(r.verdict).toBe("stretched");
    expect(r.latestCcc).toBeGreaterThan(r.sectorP95);
  });

  it("widening CCC + breaching P95 -> 'distressed'", () => {
    const r = evaluateWorkingCapitalGate({
      periods: [
        fmcgPeriod(2022, "healthy"),
        fmcgPeriod(2023, "stretched"),
        fmcgPeriod(2024, "spike"),
      ],
      sectorKey: "FMCG",
    });
    expect(r.verdict).toBe("distressed");
    expect(r.trendDeltaDays).toBeGreaterThan(30);
  });

  it("requires at least 2 periods", () => {
    expect(() =>
      evaluateWorkingCapitalGate({
        periods: [fmcgPeriod(2024)],
        sectorKey: "FMCG",
      }),
    ).toThrow();
  });

  it("unknown sectorKey falls back to default 120d threshold", () => {
    const r = evaluateWorkingCapitalGate({
      periods: [fmcgPeriod(2023), fmcgPeriod(2024)],
      sectorKey: "not-a-real-sector",
    });
    expect(r.sectorP95).toBe(120);
  });

  it("sectorP95Override wins over sectorKey", () => {
    const r = evaluateWorkingCapitalGate({
      periods: [fmcgPeriod(2023), fmcgPeriod(2024)],
      sectorKey: "FMCG", // 75
      sectorP95Override: 200,
    });
    expect(r.sectorP95).toBe(200);
  });

  it("DSO-dominated CCC surfaces a channel-stuffing diagnostic", () => {
    const r = evaluateWorkingCapitalGate({
      periods: [
        { periodEnd: "2023-03-31", revenue: 10000, cogs: 6000, receivables: 200, inventory: 200, payables: 800 },
        { periodEnd: "2024-03-31", revenue: 10000, cogs: 6000, receivables: 4000, inventory: 200, payables: 800 },
      ],
      sectorKey: "FMCG",
    });
    expect(r.diagnostics.some((d) => d.includes("channel-stuffing"))).toBe(true);
  });

  it("Pharma sector has a higher P95 than FMCG (140 vs 75)", () => {
    expect(SECTOR_CCC_P95.Pharma).toBeGreaterThan(SECTOR_CCC_P95.FMCG ?? 0);
  });
});
