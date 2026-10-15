import { describe, expect, it } from "vitest";
import type { OperatingFigures } from "../../filings/xbrlInstance";
import { asFiledCoreOperatingIncome, asFiledNoa, asFiledRnoaPoints } from "../asFiledRnoa";

const figures = (fields: Partial<OperatingFigures>): OperatingFigures => ({
  revenue: null, expenses: null, financeCosts: null, profitBeforeTax: null, taxExpense: null,
  assets: null, equity: null, borrowings: null, cash: null, investments: null, loans: null,
  ...fields,
});

describe("asFiledCoreOperatingIncome", () => {
  it("is revenue less expenses other than finance costs, at the effective tax rate", () => {
    // 1,000 − (800 − 50) = 250 before tax; tax 60 on PBT 240 is 25%.
    const income = asFiledCoreOperatingIncome(figures({ revenue: 1000, expenses: 800, financeCosts: 50, profitBeforeTax: 240, taxExpense: 60 }));
    expect(income).toBeCloseTo(250 * 0.75, 6);
  });

  it("falls back to the statutory rate for a loss or an implausible effective rate", () => {
    expect(asFiledCoreOperatingIncome(figures({ revenue: 1000, expenses: 900, profitBeforeTax: -10, taxExpense: 5 }))).toBeCloseTo(100 * (1 - 0.2517), 6);
    expect(asFiledCoreOperatingIncome(figures({ revenue: 1000, expenses: 900, profitBeforeTax: 100, taxExpense: 70 }))).toBeCloseTo(100 * (1 - 0.2517), 6);
  });

  it("is null without the income-statement totals", () => {
    expect(asFiledCoreOperatingIncome(figures({ revenue: 1000 }))).toBeNull();
  });
});

describe("asFiledNoa", () => {
  it("is equity plus borrowings less cash and every investment", () => {
    expect(asFiledNoa(figures({ assets: 2000, equity: 1000, borrowings: 300, cash: 100, investments: 200 }))).toBe(1000);
  });

  it("reads an untagged line in a filed balance sheet as zero", () => {
    expect(asFiledNoa(figures({ assets: 2000, equity: 1000, cash: 100 }))).toBe(900);
  });

  it("is null for a filing without a balance sheet", () => {
    expect(asFiledNoa(figures({ equity: 1000 }))).toBeNull();
  });
});

describe("asFiledRnoaPoints", () => {
  const year = (noa: number, income: number) => figures({ revenue: income, expenses: 0, assets: noa, equity: noa, profitBeforeTax: income, taxExpense: income * 0.25 });

  it("divides each year's core operating income by the previous year's NOA", () => {
    const points = asFiledRnoaPoints(new Map([[2023, year(1000, 100)], [2024, year(1200, 200)], [2025, year(1500, 240)]]));
    expect(points.map((p) => p.year)).toEqual([2024, 2025]);
    expect(points[0]!.rnoa).toBeCloseTo((200 * 0.75) / 1000, 6);
    expect(points[1]!.rnoa).toBeCloseTo((240 * 0.75) / 1200, 6);
  });

  it("skips a year whose opening year is missing or has no positive NOA", () => {
    const points = asFiledRnoaPoints(new Map([[2023, year(-50, 100)], [2024, year(1000, 100)], [2026, year(1000, 100)]]));
    expect(points).toEqual([]);
  });
});
