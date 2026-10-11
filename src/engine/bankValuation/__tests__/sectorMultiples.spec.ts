import { describe, expect, it } from "vitest";
import { computeBankValuation } from "../computeBankValuation";
import { SECTOR_INDEX_MEMBERSHIP, SECTOR_INDEX_MULTIPLES, sectorRelativePB } from "../sectorMultiples";
import { DEFAULT_CONFIG, type EngineConfig } from "../../types";
import type { BankPeriodMetrics } from "../../bankPipeline";

const priced = (overrides: Partial<Parameters<typeof sectorRelativePB>[0]> = {}) =>
  sectorRelativePB({ symbol: "SBIN", latestBookValue: 500_000, anchorPeriod: "2025-03-31", analysisAsOf: "2026-10-11", ...overrides });

describe("sector index P/B lens", () => {
  it("prices the bank's book at its index's P/B on the anchor's month-end, as a sourced multiple", () => {
    const r = priced();
    expect(r.status).toBe("computed");
    expect(r.intrinsicValue).toBeCloseTo(500_000 * 1.22, 6);
    expect(r.diagnostics.multipleSourced).toBe(1);
    expect(r.reason).toContain("Nifty PSU Bank's 1.22× P/B on 2025-03-31");
    expect(r.reason).toContain("Index_Dashboard_MAR2025.pdf");
    expect(r.reason).toContain("The index includes the bank itself (33.3% on 2026-09-30)");
  });

  it("uses no multiple from another month: today's on an older book mixes two dates", () => {
    const r = priced({ anchorPeriod: "2024-03-31" });
    expect(r.status).toBe("skipped");
    expect(r.reason).toMatch(/No sourced Nifty PSU Bank P\/B for the anchor's month \(2024-03\)/);
  });

  it("refuses a multiple dated after the analysis", () => {
    const r = priced({ analysisAsOf: "2025-03-15" });
    expect(r.status).toBe("skipped");
    expect(r.reason).toMatch(/look-ahead/);
  });

  it("gives an NBFC no lens: no NSE index is defined on its basic industry", () => {
    expect(priced({ symbol: "BAJFINANCE" }).status).toBe("skipped");
  });

  it("holds only attributed, plausible observations, and one for every index a bank maps to", () => {
    for (const m of SECTOR_INDEX_MULTIPLES) {
      expect(m.source).toMatch(/niftyindices\.com/);
      expect(m.pb).toBeGreaterThan(0.2);
      expect(m.pb).toBeLessThan(10);
      expect(m.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const membership of SECTOR_INDEX_MEMBERSHIP) {
      expect(SECTOR_INDEX_MULTIPLES.some((m) => m.index === membership.index)).toBe(true);
      expect(membership.weight).toBeGreaterThan(0);
      expect(membership.weight).toBeLessThan(1);
    }
  });

  // A market multiple corroborates an intrinsic value; averaged into it, it
  // would pull the bank's headline toward its sector's price.
  it("is reported beside the bank's models, not averaged into its value", () => {
    const metrics = Array.from({ length: 6 }, (_, i) => ({
      period_end: `${2020 + i}-03-31`, totalEquity: 400_000 + 20_000 * i, pat: 60_000 + 3_000 * i, roe: 0.15,
    })) as unknown as BankPeriodMetrics[];
    const cfg = { ...DEFAULT_CONFIG, company_type: "bank", ticker: "SBIN" } as EngineConfig;
    const bundle = computeBankValuation(metrics, cfg, null, 0.2, false, false, { analysisAsOf: "2026-10-11" });
    expect(bundle.sectorRelativePB?.status).toBe("computed");
    expect(bundle.modelsContributing).not.toContain("Sector index P/B");
    const unpriced = computeBankValuation(metrics, { ...cfg, ticker: "NOTABANK" }, null, 0.2, false, false, { analysisAsOf: "2026-10-11" });
    expect(unpriced.sectorRelativePB?.status).toBe("skipped");
    expect(bundle.triangulatedValue).toBe(unpriced.triangulatedValue);
  });
});
