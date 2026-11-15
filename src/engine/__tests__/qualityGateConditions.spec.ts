/**
 * Each of the quality gate's valuation-blocking conditions, holding alone.
 * Mutation wave 6 dropped them one at a time from the gate's verdict and every
 * spec stayed green: the gate's existing cases break several at once. The
 * fixture fills every critical mapping group from its own first alias, so the
 * gate passes, and each case then trips one condition.
 *
 * The two critical-gap conditions (unresolved critical keys, valuation-critical
 * gaps) are read from the same coverage summary and hold together, so neither
 * can block alone; dropping one is an equivalent mutant, not a gap.
 */
import { describe, expect, it } from "vitest";
import { evaluateQualityGate } from "../mappingAudit";
import { listMappingCoverageGroups } from "../mappingPolicy";
import { computeRecastPeriod } from "../PenmanNissimEngine";
import { DEFAULT_CONFIG, type RawPeriodData, type RecastPeriod } from "../types";

function complete(): Record<string, number> {
  const values: Record<string, number> = {};
  for (const group of listMappingCoverageGroups()) {
    if (group.severity !== "critical") continue;
    values[`${group.keys[0]}__${group.statement}`] = 100;
  }
  // The gate's own minimum and core lines, by the labels it checks.
  for (const key of ["Total Assets__BalanceSheet", "Total Equity__BalanceSheet", "Profit After Tax__ProfitLoss",
    "Revenue From Operations(Net)__ProfitLoss", "Net Cash from Operating Activities__CashFlow",
    "Purchased of Fixed Assets__CashFlow", "Finance Cost__ProfitLoss"]) values[key] = 100;
  return values;
}
const periods = (edit: (values: Record<string, number>) => void = () => {}): RawPeriodData[] =>
  ["2024-03-31", "2025-03-31"].map((period_end) => {
    const values = complete();
    edit(values);
    return { company_id: "QG", period_end, raw_metric_values: values };
  });

describe("the quality gate blocks valuation on each condition alone", () => {
  it("passes the complete dataset", () => {
    const gate = evaluateQualityGate(periods(), null, null);
    expect(gate.valuationBlocked, gate.blockingReasons.join("; ")).toBe(false);
  });

  it("blocks on a missing minimum line the mapping still resolves (total assets filed only as total equity and liabilities)", () => {
    const gate = evaluateQualityGate(periods((v) => {
      delete v["Total Assets__BalanceSheet"];
      v["Total Equity and Liabilities__BalanceSheet"] = 100;
    }), null, null);
    expect(gate.missingMinimum).toHaveLength(1);
    expect(gate.valuationCriticalGaps).toEqual([]);
    expect(gate.valuationBlocked).toBe(true);
  });

  it("blocks on a missing core line the mapping still resolves (finance cost filed as 'Finance Costs')", () => {
    const gate = evaluateQualityGate(periods((v) => {
      delete v["Finance Cost__ProfitLoss"];
      v["Finance Costs__ProfitLoss"] = 100;
    }), null, null);
    expect(gate.missingCore).toHaveLength(1);
    expect(gate.valuationCriticalGaps).toEqual([]);
    expect(gate.valuationBlocked).toBe(true);
  });

  it("blocks on a guarded valuation readiness when the mapping is complete", () => {
    // Freshly computed recast periods carry no ratios, so readiness is guarded.
    const raw = periods();
    const recast: RecastPeriod[] = [];
    for (const p of raw) recast.push(computeRecastPeriod(p, DEFAULT_CONFIG, recast.at(-1)));
    const gate = evaluateQualityGate(raw, null, recast);
    expect(gate.missingMinimum).toEqual([]);
    expect(gate.missingCore).toEqual([]);
    expect(gate.valuationCriticalGaps).toEqual([]);
    expect(gate.valuationBlocked).toBe(true);
  });

  it("caps the tier at Tier 3 when the scope policy blocks the dataset", () => {
    const gate = evaluateQualityGate(periods((v) => {
      v["Cash and Balance with RBI__BalanceSheet"] = 50;
      v["Money at Call and Short Notice__BalanceSheet"] = 50;
      v["Premium Earned (Net)__ProfitLoss"] = 50;
      v["Claims Expenses__ProfitLoss"] = 50;
    }), null, null);
    expect(gate.scopeAssessment.blocked, gate.scopeAssessment.label).toBe(true);
    expect(gate.tier).toBe("Tier 3");
  });
});
