import { describe, expect, it } from "vitest";
import { computeBankValuation } from "../bankValuation";
import type { BankPeriodMetrics } from "../bankPipeline";
import { DEFAULT_CONFIG } from "../types";

/**
 * Bank/NBFC terminal-RI regression — spurious (1+g) removed.
 *
 * After the explicit forecast loop, bvForecast = BV_N (end of year N), so
 * terminalRI = (ROE − ke)·BV_N is the residual income of YEAR N+1 on its opening
 * book — the FIRST flow of the terminal perpetuity (RI_{N+1}). The continuing
 * value is therefore RI_{N+1}/(ke − g); the previous `terminalRI·(1+g)/(ke−g)`
 * pushed the first flow to RI_{N+2}, overstating terminal value by exactly (1+g).
 *
 * Triangulated with a flat-fade fixture (latest ROE = long-run ROE) so the book
 * value path is closed-form and the terminal value is hand-checkable.
 */

function bankPeriod(period_end: string, totalEquity: number, roe: number): BankPeriodMetrics {
  return {
    period_end,
    totalAssets: 100_000, totalEquity, advances: 70_000, deposits: 80_000,
    investments: 20_000, borrowings: 5_000, cashAndBalanceWithRBI: 4_000,
    interestEarned: 8_000, interestExpended: 4_000, nii: 4_000, otherIncome: 1_500,
    operatingExpenses: 2_500, provisions: 500, pat: totalEquity * roe, pbt: 2_000,
    nim: 0.04, roa: 0.015, roe, creditCost: 0.007, costToIncome: 0.45, casaRatio: null,
    dividendPaid: null, nonConvertibleDebentures: null, termLoansFromBanks: null,
    termLoansFromInstitutions: null, termLoansFromOthers: null, leverage: null,
    costOfBorrowings: null, yieldOnAdvances: null, spread: null, debtMix: null,
    premiumEarned: null, claimsExpense: null, quality: undefined,
  } as unknown as BankPeriodMetrics;
}

describe("bank equity-residual-income terminal value drops the spurious (1+g)", () => {
  it("computes RI_{N+1}/(ke−g) at the end of the explicit period, not ×(1+g)", () => {
    // Flat fade: latest ROE = LONG_RUN_BANK_ROE = 0.13 → roeT constant at 0.13.
    // payout 0.30 → BV grows 0.13×0.70 = 9.1%/yr. bv0 = 1000 → BV₅ = 1000·1.091⁵.
    // ke = 0.11, g = 0.05:
    //   terminalRI = (0.13 − 0.11)·BV₅ = 0.02·1545.69 = 30.914
    //   TV = 30.914 / (0.06) / 1.11⁵ = 305.77   (old ×(1+g) form: 321.06)
    const metrics = [
      bankPeriod("2021-03-31", 1000, 0.13),
      bankPeriod("2022-03-31", 1000, 0.13),
      bankPeriod("2023-03-31", 1000, 0.13),
    ];
    const cfg = { ...DEFAULT_CONFIG, ke: 0.11, terminal_growth_rate: 0.05 };

    const bundle = computeBankValuation(metrics, cfg, null, /* payoutRatio */ 0.30, false, false);

    expect(bundle.equityResidualIncome.status).toBe("computed");
    const tv = bundle.equityResidualIncome.diagnostics.terminalValue as number;
    // Corrected terminal value.
    expect(tv).toBeCloseTo(305.77, 0);
    // Guard: the old ×(1+g) form would have produced 305.77·1.05 = 321.06.
    expect(tv).toBeLessThan(321.06 - 1);
    // And the ratio between them is exactly (1+g).
    expect(tv * 1.05).toBeCloseTo(321.06, 0);
  });
});
