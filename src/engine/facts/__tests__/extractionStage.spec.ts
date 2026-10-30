import { describe, expect, it } from "vitest";
import type { RawPeriodData } from "../../types";
import { FACT_EXTRACTION_STAGE_VERSION, RECAST_LINE_CONCEPT_PREFIX, buildTextCanonicalFactBundle, extractRunFacts } from "../index";

const TAGGED: RawPeriodData[] = [
  {
    company_id: "ACME", period_end: "2024-03-31",
    raw_metric_values: { "Total Assets__BalanceSheet": 1_000, "Total Assets": 1_000, "Unread Line__BalanceSheet": 7 },
  },
  {
    company_id: "ACME", period_end: "2025-03-31",
    raw_metric_values: { "Total Assets__BalanceSheet": 1_100, "Total Assets": 1_100, "Unread Line__BalanceSheet": 8 },
  },
];

async function bundleFor(rawData: RawPeriodData[]) {
  return buildTextCanonicalFactBundle({
    rawData, sourceText: JSON.stringify(rawData), sourceMode: "json", fileName: "acme.json",
    scope: "consolidated", contentClass: "spec",
  });
}

describe("fact-extraction stage", () => {
  it("builds the fact set and feeds the recast the periods rebuilt from it", async () => {
    const output = await extractRunFacts({
      rawData: TAGGED, sourceMode: "json", debugInfo: null, parserDiagnostics: null, canonicalFacts: await bundleFor(TAGGED),
    });
    expect(output.stageVersion).toBe(FACT_EXTRACTION_STAGE_VERSION);
    expect(output.blockers).toEqual([]);
    expect(output.factSet?.facts.some((fact) => fact.conceptId.startsWith(RECAST_LINE_CONCEPT_PREFIX))).toBe(true);
    expect(output.recastReadsFacts).toBe(true);
    // The line no reader names is not a fact, so the recast does not see it.
    expect(output.recastPeriods.map((period) => period.raw_metric_values)).toEqual([
      { "Total Assets__BalanceSheet": 1_000, "Total Assets": 1_000 },
      { "Total Assets__BalanceSheet": 1_100, "Total Assets": 1_100 },
    ]);
  });

  it("feeds the recast the parse without a fact bundle", async () => {
    const output = await extractRunFacts({ rawData: TAGGED, sourceMode: "json", debugInfo: null, parserDiagnostics: null, canonicalFacts: null });
    expect(output.factSet).toBeNull();
    expect(output.recastReadsFacts).toBe(false);
    expect(output.recastPeriods).toEqual(TAGGED);
  });

  it("feeds the recast periods rebuilt from the facts of a parse whose labels carry no statement", async () => {
    const bare: RawPeriodData[] = TAGGED.map((period) => ({
      ...period,
      raw_metric_values: { "Total Assets": period.raw_metric_values["Total Assets"]!, "Revenue From Operations(Net)": 500, "Unread Line": 7 },
    }));
    const output = await extractRunFacts({ rawData: bare, sourceMode: "xbrl", debugInfo: null, parserDiagnostics: null, canonicalFacts: await bundleFor(bare) });
    expect(output.recastReadsFacts).toBe(true);
    // The line no reader names is not a fact, so the recast does not see it.
    expect(output.recastPeriods.map((period) => period.raw_metric_values)).toEqual([
      { "Total Assets": 1_000, "Revenue From Operations(Net)": 500 },
      { "Total Assets": 1_100, "Revenue From Operations(Net)": 500 },
    ]);
  });

  it("feeds the recast the parse when the bundle holds no fact for a line it reads", async () => {
    const bare: RawPeriodData[] = TAGGED.map((period) => ({
      ...period,
      raw_metric_values: { "Total Assets": period.raw_metric_values["Total Assets"]!, "Revenue From Operations(Net)": 500 },
    }));
    // A caller's bundle that maps the ontology's concepts but no recast line.
    const bundle = await bundleFor(bare);
    const ontologyOnly = { ...bundle!, conceptMappings: bundle!.conceptMappings.filter((mapping) => !mapping.conceptId.startsWith(RECAST_LINE_CONCEPT_PREFIX)) };
    const output = await extractRunFacts({ rawData: bare, sourceMode: "xbrl", debugInfo: null, parserDiagnostics: null, canonicalFacts: ontologyOnly });
    expect(output.factSet).not.toBeNull();
    expect(output.recastReadsFacts).toBe(false);
    expect(output.recastPeriods).toEqual(bare);
  });

  it("reports why a bundle's facts formed no set", async () => {
    const unmapped: RawPeriodData[] = [{ company_id: "ACME", period_end: "2024-03-31", raw_metric_values: { "Sales Growth %": 12 } }];
    const bundle = await buildTextCanonicalFactBundle({
      rawData: unmapped, sourceText: "x", sourceMode: "screener", fileName: "s.txt", scope: "consolidated", contentClass: "spec",
    });
    const output = await extractRunFacts({ rawData: unmapped, sourceMode: "screener", debugInfo: null, parserDiagnostics: null, canonicalFacts: bundle });
    expect(output.factSet).toBeNull();
    expect(output.blockers.map((blocker) => blocker.code)).toContain("NO_MAPPED_FACTS");
    expect(output.recastPeriods).toEqual(unmapped);
  });

  it("evaluates the parse's fidelity with the parser's own diagnostics", async () => {
    const output = await extractRunFacts({
      rawData: TAGGED, sourceMode: "json", debugInfo: null, canonicalFacts: null,
      parserDiagnostics: { sourceMode: "json", warningCount: 1, errorCount: 0, checks: [{ id: "json-shape", label: "JSON shape", passed: false, detail: "One row had no period." }] },
    });
    expect(output.parserFidelity.warningCount).toBe(1);
    expect(output.parserFidelity.checks.map((check) => check.id)).toContain("json-shape");
  });
});
