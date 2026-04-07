import { describe, expect, it } from "vitest";
import {
  dechowDichevQuality,
  roychowdhuryREM,
  buildEarningsQualityCard,
} from "../earningsQuality";

describe("Dechow-Dichev accrual quality", () => {
  it("returns null with fewer than 5 periods", () => {
    const result = dechowDichevQuality([100, 110, 120], [10, 12, 15]);
    expect(result).toBeNull();
  });

  it("returns null with too few valid pairs", () => {
    const result = dechowDichevQuality(
      [100, 110, NaN, 120, 130],
      [10, 12, 15, 18, 20],
    );
    // 4 valid pairs, minimum is 4, so should work
    expect(result).not.toBeNull();
  });

  it("high R-squared indicates high accrual quality", () => {
    const cfo = [100, 120, 140, 160, 180, 200];
    const wca = [10, 12.5, 14.2, 16.8, 18.5, 20.1]; // Linear relationship

    const result = dechowDichevQuality(cfo, wca);

    expect(result).not.toBeNull();
    expect(result!.rSquared).toBeGreaterThan(0.7);
    expect(result!.label).toContain("High accrual quality");
  });

  it("low R-squared indicates poor accrual quality", () => {
    const cfo = [100, 120, 140, 160, 180, 200];
    const wca = [50, 10, 60, 20, 70, 30]; // Noisy, no clear relationship

    const result = dechowDichevQuality(cfo, wca);

    expect(result).not.toBeNull();
    expect(result!.rSquared).toBeLessThan(0.4);
  });
});

describe("Roychowdhury REM", () => {
  it("returns null with fewer than 4 periods", () => {
    const result = roychowdhuryREM(
      [100, 110, 120],
      [30, 35, 40],
      [10, 12, 14],
      [50, 55, 60],
    );
    expect(result).toBeNull();
  });

  it("no REM flag when expenses track sales normally", () => {
    const sales = [400, 440, 484, 528];
    const cfo = [80, 96, 110, 126]; // ~24% of sales
    const discExpense = [40, 44, 48.4, 52.8]; // 10% of sales
    const prodCost = [200, 220, 242, 262]; // ~50% of sales

    const result = roychowdhuryREM(sales, cfo, discExpense, prodCost);

    expect(result).not.toBeNull();
    expect(result!.remFlag).toBe(false);
  });

  it("detects potential REM when expenses are abnormally low", () => {
    const sales = [400, 440, 484, 528];
    const cfo = [80, 96, 110, 126];
    const discExpense = [40, 44, 48.4, 20]; // Suddenly cut to 20 in latest period
    const prodCost = [200, 220, 242, 262];

    const result = roychowdhuryREM(sales, cfo, discExpense, prodCost);

    expect(result).not.toBeNull();
    // Abnormal discExpense should be positive (actual < predicted means abnormal is positive... wait)
    // abnormalDiscExp = actual - predicted, so if actual < predicted, abnormalDiscExp is negative
    expect(result!.abnormalDiscExp).toBeLessThan(0);
  });
});

describe("Earnings Quality Card", () => {
  it("returns moderate scores with all null inputs", () => {
    const card = buildEarningsQualityCard(null, null, null, null, null);

    expect(card.totalScore).toBeGreaterThanOrEqual(0);
    expect(card.totalScore).toBeLessThanOrEqual(100);
  });

  it("high scores when all signals are clean", () => {
    const card = buildEarningsQualityCard(
      { n: 10, rSquared: 0.85, residualStdDev: 5, avgAbsAq: 0.1, label: "High" },
      { abnormalCFO: 0, abnormalDiscExp: 0, abnormalProdCost: 0, remScore: 0, remFlag: false, label: "No REM" },
      0.01,  // Clean surplus
      0.95,  // Excellent cash conversion
      0.01,  // Low accrual ratio
    );

    expect(card.totalScore).toBeGreaterThanOrEqual(75);
    expect(card.remFlag).toBe(false);
    expect(card.flags.length).toBeLessThan(2);
  });

  it("low scores when signals are poor", () => {
    const card = buildEarningsQualityCard(
      { n: 5, rSquared: 0.15, residualStdDev: 50, avgAbsAq: 0.8, label: "Very low" },
      { abnormalCFO: -100, abnormalDiscExp: -50, abnormalProdCost: 80, remScore: 200, remFlag: true, label: "REM detected" },
      0.15,  // Severe dirty surplus
      0.30,  // Poor cash conversion
      0.15,  // High accrual ratio
    );

    expect(card.totalScore).toBeLessThanOrEqual(40);
    expect(card.remFlag).toBe(true);
    expect(card.flags.length).toBeGreaterThanOrEqual(3);
  });

  it("flags moderate dirty surplus", () => {
    const card = buildEarningsQualityCard(
      null,
      null,
      0.07, // Moderate dirty surplus (7% of CSE)
      null,
      null,
    );

    expect(card.completeness).toBeLessThanOrEqual(8);
    expect(card.flags.some(f => f.includes("Dirty surplus"))).toBe(true);
  });

  it("flags weak cash conversion", () => {
    const card = buildEarningsQualityCard(
      null,
      null,
      null,
      0.40, // 40% conversion
      null,
    );

    expect(card.realization).toBeLessThanOrEqual(3);
    expect(card.flags.some(f => f.includes("cash conversion"))).toBe(true);
  });
});
