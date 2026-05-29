/**
 * Insurance valuation accuracy — LIC ground-truth bridge.
 *
 * Phase 0 (accuracy harness) for the insurance subtype. Unlike the existing
 * insurance tests (strategy selection in nbfc-insurance.spec.ts, workbook
 * smoke in bankExcelExport.spec.ts), this asserts the EV/VNB valuation
 * *arithmetic* against Life Insurance Corporation of India's real published
 * figures.
 *
 * Source of truth (independent of the Capitaline engine input):
 *   LIC Annual Report FY2024 / IEV statement, as transcribed into
 *   public/data/companies/Life Insurance Corporation of India/quality_indicators.json
 *     embedded_value (FY24) = 727,344 Cr
 *     vnb            (FY24) =   9,583 Cr
 *
 * The embedded-value appraisal bridge is: fair value = EV + VNB × multiple.
 * This is NOT a copy-back of an engine output (the engine never computes EV;
 * it consumes the published figure), so the assertion genuinely validates the
 * model formula against hand-calculated ground truth.
 */
import { describe, it, expect } from "vitest";
import { computeBankValuation } from "../bankValuation";
import type { BankPeriodMetrics } from "../bankPipeline";
import { DEFAULT_CONFIG } from "../types";

// LIC published figures (FY2022–FY2024) from the AR/IEV statement.
const LIC_EV_FY24 = 727_344;
const LIC_VNB_FY24 = 9_583;

function licMetrics(): BankPeriodMetrics[] {
  // Minimal-but-valid insurer metric series. Balance-sheet/P&L fields use
  // LIC's shareholder-side figures; the EV/VNB live on the quality sidecar
  // exactly as the production join (bankPipeline.ts) attaches them.
  const base = (
    period_end: string,
    totalEquity: number,
    pat: number,
    ev: number,
    vnb: number,
  ): BankPeriodMetrics => ({
    period_end,
    totalAssets: 5_285_503,
    totalEquity,
    advances: null,
    deposits: null,
    investments: 5_000_000,
    borrowings: null,
    cashAndBalanceWithRBI: null,
    interestEarned: null,
    interestExpended: null,
    nii: null,
    otherIncome: null,
    operatingExpenses: -48_122,
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
    premiumEarned: 475_070,
    claimsExpense: -388_809,
    quality: {
      period_end,
      embedded_value: ev,
      vnb,
    },
  });

  return [
    base("2022-03-31", 10_409, 4_043, 541_492, 7_619),
    base("2023-03-31", 45_669, 36_397, 582_243, 11_553),
    base("2024-03-31", 81_938, 40_676, LIC_EV_FY24, LIC_VNB_FY24),
  ];
}

describe("insurance valuation accuracy — LIC EV/VNB bridge", () => {
  it("computes the EV + VNB×multiple appraisal value from published FY24 figures", () => {
    const cfg = { ...DEFAULT_CONFIG, company_type: "insurance" as const };
    const bundle = computeBankValuation(
      licMetrics(),
      cfg,
      /* marketCap */ null,
      /* payoutRatio */ null,
      /* isInsurance */ true,
    );

    expect(bundle.evBased).toBeDefined();
    expect(bundle.evBased!.status).toBe("computed");

    // Default VNB multiple is 12x (private-insurer convention). With VNB present
    // the bridge is EV + VNB × 12.
    const expected = LIC_EV_FY24 + LIC_VNB_FY24 * 12; // 727,344 + 114,996 = 842,340
    expect(bundle.evBased!.intrinsicValue).toBeCloseTo(expected, 0);
  });

  it("uses the latest period's EV (not an earlier one) for the appraisal", () => {
    const cfg = { ...DEFAULT_CONFIG, company_type: "insurance" as const };
    const bundle = computeBankValuation(licMetrics(), cfg, null, null, true);
    // FY24 EV (727,344) must dominate — an earlier-period EV (541,492 or
    // 582,243) would produce a materially lower number.
    const fy24 = LIC_EV_FY24 + LIC_VNB_FY24 * 12;
    expect(bundle.evBased!.intrinsicValue).toBeCloseTo(fy24, 0);
  });

  it("honours an explicit vnb_multiple override (PSU insurers trade nearer 1x)", () => {
    // LIC is a PSU insurer; analysts apply a far lower VNB multiple than the
    // 12x private-insurer default. The override must flow through.
    const cfg = {
      ...DEFAULT_CONFIG,
      company_type: "insurance" as const,
      insurance_vnb_multiple: 5,
    };
    const bundle = computeBankValuation(licMetrics(), cfg, null, null, true);
    const expected = LIC_EV_FY24 + LIC_VNB_FY24 * 5; // 727,344 + 47,915 = 775,259
    expect(bundle.evBased!.intrinsicValue).toBeCloseTo(expected, 0);
  });

  it("falls back to EV × ev_multiple when VNB is absent", () => {
    const cfg = { ...DEFAULT_CONFIG, company_type: "insurance" as const };
    const metrics = licMetrics();
    // Strip VNB from the latest period — simulate an insurer that discloses
    // EV but not VNB.
    metrics[metrics.length - 1].quality = {
      period_end: "2024-03-31",
      embedded_value: LIC_EV_FY24,
      vnb: null,
    };
    const bundle = computeBankValuation(metrics, cfg, null, null, true);
    const expected = LIC_EV_FY24 * (cfg.insurance_ev_multiple ?? 2.0); // 727,344 × 2.0
    expect(bundle.evBased!.intrinsicValue).toBeCloseTo(expected, 0);
  });
});
