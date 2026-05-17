import { describe, expect, it } from "vitest";
import { buildAnalysisTraceability } from "../analysisTraceability";
import type { AnalysisStatusSummary } from "../analysisStatus";
import type { RecastPeriod } from "../types";

/**
 * Phase J5 — distress gate on `valuation-eligible` rigor advancement.
 *
 * Even when structural reconciliation is clean and the analysis status is
 * not "guarded", a financially distressed dataset (negative net worth or
 * going-concern stress) must NOT advance to `valuation-eligible`. Equity-
 * side intrinsic values are mathematically defined but economically
 * meaningless on these datasets, and graduating the rigor level would
 * mislead reviewers.
 */

function recastPeriod(
  period_end: string,
  overrides: { CSE: number; NFO?: number; CFO?: number },
): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000,
      CSE: overrides.CSE,
      MI: 0,
      FA: 0,
      FO: 0,
      OA: 900,
      OL: 100,
      OL_TradePayables: 0,
      OL_OtherCurrentLiabilities: 0,
      OL_ProvisionsCurrent: 0,
      OL_ProvisionsLongTerm: 0,
      OL_CurrentTaxLiabilities: 0,
      OL_NonCurrentTaxLiabilities: 0,
      OL_DeferredTaxLiabilitiesNet: 0,
      OL_OtherNonCurrentLiabilities: 0,
      NOA: 800,
      NFO: overrides.NFO ?? 0,
      DTL: 0,
      PensionObl: 0,
      OL_ex_DTL: 100,
      Goodwill: 0,
      CurrentAssets: 200,
      CurrentLiabilities: 100,
      Inventory: 30,
      TradeReceivables: 50,
      TradePayables: 20,
      PPE: 400,
      LIFO_reserve: 0,
      separationScore: 90,
      OA_PPE: 400,
      OA_ROU: 0,
      OA_Goodwill: 0,
      OA_OtherIntangibles: 0,
      OA_Inventory: 30,
      OA_TradeReceivables: 50,
      OA_DTA: 0,
      OA_CWIP: 0,
      OA_Other: 420,
    } as RecastPeriod["bs"],
    is: {} as RecastPeriod["is"],
    cu: {} as RecastPeriod["cu"],
    cf: { CFO: overrides.CFO ?? 100 } as RecastPeriod["cf"],
  };
}

const cleanStatus: AnalysisStatusSummary = {
  status: "warning",
  tone: "amber",
  headline: "OK",
  blockingCount: 0,
  diagnosticCount: 0,
  optionalCount: 0,
  effectiveBlockingCount: 0,
  effectiveDiagnosticCount: 0,
  effectiveOptionalCount: 0,
  valuationStatus: "warning",
  reasons: [],
  policyVersion: "test",
} as unknown as AnalysisStatusSummary;

describe("Phase J5 — distress gates rigor ladder advancement", () => {
  it("does not advance to valuation-eligible when latest CSE ≤ 0 (severe distress)", () => {
    const recastData = [
      recastPeriod("2022-03-31", { CSE: 1000 }),
      recastPeriod("2023-03-31", { CSE: 500 }),
      recastPeriod("2024-03-31", { CSE: -300 }),
    ];

    const env = buildAnalysisTraceability({
      runId: "test-1",
      companyId: "VODAFONEIDEA",
      sourceMode: "capitaline",
      periodCount: 3,
      recastPeriodCount: 3,
      rawData: recastData.map((p) => ({
        company_id: "VODAFONEIDEA",
        period_end: p.period_end,
        raw_metric_values: { "Total Equity__BalanceSheet": p.bs.CSE },
      })),
      recastData,
      analysisStatus: cleanStatus,
    });

    const valEligible = env.rigor.checkpoints.find((c) => c.level === "valuation-eligible");
    expect(valEligible).toBeDefined();
    expect(valEligible!.achieved).toBe(false);
    expect(valEligible!.detail).toMatch(/distress|negative/i);
    expect(env.rigor.achievedLevels).not.toContain("valuation-eligible");
  });

  it("does not advance to valuation-eligible on critical distress (sustained negative CSE + cash burn)", () => {
    const recastData = [
      recastPeriod("2021-03-31", { CSE: -5000, CFO: 1000 }),
      recastPeriod("2022-03-31", { CSE: -8000, CFO: 800 }),
      recastPeriod("2023-03-31", { CSE: -12000, CFO: 200 }),
      recastPeriod("2024-03-31", { CSE: -16000, CFO: -100 }),
      recastPeriod("2025-03-31", { CSE: -20000, CFO: -500 }),
    ];

    const env = buildAnalysisTraceability({
      runId: "test-2",
      companyId: "VODAFONEIDEA",
      sourceMode: "capitaline",
      periodCount: 5,
      recastPeriodCount: 5,
      rawData: recastData.map((p) => ({
        company_id: "VODAFONEIDEA",
        period_end: p.period_end,
        raw_metric_values: { "Total Equity__BalanceSheet": p.bs.CSE },
      })),
      recastData,
      analysisStatus: cleanStatus,
    });

    const valEligible = env.rigor.checkpoints.find((c) => c.level === "valuation-eligible");
    expect(valEligible!.achieved).toBe(false);
    expect(valEligible!.detail).toMatch(/Critical/);
  });

  it("does not block on warning-only distress (isolated history, latest CSE positive)", () => {
    // Warning severity (one isolated period) does NOT block — only severe
    // and critical do. The detail message should not mention distress.
    const recastData = [
      recastPeriod("2020-03-31", { CSE: 800 }),
      recastPeriod("2021-03-31", { CSE: -100 }),
      recastPeriod("2022-03-31", { CSE: 400 }),
      recastPeriod("2023-03-31", { CSE: 700 }),
      recastPeriod("2024-03-31", { CSE: 1000 }),
    ];

    const env = buildAnalysisTraceability({
      runId: "test-3",
      companyId: "RECOVERED",
      sourceMode: "capitaline",
      periodCount: 5,
      recastPeriodCount: 5,
      rawData: recastData.map((p) => ({
        company_id: "RECOVERED",
        period_end: p.period_end,
        raw_metric_values: { "Total Equity__BalanceSheet": p.bs.CSE },
      })),
      recastData,
      analysisStatus: cleanStatus,
    });

    // The gate's detail string should not mention "distress" — i.e., the
    // distress gate is NOT what's blocking. Whether the run actually
    // advances to valuation-eligible depends on other gates (reconciliation
    // residuals, valuation status) that this test isn't trying to satisfy.
    const valEligible = env.rigor.checkpoints.find((c) => c.level === "valuation-eligible");
    expect(valEligible!.detail).not.toMatch(/distress/i);
  });
});
