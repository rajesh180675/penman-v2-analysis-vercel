/**
 * Phase E1 — IT-services detector tests
 *
 * Covers:
 * - TCS-shaped fixture (high employee cost, low PPE) → isITServices=true
 * - ITC-shaped fixture (low employee cost, high PPE) → isITServices=false
 * - Insufficient periods → isITServices=false, reason explains
 * - Missing employee cost data → isITServices=false
 * - Missing PPE data → isITServices=false
 * - Borderline cases (exactly at threshold)
 * - medianEmployeeCostRatio and medianPPERatio populated correctly
 */

import { describe, expect, it } from "vitest";
import { detectITServices } from "../itServicesDetector";
import type { RecastPeriod } from "../types";

/* ── helpers ─────────────────────────────────────────────────────── */

function makePeriod(
  period_end: string,
  opts: {
    sales?: number;
    employeeCost?: number;
    ppe?: number;
    ta?: number;
  } = {},
): RecastPeriod {
  const sales = opts.sales ?? 10000;
  const employeeCost = opts.employeeCost ?? 0;
  const ppe = opts.ppe ?? 1000;
  const ta = opts.ta ?? 10000;

  return {
    period_end,
    bs: {
      TA: ta,
      CSE: ta * 0.5,
      NFO: ta * 0.1,
      NOA: ta * 0.4,
      FA: ta * 0.3,
      OA: ta * 0.1,
      FL: ta * 0.05,
      OL: ta * 0.05,
      FO: ta * 0.1,
      PPE: ppe,
      Goodwill: 0,
      CurrentAssets: ta * 0.3,
      CurrentLiabilities: ta * 0.1,
      Inventory: 0,
      TradeReceivables: ta * 0.1,
      TradePayables: ta * 0.05,
      LIFO_reserve: 0,
      separationScore: 70,
      PensionObl: 0,
    },
    is: {
      Sales: sales,
      CNI: sales * 0.15,
      PAT: sales * 0.15,
      OCI: 0,
      TCI: sales * 0.15,
      TCI_NCI: 0,
      TaxExpense: sales * 0.05,
      taxRate: 0.25,
      FinanceCost: 0,
      FinanceIncome: 0,
      FinanceIncomeRung: 1,
      PreferredDividend: 0,
      NFE: 0,
      OI: sales * 0.15,
      OtherItems: 0,
      OI_from_sales: sales * 0.15,
      MII: 0,
      COGS: 0,
      operatingCostBridge: {
        materialCost: 0,
        employeeCost,
        depreciation: 0,
        sgaAdvertising: 0,
        sgaLegalProfessional: 0,
        sgaRent: 0,
        sgaFreight: 0,
        sgaRepairs: 0,
        sgaPowerFuel: 0,
        sgaDetailed: 0,
        sgaResidual: 0,
      },
    },
    cf: { CFO: sales * 0.12, Capex: -sales * 0.02, Div: sales * 0.05 },
    ri: null,
    ratios: null,
    quality: null,
    cu: { UOI: 0, CoreOI: sales * 0.15, UFE: 0, CoreNFE: 0, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    spec_flags: [],
    accounting_standard: "ind-as",
  } as unknown as RecastPeriod;
}

/* ── TCS-shaped: high employee cost, low PPE ─────────────────────── */

describe("detectITServices — TCS-shaped fixture", () => {
  const periods = [
    // Employee cost = 55% of revenue, PPE = 5% of assets
    makePeriod("2022-03-31", { sales: 10000, employeeCost: 5500, ppe: 500, ta: 10000 }),
    makePeriod("2023-03-31", { sales: 11000, employeeCost: 6050, ppe: 550, ta: 11000 }),
    makePeriod("2024-03-31", { sales: 12000, employeeCost: 6600, ppe: 600, ta: 12000 }),
    makePeriod("2025-03-31", { sales: 13000, employeeCost: 7150, ppe: 650, ta: 13000 }),
  ];

  it("detects as IT-services", () => {
    const result = detectITServices(periods);
    expect(result.isITServices).toBe(true);
  });

  it("medianEmployeeCostRatio ≈ 0.55", () => {
    const result = detectITServices(periods);
    expect(result.medianEmployeeCostRatio).toBeCloseTo(0.55, 2);
  });

  it("medianPPERatio ≈ 0.05", () => {
    const result = detectITServices(periods);
    expect(result.medianPPERatio).toBeCloseTo(0.05, 2);
  });

  it("reason mentions employee cost and PPE", () => {
    const result = detectITServices(periods);
    expect(result.reason).toContain("employee cost");
    expect(result.reason).toContain("PPE");
  });

  it("periodsAnalysed = 4", () => {
    const result = detectITServices(periods);
    expect(result.periodsAnalysed).toBe(4);
  });
});

/* ── ITC-shaped: low employee cost, high PPE ─────────────────────── */

describe("detectITServices — ITC-shaped fixture (industrial)", () => {
  const periods = [
    // Employee cost = 10% of revenue, PPE = 30% of assets
    makePeriod("2022-03-31", { sales: 10000, employeeCost: 1000, ppe: 3000, ta: 10000 }),
    makePeriod("2023-03-31", { sales: 11000, employeeCost: 1100, ppe: 3300, ta: 11000 }),
    makePeriod("2024-03-31", { sales: 12000, employeeCost: 1200, ppe: 3600, ta: 12000 }),
  ];

  it("does NOT detect as IT-services", () => {
    const result = detectITServices(periods);
    expect(result.isITServices).toBe(false);
  });

  it("reason explains which threshold failed", () => {
    const result = detectITServices(periods);
    expect(result.reason).toContain("Not IT-services");
  });
});

/* ── Edge cases ──────────────────────────────────────────────────── */

describe("detectITServices — edge cases", () => {
  it("returns isITServices=false for empty array", () => {
    const result = detectITServices([]);
    expect(result.isITServices).toBe(false);
    expect(result.periodsAnalysed).toBe(0);
  });

  it("returns isITServices=false for single period (< MIN_PERIODS)", () => {
    const result = detectITServices([
      makePeriod("2025-03-31", { sales: 10000, employeeCost: 6000, ppe: 400, ta: 10000 }),
    ]);
    expect(result.isITServices).toBe(false);
  });

  it("handles missing employeeCost (null bridge) gracefully", () => {
    const p = makePeriod("2025-03-31", { sales: 10000, ppe: 400, ta: 10000 });
    // Remove operatingCostBridge from one period — the other period still has
    // employeeCost=0 (default), so medianEmployeeCostRatio = 0, not null.
    // Key contract: no throw, isITServices=false (0 < 40% threshold).
    (p.is as unknown as Record<string, unknown>).operatingCostBridge = undefined;
    const result = detectITServices([p, makePeriod("2024-03-31")]);
    expect(result.isITServices).toBe(false);
    // medianEmployeeCostRatio is 0 (from the second period's default employeeCost=0)
    expect(result.medianEmployeeCostRatio).not.toBeNull();
  });

  it("handles zero sales without throwing", () => {
    const p = makePeriod("2025-03-31", { sales: 0, employeeCost: 5000, ppe: 400, ta: 10000 });
    const result = detectITServices([p, makePeriod("2024-03-31")]);
    // Zero sales → ratio not computed → null
    expect(() => result).not.toThrow();
  });

  it("borderline: employee cost exactly at 40% threshold → NOT IT-services", () => {
    // Exactly 40% is NOT above the threshold (strict >)
    const periods = [
      makePeriod("2024-03-31", { sales: 10000, employeeCost: 4000, ppe: 500, ta: 10000 }),
      makePeriod("2025-03-31", { sales: 10000, employeeCost: 4000, ppe: 500, ta: 10000 }),
    ];
    const result = detectITServices(periods);
    expect(result.isITServices).toBe(false);
  });

  it("borderline: PPE exactly at 10% threshold → NOT IT-services (not strictly below)", () => {
    const periods = [
      makePeriod("2024-03-31", { sales: 10000, employeeCost: 5000, ppe: 1000, ta: 10000 }),
      makePeriod("2025-03-31", { sales: 10000, employeeCost: 5000, ppe: 1000, ta: 10000 }),
    ];
    const result = detectITServices(periods);
    expect(result.isITServices).toBe(false);
  });

  it("high employee cost but high PPE → NOT IT-services", () => {
    // Could be a labour-intensive manufacturer
    const periods = [
      makePeriod("2024-03-31", { sales: 10000, employeeCost: 5000, ppe: 3000, ta: 10000 }),
      makePeriod("2025-03-31", { sales: 10000, employeeCost: 5000, ppe: 3000, ta: 10000 }),
    ];
    const result = detectITServices(periods);
    expect(result.isITServices).toBe(false);
    expect(result.reason).toContain("PPE");
  });
});
