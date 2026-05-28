import { describe, expect, it } from "vitest";
import {
  CONCEPT_ONTOLOGY,
  ConceptDefinition,
  detectConflicts,
  MAX_CONCEPT_CONFLICTS,
  summarizeConceptIdentity,
} from "../conceptOntology";
import type { RawPeriodData } from "../types";

function mkPeriod(period_end: string, raw: Record<string, number>): RawPeriodData {
  return {
    company_id: "TEST",
    period_end,
    raw_metric_values: raw,
  };
}

describe("conceptOntology / concept identity", () => {
  it("registry has unique concept ids", () => {
    const ids = CONCEPT_ONTOLOGY.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("registry concepts derive statementOwner consistently from statement", () => {
    const expected: Record<ConceptDefinition["statement"], ConceptDefinition["statementOwner"]> = {
      BalanceSheet: "BS",
      ProfitLoss: "IS",
      CashFlow: "CF",
      Derived: "SD",
    };
    for (const concept of CONCEPT_ONTOLOGY) {
      expect(concept.statementOwner).toBe(expected[concept.statement]);
    }
  });

  it("aliases resolve cleanly for the bundled ontology (no cross-statement self-conflict)", () => {
    const conflicts = detectConflicts([], CONCEPT_ONTOLOGY);
    const crossStatement = conflicts.filter((c) => c.conflictClass === "cross-statement-conflict");
    expect(crossStatement).toEqual([]);
  });

  it("flags cross-statement-conflict when an alias appears under two different statements", () => {
    const broken: ConceptDefinition[] = [
      ...CONCEPT_ONTOLOGY,
      {
        id: "fake_revenue_on_bs",
        label: "Bogus revenue on balance sheet",
        statement: "BalanceSheet",
        statementOwner: "BS",
        signConvention: "asset",
        aggregationBehavior: "latest",
        aliases: ["Revenue From Operations"],
        valuationRelevance: "supporting",
      },
    ];
    const conflicts = detectConflicts([], broken);
    const cs = conflicts.filter((c) => c.conflictClass === "cross-statement-conflict");
    expect(cs.length).toBeGreaterThanOrEqual(2);
    expect(cs.every((c) => c.statements.length >= 2)).toBe(true);
  });

  it("flags duplicate-source when two raw labels both map to the same concept in one period", () => {
    const period = mkPeriod("2025-03-31", {
      "Inventory__BS": 100,
      "Inventories__BS": 110,
    });
    const conflicts = detectConflicts([period]);
    const dup = conflicts.filter((c) => c.conflictClass === "duplicate-source" && c.conceptId === "inventory");
    expect(dup).toHaveLength(1);
    expect(dup[0].rawLabels.length).toBeGreaterThanOrEqual(2);
    expect(dup[0].affectedPeriods).toEqual(["2025-03-31"]);
  });

  it("flags unresolved critical concepts when the latest period misses a core mapping", () => {
    const period = mkPeriod("2025-03-31", {
      "SomethingElse__BS": 100,
    });
    const conflicts = detectConflicts([period]);
    const unresolved = conflicts.filter((c) => c.conflictClass === "unresolved");
    // Core non-derived concepts: revenue, pat, equity, ppe, capex, cfo (loans is core but sector-gated)
    expect(unresolved.length).toBeGreaterThanOrEqual(5);
    expect(unresolved.every((c) => c.affectedPeriods.includes("2025-03-31"))).toBe(true);
  });

  it("returns no unresolved-critical conflicts when the period covers core concepts", () => {
    const period = mkPeriod("2025-03-31", {
      "Revenue From Operations__IS": 1000,
      "Profit After Tax__IS": 100,
      "Total Equity__BS": 5000,
      "Property, Plant and Equipment__BS": 4000,
      "Purchase of Fixed Assets__CF": -200,
      "Net Cash From Operating Activities__CF": 250,
      "Loan Assets__BS": 1,
    });
    const conflicts = detectConflicts([period]);
    expect(conflicts.filter((c) => c.conflictClass === "unresolved")).toEqual([]);
  });

  it("summarizeConceptIdentity returns 'clean' for empty input", () => {
    const summary = summarizeConceptIdentity([]);
    expect(summary.status).toBe("clean");
    expect(summary.conflictCount).toBe(0);
    expect(summary.unresolvedCriticalCount).toBe(0);
    expect(summary.truncated).toBe(false);
  });

  it("summarizeConceptIdentity returns 'valuation-blocked' when a critical concept is unresolved", () => {
    const period = mkPeriod("2025-03-31", { "Foo__BS": 1 });
    const summary = summarizeConceptIdentity([period]);
    expect(summary.status).toBe("valuation-blocked");
    expect(summary.unresolvedCriticalCount).toBeGreaterThan(0);
  });

  it("summarizeConceptIdentity returns 'conflicts-present' for non-critical conflicts only", () => {
    const period = mkPeriod("2025-03-31", {
      "Revenue From Operations__IS": 1000,
      "Profit After Tax__IS": 100,
      "Total Equity__BS": 5000,
      "Property, Plant and Equipment__BS": 4000,
      "Purchase of Fixed Assets__CF": -200,
      "Net Cash From Operating Activities__CF": 250,
      "Loan Assets__BS": 1,
      // duplicate trade receivables source
      "Trade Receivables__BS": 200,
      "Long-term Trade Receivables__BS": 100,
    });
    const summary = summarizeConceptIdentity([period]);
    expect(summary.status).toBe("conflicts-present");
    expect(summary.unresolvedCriticalCount).toBe(0);
    expect(summary.conflictCount).toBeGreaterThan(0);
  });

  it("truncates conflict lists at MAX_CONCEPT_CONFLICTS", () => {
    // Build N synthetic concepts that all share the same alias (which
    // generates a cross-statement-conflict per concept).
    const synthetic: ConceptDefinition[] = [];
    for (let i = 0; i < 250; i++) {
      synthetic.push({
        id: `synth_${i}`,
        label: `synth ${i}`,
        statement: i % 2 === 0 ? "BalanceSheet" : "ProfitLoss",
        statementOwner: i % 2 === 0 ? "BS" : "IS",
        signConvention: "asset",
        aggregationBehavior: "latest",
        aliases: ["Shared Alias"],
        valuationRelevance: "supporting",
      });
    }
    const summary = summarizeConceptIdentity([], synthetic);
    expect(summary.truncated).toBe(true);
    expect(summary.conflicts.length).toBe(MAX_CONCEPT_CONFLICTS);
    expect(summary.conflictCount).toBe(250);
  });

  it("conflicts are deterministic-sorted by conceptId then conflictClass", () => {
    const period = mkPeriod("2025-03-31", { "Foo__BS": 1 });
    const a = detectConflicts([period]);
    const b = detectConflicts([period]);
    expect(a.map((c) => c.conceptId)).toEqual(b.map((c) => c.conceptId));
    for (let i = 1; i < a.length; i++) {
      const cmp = a[i - 1].conceptId.localeCompare(a[i].conceptId);
      expect(cmp).toBeLessThanOrEqual(0);
    }
  });
});
