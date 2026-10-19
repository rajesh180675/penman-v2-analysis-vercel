import { describe, expect, it } from "vitest";
import { filedCoreOperatingIncome } from "../filedCoreIncome";
import { DEFAULT_CONFIG } from "../../types";

// Revenue 1,000 less expenses of 850, 50 of them finance costs: 200 before tax.
const year = (rate: number, over: Record<string, number | null> = {}) =>
  ({ revenue: 1000, expenses: 850, financeCosts: 50, profitBeforeTax: 240, taxExpense: 240 * rate, ...over });

describe("filedCoreOperatingIncome", () => {
  it("taxes revenue less operating expenses at the effective rate", () => {
    // Other income and exceptional items (in PBT, not in expenses) are left out.
    expect(filedCoreOperatingIncome([year(0.25)])[0]).toBeCloseTo(200 * 0.75, 9);
    expect(filedCoreOperatingIncome([year(0.25, { expenses: null })])).toEqual([null]);
    // NTPC FY2017–18: a record filed with no revenue measures nothing.
    expect(filedCoreOperatingIncome([year(0.25, { revenue: 0 })])).toEqual([null]);
  });

  it("where the recast would not take the effective rate, taxes the items left out at the statutory rate and keeps the rest of the charge", () => {
    const t = DEFAULT_CONFIG.statutory_tax_rate;
    // A ₹1.2 Cr charge on ₹240 Cr of profit (0.5%): core OI is the profit after it less the 40 left out, after tax at t.
    expect(filedCoreOperatingIncome([year(0.005)])[0]).toBeCloseTo(240 - 1.2 - 40 * (1 - t), 9);
    // A loss that books a credit (Airtel FY2020-shaped): the finance costs' shield is credited to financing.
    const credited = { revenue: 1000, expenses: 1100, financeCosts: 300, profitBeforeTax: -100, taxExpense: -28 };
    expect(filedCoreOperatingIncome([credited])[0]).toBeCloseTo(200 * (1 - t) - 100 * t + 28, 9);
    // A loss that books no tax (Vodafone Idea FY2021–25): no shield, so core OI is the pretax figure (isUntaxedLoss).
    expect(filedCoreOperatingIncome([{ ...credited, taxExpense: 1 }])[0]).toBeCloseTo(200 - 1, 9);
    // Power Grid FY2026-shaped: a tax credit beside a regulatory reversal; both stay in core OI.
    const credit = year(0, { taxExpense: -14, regulatoryDeferralMovement: -28 });
    expect(filedCoreOperatingIncome([credit])[0]).toBeCloseTo(200 * (1 - t) + 240 * t + 14 - 28, 9);
  });

  it("taxes an unusual benefit at the median of the three filed rates before it, as the recast does, and keeps a high rate", () => {
    // Airtel FY2025-shaped: a deferred-tax credit takes the rate to 2.4% from about 32%.
    const income = filedCoreOperatingIncome([year(0.1), year(0.31), year(0.32), year(0.33), year(0.024), year(0.5), year(0.25)]);
    // Only the three years before count: 31/32/33%, median 32%, not the 10% of the first.
    expect(income[4]).toBeCloseTo(200 * (1 - 0.32), 9);
    // A rate far above normal recurs (losses the group cannot relieve): kept.
    expect(income[5]).toBeCloseTo(200 * 0.5, 9);
    // 25% is within 10 points of the median of the filed 33%, 2.4% and 50% before it (33%): kept.
    expect(income[6]).toBeCloseTo(200 * 0.75, 9);
  });

  it("adds a rate-regulated entity's regulatory deferral movement and keeps its filed rate", () => {
    // NTPC-shaped: the tax recovered through the tariff is filed in the movement.
    const [, , , regulated] = filedCoreOperatingIncome([year(0.3), year(0.3), year(0.3), year(0.05, { regulatoryDeferralMovement: 30 })]);
    expect(regulated).toBeCloseTo(200 * 0.95 + 30, 9);
  });
});
