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
  it("readies an insurer on its filed embedded value and VNB valued at its own ke and growth", () => {
    // HDFC Life FY25: the multiple is (1 + g) / (ke − g) = 1.05 / 0.08 = 13.1, no assumption of its own.
    const valuation = { evBased: computed(107_670, { embedded_value: 55_423, vnb: 3_962, vnb_multiple: 13.125, vnb_multiple_derived: 1 }) } as unknown as BankValuationBundle;
    const r = resolveFinancialValuationReadiness({ bankMetrics: years(5), valuation, subtype: "insurance" });
    expect(r.status).toBe("production-ready");
    expect(r.reasons[0]).toMatch(/^Ready: the filed embedded value plus the value of new business, growing at g and discounted at ke \(× 13\.1\)/);
  });

  it("keeps an insurer with a configured VNB multiple valuation-eligible, not production-ready", () => {
    // A multiple typed into the company's configuration: nothing sources it.
    const valuation = { evBased: computed(102_967, { embedded_value: 55_423, vnb: 3_962, vnb_multiple: 12, vnb_multiple_derived: 0 }) } as unknown as BankValuationBundle;
    const r = resolveFinancialValuationReadiness({ bankMetrics: years(5), valuation, subtype: "insurance" });
    expect(r.status).toBe("warning");
    expect(r.reasons[0]).toMatch(/^Valuation-eligible on the filed embedded value and value of new business\. The VNB multiple \(12×\) is configured for the company, an assumption nothing in the engine sources/);
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

  it("makes an NBFC whose lenses agree within 30% valuation-eligible, not production-ready", () => {
    // Muthoot FY25 with its sidecar: book lens ₹38,406 Cr, P/AUM ₹48,892 Cr, 24% apart.
    const valuation = { justifiedPB: computed(38_406), pAum: computed(48_892) } as unknown as BankValuationBundle;
    const r = resolveFinancialValuationReadiness({ bankMetrics: years(5), valuation, subtype: "nbfc" });
    expect(r.status).toBe("warning");
    expect(r.reasons[0]).toMatch(/not the 15% production-ready needs/);
  });

  it("readies an NBFC whose lenses agree within 15%", () => {
    const valuation = { justifiedPB: computed(40_000), pAum: computed(44_000) } as unknown as BankValuationBundle;
    expect(resolveFinancialValuationReadiness({ bankMetrics: years(5), valuation, subtype: "nbfc" }).status).toBe("production-ready");
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

  it("never readies a bank on its book lens, however long its history", () => {
    const valuation = { justifiedPB: computed(100), equityResidualIncome: computed(101), sustainableDDM: computed(99) } as unknown as BankValuationBundle;
    expect(resolveFinancialValuationReadiness({ bankMetrics: years(10), valuation, subtype: "bank" }).status).toBe("guarded");
  });
});
