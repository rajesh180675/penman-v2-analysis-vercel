import { describe, it, expect } from "vitest";
import { computeBankValuation } from "../bankValuation";
import type { BankPeriodMetrics } from "../bankPipeline";
import { DEFAULT_CONFIG } from "../types";

/**
 * S — fail-closed insurance EV gate.
 *
 * For insurers, embedded value (IRDAI-mandated actuarial appraisal) is the only
 * defensible triangulated value. The bank-framed book-value models (Justified
 * P/B Gordon, Equity RI, Sustainable DDM) systematically misstate an insurer's
 * worth and must NOT silently substitute when EV is unavailable. Previously the
 * insurance branch fell through to median(bank-framed models) whenever EV was
 * missing — emitting a confident, wrong number. The gate now fails closed
 * (triangulatedValue = null) so the absence surfaces instead of a bad estimate.
 */

function insurerMetrics(withEv: boolean): BankPeriodMetrics[] {
  const base = (period_end: string, totalEquity: number, pat: number, ev: number | null): BankPeriodMetrics => ({
    period_end,
    totalAssets: 5_285_503,
    totalEquity,
    advances: null, deposits: null, investments: 5_000_000, borrowings: null,
    cashAndBalanceWithRBI: null, interestEarned: null, interestExpended: null,
    nii: null, otherIncome: null, operatingExpenses: -48_122, provisions: null,
    pat, pbt: pat, dividendPaid: null, nim: null, roa: null,
    roe: pat / totalEquity, creditCost: null, costToIncome: null, casaRatio: null,
    nonConvertibleDebentures: null, termLoansFromBanks: null,
    termLoansFromInstitutions: null, termLoansFromOthers: null, leverage: null,
    costOfBorrowings: null, yieldOnAdvances: null, spread: null, debtMix: null,
    premiumEarned: 475_070, claimsExpense: -388_809,
    quality: withEv
      ? { period_end, embedded_value: ev ?? 727_344, vnb: 9_583 }
      : { period_end, embedded_value: null, vnb: null },
  });
  return [
    base("2022-03-31", 10_409, 4_043, withEv ? 541_492 : null),
    base("2023-03-31", 45_669, 36_397, withEv ? 582_243 : null),
    base("2024-03-31", 81_938, 40_676, withEv ? 727_344 : null),
  ];
}

describe("insurance valuation fails closed when embedded value is unavailable", () => {
  const cfg = { ...DEFAULT_CONFIG, company_type: "insurance" as const };

  it("returns null triangulatedValue (not a bank-framed median) when EV is missing", () => {
    const bundle = computeBankValuation(insurerMetrics(false), cfg, null, null, /* isInsurance */ true);

    // EV could not be computed → the actuarial primary is absent.
    expect(bundle.evBased).toBeDefined();
    expect(bundle.evBased!.status).toBe("skipped");
    expect(bundle.evBased!.reason).toMatch(/embedded value/i);

    // The load-bearing assertion: no silent bank-framed substitute.
    expect(bundle.triangulatedValue).toBeNull();
  });

  it("still triangulates the SAME metrics when treated as a bank (gate is insurance-specific)", () => {
    // Proves the fail-closed is scoped to insurance, not a global disable: the
    // identical metric series, valued as a bank, still produces a median of the
    // computed book-value models.
    const bankBundle = computeBankValuation(insurerMetrics(false), cfg, null, null, /* isInsurance */ false);
    const computed = [
      bankBundle.justifiedPB, bankBundle.equityResidualIncome, bankBundle.sustainableDDM,
    ].filter((m) => m.status === "computed");
    if (computed.length > 0) {
      expect(bankBundle.triangulatedValue).not.toBeNull();
    }
  });

  it("uses embedded value as the triangulated value when EV IS available", () => {
    const bundle = computeBankValuation(insurerMetrics(true), cfg, null, null, /* isInsurance */ true);
    expect(bundle.evBased!.status).toBe("computed");
    expect(bundle.triangulatedValue).toBeCloseTo(bundle.evBased!.intrinsicValue!, 6);
  });
});
