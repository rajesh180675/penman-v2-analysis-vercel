/* ================================================================
   MappingAuditGrid: the three truncated lists.

   The backlog list was the worst of the family — two truncations
   stacked. `summarizeMappingBacklog` already `.slice(0, 25)`s into
   `topActionable`, and the panel took 12 of those. Measured across
   five bundled companies, `topActionable` was 25 every time while
   `actionableCount` ran 49 (Infosys) to 211 (Reliance). So twelve
   rows stood for 211, and reporting `topActionable.length` would
   have under-reported it too: the remainder has to be counted
   against `actionableCount`, the only number on hand that is not
   itself a window.

   Scope signals were sliced to 6 unsorted. `assessAnalysisScope`
   sorts by `periodsObserved` on six return paths but not on the
   explicit `company_type` path — which is the path the library
   picker always takes, since it always supplies a concrete type.

   The `yamlKeysNotInDataset` cap of 200 could not bind: the list is
   a subset of the YAML key universe, and the whole spec file yields
   182 extractable keys. Dead code, now removed.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MappingAuditGrid } from "../debug/MappingAuditGrid";
import type { MappingAuditReport, QualityGateReport } from "../../engine/mappingAudit";
import type { MappingBacklogEntry } from "../../engine/mappingBacklogPolicy";
import type { ScopeSignal } from "../../engine/scopePolicy";

const COVERAGE_SUMMARY: QualityGateReport["coverageSummary"] = {
  policyVersion: "test",
  issues: [],
  unresolvedBySeverity: { critical: [], warning: [], info: [] },
  unresolvedByTier: { "Tier A": [], "Tier B": [], "Tier C": [], "Tier D": [] },
  totalsByTier: {
    "Tier A": { total: 0, resolved: 0, unresolved: 0 },
    "Tier B": { total: 0, resolved: 0, unresolved: 0 },
    "Tier C": { total: 0, resolved: 0, unresolved: 0 },
    "Tier D": { total: 0, resolved: 0, unresolved: 0 },
  },
};

function backlogEntry(index: number): MappingBacklogEntry {
  return {
    statement: "ProfitLoss",
    key: `BacklogKey${index}`,
    periodsObserved: 10,
    nonZeroPeriods: 8,
    latestValue: 1000 + index,
    maxAbsValue: 5000,
    triage: {
      policyVersion: "test",
      action: "add-to-spec",
      priority: "diagnostic",
      rationale: `Rationale ${index}`,
      targetLine: null,
      targetGroupId: null,
      targetGroupTitle: null,
      suggestedSpecPath: null,
    },
  };
}

function audit(overrides: Partial<MappingAuditReport> = {}): MappingAuditReport {
  return {
    mappingSpecVersion: "test",
    policyVersion: "test",
    usedKeysNotInYaml: [],
    yamlKeysNotInDataset: [],
    unresolvedCriticalByStatement: { BalanceSheet: [], ProfitLoss: [], CashFlow: [] },
    datasetKeyCounts: { BalanceSheet: 40, ProfitLoss: 30, CashFlow: 20, Unknown: 0 },
    coverageSummary: COVERAGE_SUMMARY,
    outOfSpecLabels: [],
    backlogSummary: {
      policyVersion: "test",
      totalsByAction: {
        "add-to-spec": 0,
        "group-to-existing": 0,
        "ignore-non-core": 0,
        review: 0,
      },
      totalsByPriority: { blocking: 0, diagnostic: 0, optional: 0 },
      actionableCount: 0,
      ignoredCount: 0,
      topActionable: [],
    },
    clusterSuggestions: {
      clusters: [],
      unclustered: [],
      stats: { totalUnknown: 0, clusteredCount: 0, aliasRecommendation: 0, reviewCount: 0 },
    },
    correlationSuggestions: [],
    promotionCandidates: [],
    ...overrides,
  };
}

function gate(signals: ScopeSignal[]): QualityGateReport {
  return {
    tier: "Tier 1",
    valuationBlocked: false,
    missingMinimum: [],
    missingCore: [],
    blockingReasons: [],
    policyVersion: "test",
    coverageSummary: COVERAGE_SUMMARY,
    valuationCriticalGaps: [],
    ratioCriticalGaps: [],
    scopeAssessment: {
      policyVersion: "test",
      classification: "supported-financial",
      analysisFamily: "financial-institution",
      blocked: false,
      label: "Explicit company type: bank",
      reasons: [],
      recommendedAction: "Proceed.",
      signals,
    },
  };
}

function render(report: MappingAuditReport, qualityGate?: QualityGateReport) {
  return renderToStaticMarkup(
    <MappingAuditGrid mappingAudit={report} qualityGate={qualityGate ?? null} />,
  );
}

describe("MappingAuditGrid backlog triage", () => {
  /** The real shape: the engine window is 25, the true count is far larger. */
  function realisticBacklog() {
    return audit({
      backlogSummary: {
        ...audit().backlogSummary,
        actionableCount: 211,
        topActionable: Array.from({ length: 25 }, (_, index) => backlogEntry(index)),
      },
    });
  }

  it("counts the remainder against the true actionable total, not the engine's window", () => {
    const html = render(realisticBacklog());
    expect(html).toContain("Showing 12 of 211 actionable");
    // 25 would be the engine's own `topActionable` cap leaking through as if it
    // were the population.
    expect(html).not.toContain("of 25 actionable");
  });

  it("renders exactly the first twelve backlog rows", () => {
    const html = render(realisticBacklog());
    expect(html).toContain("BacklogKey0");
    expect(html).toContain("BacklogKey11");
    expect(html).not.toContain("BacklogKey12");
  });

  it("reports the total honestly when the engine window did not bind either", () => {
    const html = render(
      audit({
        backlogSummary: {
          ...audit().backlogSummary,
          actionableCount: 3,
          topActionable: [backlogEntry(0), backlogEntry(1), backlogEntry(2)],
        },
      }),
    );
    expect(html).toContain("Showing 3 of 3 actionable");
  });

  it("keeps the clean-backlog copy and no count line when nothing is actionable", () => {
    const html = render(audit());
    expect(html).toContain("No actionable backlog labels remain in this dataset");
    expect(html).not.toMatch(/Showing \d+ of/);
  });
});

describe("MappingAuditGrid triage-action strip", () => {
  /* Every count deliberately distinct, and `actionableCount` consistent with the
     producer: `entries.filter(e => e.action !== "ignore-non-core").length`
     (mappingBacklogPolicy.ts:463) = 7 + 5 + 3 = 15, over a backlog of 24. */
  function strip() {
    return audit({
      backlogSummary: {
        ...audit().backlogSummary,
        totalsByAction: {
          "add-to-spec": 7,
          "group-to-existing": 5,
          review: 3,
          "ignore-non-core": 9,
        },
        actionableCount: 15,
      },
    });
  }

  const html = render(strip());
  const text = html.replace(/<!-- -->/g, "");

  /** The number a StatBox renders above `label` — it emits value then label. */
  function boxValue(label: string): number | null {
    const m = text.match(
      new RegExp(`>([\\d,]+)</div><div class="[^"]*">${label}</div>`),
    );
    return m ? Number(m[1]!.replace(/,/g, "")) : null;
  }

  it("shows each triage action against its own count", () => {
    // Pinned value-to-label, not merely present: four same-shaped tiles in a row
    // let any pair swap undetected if only the labels are asserted.
    expect(boxValue("Add to spec")).toBe(7);
    expect(boxValue("Group existing")).toBe(5);
    expect(boxValue("Review")).toBe(3);
    expect(boxValue("Ignored")).toBe(9);
  });

  it("states the backlog total the four action tiles partition", () => {
    expect(text).toContain("by triage action · 24 total");
  });

  it("marks the actionable figure as a subtotal of tiles already shown", () => {
    // Was labelled "Actionable" in the same five-column row as its own
    // components, so summing the row gave 2×actionable + ignored (39) rather
    // than the backlog size (24).
    expect(boxValue("Actionable subtotal")).toBe(15);
    expect(text).toContain("Not a fifth category");
    expect(text).not.toContain("39 total");
  });

  it("does not count the subtotal into the total it displays", () => {
    const partition =
      boxValue("Add to spec")! +
      boxValue("Group existing")! +
      boxValue("Review")! +
      boxValue("Ignored")!;
    expect(partition).toBe(24);
    // The identity the two producers guarantee, pinned so a change to either
    // `totalsByAction` or `actionableCount` surfaces here.
    expect(boxValue("Actionable subtotal")).toBe(partition - boxValue("Ignored")!);
  });
});

describe("MappingAuditGrid scope signals", () => {
  /** Detection order, which is what the explicit-company_type path returns. */
  function unsortedSignals(): ScopeSignal[] {
    return [
      { kind: "nbfc", key: "weak-one", periodsObserved: 1 },
      { kind: "banking", key: "strong-a", periodsObserved: 12 },
      { kind: "banking", key: "strong-b", periodsObserved: 11 },
      { kind: "banking", key: "strong-c", periodsObserved: 10 },
      { kind: "banking", key: "strong-d", periodsObserved: 9 },
      { kind: "banking", key: "strong-e", periodsObserved: 8 },
      { kind: "banking", key: "strong-f", periodsObserved: 7 },
    ];
  }

  it("shows the signals observed over the most periods, not the first detected", () => {
    const html = render(audit(), gate(unsortedSignals()));
    expect(html).toContain("strong-f");
    expect(html).not.toContain("weak-one");
  });

  it("says how many signals there are and how many it left out", () => {
    const html = render(audit(), gate(unsortedSignals()));
    expect(html).toContain("Scope signals (7)");
    expect(html).toContain("+1 weaker signal not shown");
  });

  it("words multiple hidden signals in the plural", () => {
    const html = render(
      audit(),
      gate([...unsortedSignals(), { kind: "nbfc", key: "weak-two", periodsObserved: 1 }]),
    );
    expect(html).toContain("+2 weaker signals not shown");
  });

  it("claims nothing hidden when every signal fits", () => {
    const html = render(
      audit(),
      gate([{ kind: "banking", key: "only-one", periodsObserved: 12 }]),
    );
    expect(html).toContain("Scope signals (1)");
    expect(html).not.toMatch(/not shown/);
  });

  it("renders no scope block when no signal fired", () => {
    const html = render(audit(), gate([]));
    expect(html).not.toMatch(/Scope signals \(/);
  });

  it("does not reorder the array it was given", () => {
    // Compared against a literal: an in-place sort would reorder both sides of a
    // fixture-to-fixture comparison and pass. The array belongs to
    // `assessAnalysisScope`'s return value, which other surfaces also read.
    const signals = unsortedSignals();
    render(audit(), gate(signals));
    expect(signals.map((signal) => signal.key)).toEqual([
      "weak-one",
      "strong-a",
      "strong-b",
      "strong-c",
      "strong-d",
      "strong-e",
      "strong-f",
    ]);
  });
});

describe("MappingAuditGrid YAML gap list", () => {
  it("renders every YAML gap, including past the old dead 200-item cap", () => {
    const keys = Array.from({ length: 210 }, (_, index) => `YamlGap${index}`);
    const html = render(audit({ yamlKeysNotInDataset: keys }));
    expect(html).toContain("YamlGap0");
    expect(html).toContain("YamlGap209");
  });

  it("keeps the none-found copy when the YAML is fully covered", () => {
    // The other two columns are given content on purpose. All three render the
    // same "None" string when empty, so a bare `toContain("None")` would pass
    // with this column rendering something else entirely.
    const html = render(
      audit({
        usedKeysNotInYaml: ["SpecOnlyKey"],
        unresolvedCriticalByStatement: {
          BalanceSheet: ["MissingBsKey"],
          ProfitLoss: ["MissingPlKey"],
          CashFlow: ["MissingCfKey"],
        },
      }),
    );
    expect(html).toContain("YAML keys not present in dataset");
    expect(html).toContain(">None</div>");
    expect(html.match(/>None<\/div>/g)).toHaveLength(1);
  });
});
