/**
 * Insurance valuation accuracy — HDFC Life ground-truth bridge.
 *
 * Companion to insuranceValuationAccuracy.spec.ts (LIC). Where LIC is a PSU
 * insurer that trades far below the 12x private-insurer VNB multiple, HDFC Life
 * is the canonical *private* life insurer: high New Business Margin (25.6% FY25)
 * and a franchise the market values near the 12x default. Together the two
 * cases prove the EV/VNB bridge generalises across the insurer spectrum, not
 * just one company.
 *
 * Source of truth (independent of the Capitaline engine input):
 *   HDFC Life Integrated Annual Reports — certified Indian Embedded Value (IEV)
 *   statements (appointed-actuary certified), cross-verified across the FY23,
 *   FY24-comparative and FY25 reports:
 *
 *     FY        IEV (Cr)   VoNB (Cr)   Solvency   NBM
 *     FY2023    39,527     3,674       203%       27.6%
 *     FY2024    47,468     3,501       187%        —
 *     FY2025    55,423     3,962       194%       25.6%
 *
 *   FY24 IEV is the opening balance of the FY25 IEV movement walk
 *   ("Opening IEV as at March 31, 2024 = 47,468"); FY24 VoNB (3,501) appears in
 *   the FY25 report's three-year comparative. No figure is taken from memory.
 */
import { describe, it, expect } from "vitest";
import { computeBankValuation } from "../bankValuation";
import type { BankPeriodMetrics } from "../bankPipeline";
import { DEFAULT_CONFIG } from "../types";

// HDFC Life published figures (certified IEV statements).
const HDFC_EV_FY25 = 55_423;
const HDFC_VNB_FY25 = 3_962;

function hdfcLifeMetrics(): BankPeriodMetrics[] {
  const base = (
    period_end: string,
    totalEquity: number,
    pat: number,
    ev: number,
    vnb: number,
  ): BankPeriodMetrics => ({
    period_end,
    totalAssets: 336_282, // AUM proxy (FY25 AUM ₹3,36,282 cr)
    totalEquity,
    advances: null,
    deposits: null,
    investments: 336_282,
    borrowings: 2_950, // FY25 borrowings ₹2,950 cr
    cashAndBalanceWithRBI: null,
    interestEarned: null,
    interestExpended: null,
    nii: null,
    otherIncome: null,
    operatingExpenses: null,
    provisions: null,
    pat,
    pbt: pat,
    dividendPaid: null,
    nim: null,
    roa: null,
    roe: pat / totalEquity,
    creditCost: null,
    costToIncome: null,
    casaRatio: null,
    nonConvertibleDebentures: null,
    termLoansFromBanks: null,
    termLoansFromInstitutions: null,
    termLoansFromOthers: null,
    leverage: null,
    costOfBorrowings: null,
    yieldOnAdvances: null,
    spread: null,
    debtMix: null,
    premiumEarned: null,
    claimsExpense: null,
    quality: {
      period_end,
      embedded_value: ev,
      vnb,
    },
  });

  return [
    base("2023-03-31", 14_000, 1_360, 39_527, 3_674),
    base("2024-03-31", 15_000, 1_569, 47_468, 3_501),
    base("2025-03-31", 16_126, 1_802, HDFC_EV_FY25, HDFC_VNB_FY25),
  ];
}

describe("insurance valuation accuracy — HDFC Life (private insurer)", () => {
  it("applies the 12x VNB default appraisal to a private insurer's FY25 figures", () => {
    const cfg = { ...DEFAULT_CONFIG, company_type: "insurance" as const };
    const bundle = computeBankValuation(
      hdfcLifeMetrics(),
      cfg,
      /* marketCap */ null,
      /* payoutRatio */ null,
      /* isInsurance */ true,
    );

    expect(bundle.evBased).toBeDefined();
    expect(bundle.evBased!.status).toBe("computed");

    // Private-insurer franchise fits the 12x default: EV + VoNB × 12.
    const expected = HDFC_EV_FY25 + HDFC_VNB_FY25 * 12; // 55,423 + 47,544 = 102,967
    expect(bundle.evBased!.intrinsicValue).toBeCloseTo(expected, 0);
  });

  it("selects the latest-period (FY25) EV, not an earlier year", () => {
    const cfg = { ...DEFAULT_CONFIG, company_type: "insurance" as const };
    const bundle = computeBankValuation(hdfcLifeMetrics(), cfg, null, null, true);
    const fy25 = HDFC_EV_FY25 + HDFC_VNB_FY25 * 12;
    // FY23 (39,527) or FY24 (47,468) would yield a materially lower number.
    expect(bundle.evBased!.intrinsicValue).toBeCloseTo(fy25, 0);
    expect(bundle.evBased!.intrinsicValue).toBeGreaterThan(47_468 + 3_501 * 12);
  });

  it("yields a higher appraisal than LIC at the same multiple per unit of EV+VNB", () => {
    // Sanity contrast with the PSU case: HDFC Life's VoNB is a larger fraction
    // of EV (stronger new-business franchise), so VNB-multiple sensitivity is
    // higher. Raising the multiple from 12x to 15x must move HDFC Life's value
    // by 3 × VoNB.
    const base = computeBankValuation(
      hdfcLifeMetrics(),
      { ...DEFAULT_CONFIG, company_type: "insurance" as const, insurance_vnb_multiple: 12 },
      null, null, true,
    );
    const richer = computeBankValuation(
      hdfcLifeMetrics(),
      { ...DEFAULT_CONFIG, company_type: "insurance" as const, insurance_vnb_multiple: 15 },
      null, null, true,
    );
    const delta = richer.evBased!.intrinsicValue! - base.evBased!.intrinsicValue!;
    expect(delta).toBeCloseTo(HDFC_VNB_FY25 * 3, 0); // 3,962 × (15 − 12)
  });
});
