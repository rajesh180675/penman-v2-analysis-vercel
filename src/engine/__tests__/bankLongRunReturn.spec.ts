/**
 * The long-run return a lender's residual-income forecast fades to. The
 * anchors (13% ROE for banks, 2.5% ROA for NBFCs) sat below every library ke
 * (13.6% / 14.8% on the default priors), so the terminal priced each lender as
 * growing at g forever while destroying value. Stable-growth ROE converges to
 * ke at worst: residual income goes to zero.
 */
import { describe, expect, it } from "vitest";
import { equityResidualIncome } from "../bankValuation/coreModels";
import { roaLeverageRI } from "../bankValuation/nbfcLenses";
import type { BankPeriodMetrics } from "../bankPipeline";

const years = (rows: Array<{ equity: number; roe?: number; roa?: number; leverage?: number }>) =>
  rows.map((r, i) => ({
    period_end: `${2021 + i}-03-31`,
    totalEquity: r.equity,
    pat: (r.roe ?? 0.15) * r.equity,
    roe: r.roe ?? null,
    roa: r.roa ?? null,
    leverage: r.leverage ?? null,
  }) as unknown as BankPeriodMetrics);

describe("bank equity residual income — long-run ROE", () => {
  it("fades to ke, not below it, when ke is above the 13% anchor", () => {
    // A bank earning exactly its 14.8% cost of equity is worth its book.
    const metrics = years([{ equity: 9000, roe: 0.148 }, { equity: 9600, roe: 0.148 }, { equity: 10000, roe: 0.148 }]);
    const eri = equityResidualIncome(metrics, 0.148, 0.05, null, 0.2);
    expect(eri.diagnostics.longRunROE).toBe(0.148);
    expect(eri.intrinsicValue).toBeCloseTo(10000, 6);
  });

  it("keeps the 13% anchor and its spread where ke is below it", () => {
    const metrics = years([{ equity: 9000, roe: 0.13 }, { equity: 9600, roe: 0.13 }, { equity: 10000, roe: 0.13 }]);
    const eri = equityResidualIncome(metrics, 0.12, 0.05, null, 0.2);
    expect(eri.diagnostics.longRunROE).toBe(0.13);
    expect(eri.intrinsicValue!).toBeGreaterThan(10000);
  });

  it("still shows a low earner's value destruction over the forecast", () => {
    // Latest ROE 8% against ke 13.6%: the fade years earn below ke, so value
    // sits below book even though the terminal no longer destroys value.
    const metrics = years([{ equity: 9000, roe: 0.08 }, { equity: 9600, roe: 0.08 }, { equity: 10000, roe: 0.08 }]);
    const eri = equityResidualIncome(metrics, 0.136, 0.05, null, 0.2);
    expect(eri.diagnostics.terminalValue).toBeCloseTo(0, 6);
    expect(eri.intrinsicValue!).toBeLessThan(10000);
  });
});

describe("NBFC ROA × leverage residual income — long-run ROA", () => {
  it("fades ROA to the level that earns ke at the sustainable leverage, not to 2.5%", () => {
    // ROA 2.96% at 4x borrowings/equity earns 14.8% = ke, every year.
    const row = { equity: 10000, roa: 0.0296, leverage: 4, roe: 0.148 };
    const metrics = years([row, row, row]);
    const lens = roaLeverageRI(metrics, 0.148, 0.05, null, 0.2);
    expect(lens.diagnostics.longRunROA).toBeCloseTo(0.148 / 5, 12);
    expect(lens.intrinsicValue).toBeCloseTo(10000, 4);
  });

  it("keeps the 2.5% anchor where it already earns more than ke", () => {
    const row = { equity: 10000, roa: 0.03, leverage: 5, roe: 0.18 };
    const lens = roaLeverageRI(years([row, row, row]), 0.12, 0.05, null, 0.2);
    expect(lens.diagnostics.longRunROA).toBe(0.025);
  });
});
