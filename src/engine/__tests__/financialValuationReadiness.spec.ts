/**
 * A financial institution's valuation readiness, from the evidence its valuation
 * rests on — the one rule the app's run and the audit harness both apply.
 */
import { describe, expect, it } from "vitest";
import { resolveFinancialValuationReadiness } from "../bankValuation/readiness";
import type { BankValuationBundle, BankValuationModelResult } from "../bankValuation/types";
import type { BankPeriodMetrics } from "../bankPipeline";

const computed = (intrinsicValue: number, diagnostics: Record<string, number | null> = {}): BankValuationModelResult =>
  ({ status: "computed", intrinsicValue, premiumOverMarket: null, reason: "", diagnostics });
const years = (n: number) => Array.from({ length: n }, (_, i) =>
  ({ period_end: `${2025 - n + 1 + i}-03-31`, totalEquity: 20_000, pat: 3_000, roe: 0.15 }) as unknown as BankPeriodMetrics);

describe("resolveFinancialValuationReadiness", () => {
  it("clears an insurer on its filed embedded value and value of new business", () => {
    // HDFC Life FY25: EV + VNB × 12 = ₹1,02,967 Cr.
    const valuation = { evBased: computed(102_967, { embedded_value: 55_000, vnb: 3_996 }) } as unknown as BankValuationBundle;
    const r = resolveFinancialValuationReadiness({ bankMetrics: years(5), valuation, subtype: "insurance" });
    expect(r.status).toBe("warning");
    expect(r.reasons[0]).toMatch(/^Valuation-eligible on the filed embedded value and value of new business/);
  });

  it("does not clear an insurer whose embedded value is scaled without VNB", () => {
    const valuation = { evBased: computed(110_000, { embedded_value: 55_000, vnb: null }) } as unknown as BankValuationBundle;
    expect(resolveFinancialValuationReadiness({ bankMetrics: years(5), valuation, subtype: "insurance" }).status).toBe("guarded");
  });

  it("does not clear a bank on its three book models: one algebra", () => {
    const valuation = { justifiedPB: computed(668_446), equityResidualIncome: computed(540_456), sustainableDDM: computed(575_549) } as unknown as BankValuationBundle;
    const r = resolveFinancialValuationReadiness({ bankMetrics: years(5), valuation, subtype: "bank" });
    expect(r.status).toBe("guarded");
    expect(r.reasons[0]).toMatch(/Valuation-eligible needs two independent lenses that agree within 30%\.$/);
  });

  it("clears an NBFC whose book lens and P/AUM agree within 30%", () => {
    // Muthoot FY25: book lens ₹38,406 Cr (median of four), P/AUM ₹48,892 Cr.
    const valuation = { justifiedPB: computed(52_674), equityResidualIncome: computed(34_109), sustainableDDM: computed(51_399), roaLeverageRI: computed(35_990), pAum: computed(48_892) } as unknown as BankValuationBundle;
    expect(resolveFinancialValuationReadiness({ bankMetrics: years(5), valuation, subtype: "nbfc" }).status).toBe("warning");
  });

  it("does not clear an NBFC whose lenses sit further apart", () => {
    // Bajaj FY25: ₹1,09,948 Cr against ₹1,87,497 Cr, 52% apart.
    const valuation = { justifiedPB: computed(109_948), pAum: computed(187_497) } as unknown as BankValuationBundle;
    const r = resolveFinancialValuationReadiness({ bankMetrics: years(5), valuation, subtype: "nbfc" });
    expect(r.status).toBe("guarded");
    expect(r.reasons[0]).toMatch(/Valuation-eligible needs them within 30%\.$/);
  });

  it("needs three usable years first", () => {
    const valuation = { evBased: computed(102_967, { vnb: 3_996 }) } as unknown as BankValuationBundle;
    const r = resolveFinancialValuationReadiness({ bankMetrics: years(2), valuation, subtype: "insurance" });
    expect(r.status).toBe("guarded");
    expect(r.reasons[0]).toMatch(/needs 3 years/);
  });

  it("never resolves production-ready", () => {
    const valuation = { evBased: computed(102_967, { vnb: 3_996 }) } as unknown as BankValuationBundle;
    expect(resolveFinancialValuationReadiness({ bankMetrics: years(10), valuation, subtype: "insurance" }).status).not.toBe("production-ready");
  });
});
