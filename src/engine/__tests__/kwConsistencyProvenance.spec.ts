/* ================================================================
   S-9.4C kw-consistency: genuine + fail-closed (#88).

   The prior kw-consistency-bridge compared period.kwUsed against
   period.kwStructural, but the pipeline stamps BOTH from one
   deriveKwFromStructure result (pipeline.ts:248-249) and nothing else
   writes kwUsed, so the residual was identically 0 — tautological,
   permanently "confirmed". It was doubly inert behind a warning-only
   clamp.

   The rebuilt check is PROVENANCE-driven: every period that CAN derive a
   structural kw (any non-first period) MUST have a valid one stamped,
   because otherwise every kw consumer silently resolves to the config
   approximation via resolveKw — the exact "derive once, consume
   everywhere" violation S-9.4C forbids.

   These tests drive the REAL processCompanyDataFull pipeline (which stamps
   kwStructural for genuine multi-period data), then surgically strip the
   stamp to prove the gate fails closed — no hand-built green-by-
   construction fixtures.
================================================================ */

import { describe, expect, it } from "vitest";
import { processCompanyDataFull } from "../pipeline";
import { evaluateReconciliationResiduals } from "../reconciliationResiduals";
import { resolveKw, DEFAULT_CONFIG, RawPeriodData, EngineConfig } from "../types";

const CONFIG: EngineConfig = { ...DEFAULT_CONFIG, company_type: "industrial" };

/**
 * A clean, balanced industrial period. Total Assets (scaled) reconciles to
 * the two independently-reported asset subtotals so the recast-TA residual
 * stays confirmed and does not muddy the kw-consistency assertions.
 */
function makePeriod(period_end: string, scale: number): RawPeriodData {
  return {
    company_id: "KW-PROV",
    period_end,
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000 * scale,
      "Total Current Assets__BalanceSheet": 400 * scale,
      "Total Non-Current and Other Assets__BalanceSheet": 600 * scale,
      "Total Stockholders' Equity__BalanceSheet": 600 * scale,
      "Total Equity__BalanceSheet": 600 * scale,
      "Total Equity and Liabilities__BalanceSheet": 1000 * scale,
      "Minority Interest__BalanceSheet": 0,
      "Net Property, plant and equipment__BalanceSheet": 320 * scale,
      "Cash and Cash Equivalents__BalanceSheet": 100 * scale,
      "Long-term Borrowings__BalanceSheet": 150 * scale,
      "Trade Payables__BalanceSheet": 80 * scale,
      "Other Current Liabilities__BalanceSheet": 50 * scale,
      "Provisions - Current__BalanceSheet": 10 * scale,
      "Provisions - Long-term__BalanceSheet": 10 * scale,
      "Current Tax Liabilities__BalanceSheet": 10 * scale,
      "Other Non-Current Liabilities__BalanceSheet": 80 * scale,
      "Revenue From Operations(Net)__ProfitLoss": 900 * scale,
      "Profit Before Tax__ProfitLoss": 140 * scale,
      "Tax Expenses__ProfitLoss": 35 * scale,
      "Profit After Tax__ProfitLoss": 105 * scale,
      "Total Comprehensive Income for the Year__ProfitLoss": 105 * scale,
      "Finance Cost__ProfitLoss": 12 * scale,
      "Other Income__ProfitLoss": 5 * scale,
      "Net Cash from Operating Activities__CashFlow": 120 * scale,
      "Purchased of Fixed Assets__CashFlow": -40 * scale,
      "Dividend Paid__CashFlow": -20 * scale,
    },
  };
}

const RAW: RawPeriodData[] = [
  makePeriod("2022-03-31", 1.0),
  makePeriod("2023-03-31", 1.08),
  makePeriod("2024-03-31", 1.15),
  makePeriod("2025-03-31", 1.22),
];

describe("resolveKw — single S-9.4C resolution seam", () => {
  it("prefers an explicit caller override", () => {
    const r = resolveKw(0.12, CONFIG, { override: 0.18 });
    expect(r.kw).toBe(0.18);
    expect(r.source).toBe("override");
  });

  it("uses the pipeline-stamped structural kw when no override", () => {
    const r = resolveKw(0.12, CONFIG);
    expect(r.kw).toBe(0.12);
    expect(r.source).toBe("structural");
  });

  it("uses a caller fallback (e.g. reverseDCF costOfCapital) before config", () => {
    const r = resolveKw(null, CONFIG, { fallback: 0.09 });
    expect(r.kw).toBe(0.09);
    expect(r.source).toBe("fallback");
  });

  it("falls back to the config approximation only as a last resort", () => {
    const r = resolveKw(null, CONFIG);
    expect(r.source).toBe("config");
    expect(r.kw).toBeGreaterThan(0);
  });

  it("skips invalid structural values (0, negative, NaN) to the next rung", () => {
    expect(resolveKw(0, CONFIG, { fallback: 0.09 }).source).toBe("fallback");
    expect(resolveKw(-0.05, CONFIG, { fallback: 0.09 }).source).toBe("fallback");
    expect(resolveKw(Number.NaN, CONFIG, { fallback: 0.09 }).source).toBe("fallback");
    // An invalid override is ignored, not propagated.
    expect(resolveKw(0.12, CONFIG, { override: 0 }).source).toBe("structural");
  });
});

describe("kw-consistency-bridge — provenance, fail-closed (real pipeline)", () => {
  it("confirms every non-first period when the pipeline stamps a structural kw", () => {
    const pipeline = processCompanyDataFull(RAW, CONFIG);
    expect(pipeline.periods.length).toBeGreaterThanOrEqual(2);

    const summary = evaluateReconciliationResiduals({ recastData: pipeline.periods, config: CONFIG });
    const kwChecks = summary.checks.filter((c) => c.key === "kw-consistency-bridge");

    // One check per non-first period (the first period is legitimately skipped).
    expect(kwChecks.length).toBe(pipeline.periods.length - 1);
    expect(kwChecks.every((c) => c.status === "confirmed")).toBe(true);
    expect(kwChecks.every((c) => c.ratio === 0)).toBe(true);
    // The kw check does not, on its own, fail a genuine multi-period run.
    expect(summary.checks.some((c) => c.key === "kw-consistency-bridge" && c.status === "failed")).toBe(false);
  });

  it("does NOT emit a kw-consistency check for the first period (cannot derive kw)", () => {
    const pipeline = processCompanyDataFull(RAW, CONFIG);
    const firstPeriodEnd = pipeline.periods[0]!.period_end;
    const summary = evaluateReconciliationResiduals({ recastData: pipeline.periods, config: CONFIG });

    const firstPeriodKwCheck = summary.checks.find(
      (c) => c.key === "kw-consistency-bridge" && c.periodEnd === firstPeriodEnd,
    );
    expect(firstPeriodKwCheck).toBeUndefined();
  });

  it("fails closed when a non-first period lost its structural kw (broken stamping)", () => {
    const pipeline = processCompanyDataFull(RAW, CONFIG);
    // Surgically strip the stamp the pipeline genuinely produced — simulating
    // a regression where kwStructural is not stamped, which would otherwise
    // let every consumer silently fall back to config-kw.
    const corrupted = pipeline.periods.map((p, i) =>
      i === pipeline.periods.length - 1 ? { ...p, kwStructural: null } : p,
    );
    const lastEnd = corrupted[corrupted.length - 1]!.period_end;

    const summary = evaluateReconciliationResiduals({ recastData: corrupted, config: CONFIG });
    const failedCheck = summary.checks.find(
      (c) => c.key === "kw-consistency-bridge" && c.periodEnd === lastEnd,
    );

    expect(failedCheck).toBeDefined();
    expect(failedCheck?.status).toBe("failed");
    expect(failedCheck?.ratio).toBe(1);
    expect(summary.status).toBe("failed");
  });
});
