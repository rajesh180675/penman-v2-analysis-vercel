/**
 * Plan 3 — pipelineStrategyId stamp re-home regression.
 *
 * The audit stamp `envelope.pipelineStrategyId` used to be derived by
 * `selectStrategy(rawData, config)`, which keyed off `config.company_type`.
 * The real dispatch fork (pipeline.ts) keys off the *detected* analysis
 * family. So any company left at `company_type: "auto"` that was
 * signal-detected as a financial institution executed the bank pipeline but
 * got stamped `industrial-v1` — a latent audit-provenance bug.
 *
 * The stamp is now resolved inside buildAnalysisTraceability from the same
 * signals the live app already passes (the detected subtype) with a scope
 * fallback. These tests lock in:
 *   - Tier 1: the explicitly-detected subtype the live app passes maps to the
 *     correct id (bank/nbfc/insurance/generic-financial).
 *   - Tier 2: an AUTO-detected bank derived from scope stamps `bank-v1`
 *     (the case the old code got wrong → `industrial-v1`).
 *   - Industrial scope stamps `industrial-v1`.
 *   - No sector signal at all leaves the field unset (best-effort).
 */

import { describe, expect, it } from "vitest";
import { buildAnalysisTraceability } from "../analysisTraceability";
import { assessAnalysisScope } from "../scopePolicy";
import type { QualityGateReport } from "../mappingAudit";
import type { RawPeriodData } from "../types";

/* A real bank-shaped two-period dataset — scope detection classifies this as
   supported-financial / bank, with NO explicit company_type. */
const bankPeriods: RawPeriodData[] = [
  {
    company_id: "FIXBANK",
    period_end: "2024-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 3596000,
      "Total Shareholders Funds__BalanceSheet": 380000,
      "Advances__BalanceSheet": 2480000,
      "Deposits__BalanceSheet": 2310000,
      "Investments__BalanceSheet": 680000,
      "Borrowings__BalanceSheet": 180000,
      "Cash and Balance with RBI__BalanceSheet": 126000,
      "Interest Earned__ProfitLoss": 248000,
      "Interest Expended__ProfitLoss": -138000,
      "Other Income__ProfitLoss": 42000,
      "Operating Expenses__ProfitLoss": -58000,
      "Provisions and Contingencies__ProfitLoss": -18000,
      "Profit After Tax__ProfitLoss": 52000,
      "Profit Before Tax__ProfitLoss": 68000,
    },
  },
  {
    company_id: "FIXBANK",
    period_end: "2025-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 4200000,
      "Total Shareholders Funds__BalanceSheet": 430000,
      "Advances__BalanceSheet": 2900000,
      "Deposits__BalanceSheet": 2700000,
      "Investments__BalanceSheet": 780000,
      "Borrowings__BalanceSheet": 200000,
      "Cash and Balance with RBI__BalanceSheet": 140000,
      "Interest Earned__ProfitLoss": 295000,
      "Interest Expended__ProfitLoss": -165000,
      "Other Income__ProfitLoss": 48000,
      "Operating Expenses__ProfitLoss": -65000,
      "Provisions and Contingencies__ProfitLoss": -22000,
      "Profit After Tax__ProfitLoss": 62000,
      "Profit Before Tax__ProfitLoss": 82000,
    },
  },
];

/* Plain industrial two-period dataset. */
const industrialPeriods: RawPeriodData[] = [
  {
    company_id: "FIXCO",
    period_end: "2024-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 100000,
      "Total Shareholders Funds__BalanceSheet": 60000,
      "Revenue From Operations(Net)__ProfitLoss": 90000,
    },
  },
  {
    company_id: "FIXCO",
    period_end: "2025-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 120000,
      "Total Shareholders Funds__BalanceSheet": 70000,
      "Revenue From Operations(Net)__ProfitLoss": 95000,
    },
  },
];

/** Wrap a ScopeAssessment as the minimal QualityGateReport the resolver reads. */
function gateWithScope(periods: RawPeriodData[]): QualityGateReport {
  return { scopeAssessment: assessAnalysisScope(periods) } as QualityGateReport;
}

describe("pipelineStrategyId stamp (re-homed onto the dispatch fork)", () => {
  /* ── Tier 1: the explicitly-detected subtype the live app already passes ── */
  it.each([
    ["bank", "bank-v1"],
    ["nbfc", "nbfc-v1"],
    ["insurance", "insurance-v1"],
    ["generic-financial", "nbfc-v1"],
  ] as const)("stamps %s subtype as %s", (subtype, expected) => {
    const envelope = buildAnalysisTraceability({ bankSubtype: subtype });
    expect(envelope.pipelineStrategyId).toBe(expected);
  });

  /* ── Tier 2: the correctness fix — auto-detected financial via scope ── */
  it("stamps an AUTO-detected bank (no explicit company_type) as bank-v1, not industrial-v1", () => {
    const scope = gateWithScope(bankPeriods);
    // Guard: this fixture really is auto-detected as a financial bank, so the
    // assertion exercises the family-detection path the old code missed.
    expect(scope.scopeAssessment.analysisFamily).toBe("financial-institution");

    const envelope = buildAnalysisTraceability({
      qualityGate: scope,
      config: { company_type: "auto" } as never,
    });
    expect(envelope.pipelineStrategyId).toBe("bank-v1");
    expect(envelope.pipelineStrategyId).not.toBe("industrial-v1");
  });

  it("stamps an industrial scope as industrial-v1", () => {
    const envelope = buildAnalysisTraceability({
      qualityGate: gateWithScope(industrialPeriods),
    });
    expect(envelope.pipelineStrategyId).toBe("industrial-v1");
  });

  /* ── Tier 3: best-effort — no sector signal leaves the field unset ── */
  it("leaves pipelineStrategyId unset when no subtype or scope is available", () => {
    const envelope = buildAnalysisTraceability({ sourceMode: "manual" });
    expect(envelope.pipelineStrategyId).toBeUndefined();
  });
});
