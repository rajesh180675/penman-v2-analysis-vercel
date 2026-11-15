/**
 * The rigor ladder's blockers that no spec pinned (mutation wave 6): the
 * quality gate's valuation block and scope block, single-period screening
 * mode, and a terminal-eligibility-blocking unusual item. Each case sets one,
 * on a dataset the quality gate otherwise passes, and requires the checkpoint
 * it withholds to name it: switched off, each left every spec green.
 */
import { describe, expect, it } from "vitest";
import { buildAnalysisTraceability } from "../analysisTraceability";
import type { AnalysisStatusSummary } from "../analysisStatus";
import { evaluateQualityGate, type QualityGateReport } from "../mappingAudit";
import { listMappingCoverageGroups } from "../mappingPolicy";
import type { RawPeriodData, RecastPeriod } from "../types";

function recastPeriod(period_end: string, specFlags: RecastPeriod["spec_flags"] = []): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000, CSE: 800, MI: 0, FA: 0, FO: 0, OA: 900, OL: 100,
      OL_TradePayables: 0, OL_OtherCurrentLiabilities: 0, OL_ProvisionsCurrent: 0, OL_ProvisionsLongTerm: 0,
      OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0, OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 0,
      NOA: 800, NFO: 0, DTL: 0, PensionObl: 0, OL_ex_DTL: 100, Goodwill: 0, CurrentAssets: 200, CurrentLiabilities: 100,
      Inventory: 30, TradeReceivables: 50, TradePayables: 20, PPE: 400, LIFO_reserve: 0, separationScore: 90,
      OA_PPE: 400, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0, OA_Inventory: 30, OA_TradeReceivables: 50,
      OA_DTA: 0, OA_CWIP: 0, OA_Other: 420,
    } as RecastPeriod["bs"],
    is: {} as RecastPeriod["is"],
    cu: {} as RecastPeriod["cu"],
    cf: { CFO: 100 } as RecastPeriod["cf"],
    spec_flags: specFlags,
  };
}

const cleanStatus = {
  status: "warning", tone: "amber", headline: "OK", blockingCount: 0, diagnosticCount: 0, optionalCount: 0,
  effectiveBlockingCount: 0, effectiveDiagnosticCount: 0, effectiveOptionalCount: 0, valuationStatus: "warning",
  reasons: [], policyVersion: "test",
} as unknown as AnalysisStatusSummary;

// Every critical mapping group filed under its first alias, with the quality
// gate's own minimum and core labels: the gate and the concept-identity layer
// both pass, so the case's own blocker is the only one.
function complete(): Record<string, number> {
  const values: Record<string, number> = {};
  for (const group of listMappingCoverageGroups()) {
    if (group.severity === "critical") values[`${group.keys[0]}__${group.statement}`] = 100;
  }
  for (const key of ["Total Assets__BalanceSheet", "Total Equity__BalanceSheet", "Profit After Tax__ProfitLoss",
    "Revenue From Operations(Net)__ProfitLoss", "Net Cash from Operating Activities__CashFlow",
    "Purchased of Fixed Assets__CashFlow", "Finance Cost__ProfitLoss",
    // The concept layer's required capex and PPE, by its own aliases.
    "Purchase of Fixed Assets__CashFlow", "Property, Plant and Equipment__BalanceSheet"]) values[key] = 100;
  return values;
}
const raw = (periods: readonly RecastPeriod[]): RawPeriodData[] =>
  periods.map((p) => ({ company_id: "BLOCKERS", period_end: p.period_end, raw_metric_values: complete() }));

function ladder(params: { recastData: RecastPeriod[]; qualityGate?: QualityGateReport }) {
  const env = buildAnalysisTraceability({
    runId: "blockers",
    companyId: "BLOCKERS",
    sourceMode: "capitaline",
    periodCount: params.recastData.length,
    recastPeriodCount: params.recastData.length,
    rawData: raw(params.recastData),
    recastData: params.recastData,
    analysisStatus: cleanStatus,
    ...(params.qualityGate ? { qualityGate: params.qualityGate } : {}),
  });
  return (level: string) => env.rigor.checkpoints.find((c) => c.level === level)!;
}

const twoYears = () => [recastPeriod("2024-03-31"), recastPeriod("2025-03-31")];
const gate = (edit: (g: QualityGateReport) => QualityGateReport) => edit(evaluateQualityGate(raw(twoYears()), null, null));

describe("rigor ladder blockers name themselves", () => {
  it("withholds economically-plausible when the quality gate blocks valuation", () => {
    const checkpoint = ladder({ recastData: twoYears(), qualityGate: gate((g) => ({ ...g, valuationBlocked: true })) })("economically-plausible");
    expect(checkpoint.achieved).toBe(false);
    expect(checkpoint.detail).toMatch(/Valuation-critical issues still block the run/);
  });

  it("withholds structural reconciliation when the scope policy blocks the dataset", () => {
    const checkpoint = ladder({ recastData: twoYears(), qualityGate: gate((g) => ({ ...g, scopeAssessment: { ...g.scopeAssessment, blocked: true } })) })("structurally-reconciled");
    expect(checkpoint.achieved).toBe(false);
    expect(checkpoint.detail).toMatch(/Scope policy blocked this dataset/);
  });

  it("caps a single-period screening upload below structural reconciliation", () => {
    const checkpoint = ladder({ recastData: twoYears(), qualityGate: gate((g) => ({ ...g, scopeAssessment: { ...g.scopeAssessment, screeningOnly: true } })) })("structurally-reconciled");
    expect(checkpoint.achieved).toBe(false);
    expect(checkpoint.detail).toMatch(/Single-period upload/);
  });

  it("withholds valuation-eligible when the terminal period carries a terminal-eligibility-blocking item", () => {
    const flagged = [recastPeriod("2024-03-31"), recastPeriod("2025-03-31", [
      { spec_id: "S-5.1", severity: 3, label: "LARGE_BUYBACK", message: "Buyback above 5% of CSE", affects_terminal: true, period: "2025-03-31" },
    ] as RecastPeriod["spec_flags"])];
    const checkpoint = ladder({ recastData: flagged })("valuation-eligible");
    expect(checkpoint.achieved).toBe(false);
    expect(checkpoint.detail).toMatch(/Unusual-item manifest flags 1 terminal-eligibility-blocking classification/);
  });
});
