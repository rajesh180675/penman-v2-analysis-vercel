import { describe, expect, it } from "vitest";
import type { RawPeriodData } from "../../types";
import { RECAST_LINE_CONCEPT_PREFIX, adaptLegacyRawPeriodsToFactSet, buildRecastLineMappings, canProjectRecastPeriods, projectRecastPeriods, type FactSet } from "../index";

const PERIODS: RawPeriodData[] = [
  {
    company_id: "ACME",
    period_end: "2024-03-31",
    currency_unit: "Crores",
    accounting_standard: "ind-as",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1_000,
      "Total Assets": 1_000,
      // An empty balance-sheet cell the parser ranks first for the bare key.
      "Finance Cost__BalanceSheet": null,
      "Finance Cost__ProfitLoss": 40,
      "Finance Cost": null,
      "P/L on Sales of Invest__CashFlow": -0.45,
      "P/L on Sales of Invest": -0.45,
      // A label no pipeline reader names.
      "Unread Line Of The Export__BalanceSheet": 7,
    },
  },
  {
    company_id: "ACME",
    period_end: "2025-03-31",
    currency_unit: "Crores",
    accounting_standard: "ind-as",
    raw_metric_values: { "Total Assets__BalanceSheet": 1_100, "Total Assets": 1_100 },
  },
];

async function factSetFor(periods: RawPeriodData[]): Promise<FactSet> {
  const artifactId = `sha256:${"a".repeat(64)}` as const;
  const adapted = await adaptLegacyRawPeriodsToFactSet({
    rawData: periods,
    sourceArtifacts: [{
      artifactId, fileName: "acme.json", mediaType: "application/json", byteLength: 1, sourceMode: "json",
      acquiredAt: null, filingAsOf: null, issuerId: "ACME", scope: "consolidated", parserVersion: "spec", contentClass: "spec",
    }],
    periodSources: Object.fromEntries(periods.map((period) => [period.period_end, {
      kind: "reported" as const, artifactId, filingVersion: "original", scope: "consolidated" as const,
      accountingStandard: "ind-as" as const, durationStart: `${Number(period.period_end.slice(0, 4)) - 1}-04-01`,
    }])),
    conceptMappings: buildRecastLineMappings(periods),
  });
  if (adapted.status !== "created") throw new Error(adapted.diagnostics.map((d) => d.message).join("; "));
  return adapted.factSet!;
}

describe("projectRecastPeriods", () => {
  it("rebuilds each period's recast lines from the facts, at their values", async () => {
    const projected = projectRecastPeriods(await factSetFor(PERIODS), PERIODS);
    expect(projected.map((period) => period.period_end)).toEqual(["2024-03-31", "2025-03-31"]);
    expect(projected[0]!.raw_metric_values).toEqual({
      "Total Assets__BalanceSheet": 1_000,
      "Total Assets": 1_000,
      // The parser ranked the empty balance-sheet cell first, so the bare key stays empty.
      "Finance Cost__ProfitLoss": 40,
      "P/L on Sales of Invest__CashFlow": -0.45,
      "P/L on Sales of Invest": -0.45,
    });
    expect(projected[1]!.raw_metric_values).toEqual({ "Total Assets__BalanceSheet": 1_100, "Total Assets": 1_100 });
  });

  it("keeps every period field but the values", async () => {
    const [projected] = projectRecastPeriods(await factSetFor(PERIODS), PERIODS);
    const { raw_metric_values: _values, ...rest } = projected!;
    const { raw_metric_values: _original, ...original } = PERIODS[0]!;
    expect(rest).toEqual(original);
  });

  it("ranks a label's statements as the parser does for its bare key", async () => {
    const period: RawPeriodData = {
      company_id: "ACME", period_end: "2024-03-31",
      raw_metric_values: { "Depreciation__ProfitLoss": 10, "Depreciation__CashFlow": 11, "Depreciation": 10 },
    };
    const [projected] = projectRecastPeriods(await factSetFor([period]), [period]);
    expect(projected!.raw_metric_values.Depreciation).toBe(10);
  });

  it("reads only recast-line facts", async () => {
    const factSet = await factSetFor(PERIODS);
    expect(factSet.facts.every((fact) => fact.conceptId.startsWith(RECAST_LINE_CONCEPT_PREFIX))).toBe(true);
    const withOtherConcept: FactSet = {
      ...factSet,
      facts: factSet.facts.map((fact) => fact.rawLabel === "Total Assets__BalanceSheet" ? { ...fact, conceptId: "equity" } : fact),
    };
    const [projected] = projectRecastPeriods(withOtherConcept, PERIODS);
    expect(projected!.raw_metric_values["Total Assets__BalanceSheet"]).toBeUndefined();
  });
});

describe("canProjectRecastPeriods", () => {
  it("accepts a parse whose every recast line has a fact", async () => {
    expect(canProjectRecastPeriods(await factSetFor(PERIODS), PERIODS)).toBe(true);
  });

  it("refuses a parse with a recast line the fact set holds no fact for", async () => {
    const bare: RawPeriodData = { company_id: "ACME", period_end: "2024-03-31", raw_metric_values: { "Total Assets": 1_000 } };
    // Facts built from the tagged parse only: the bare-label period has none.
    expect(canProjectRecastPeriods(await factSetFor(PERIODS), [...PERIODS, bare])).toBe(false);
  });

  it("ignores bare labels the recast does not read, and empty values", async () => {
    const period: RawPeriodData = {
      company_id: "ACME", period_end: "2024-03-31",
      raw_metric_values: { "Total Assets__BalanceSheet": 1, "Total Assets": 1, "Sales Growth %": 12, "Finance Cost": null },
    };
    expect(canProjectRecastPeriods(await factSetFor([period]), [period])).toBe(true);
  });
});

describe("a source whose labels carry no statement", () => {
  // As a Screener table, an XBRL instance or a manual entry writes them.
  const BARE: RawPeriodData[] = [
    { company_id: "ACME", period_end: "2024-03-31", raw_metric_values: { "Total Assets": 1_000, "Inventories": 120, "Finance Cost": 40, "Sales Growth %": 12 } },
    { company_id: "ACME", period_end: "2025-03-31", raw_metric_values: { "Total Assets": 1_100, "Inventories": 130, "Finance Cost": 44, "Sales Growth %": 9 } },
  ];

  it("records each recast line on its bare label, on the statement the pipeline reads it from, as inferred", async () => {
    const facts = (await factSetFor(BARE)).facts.filter((fact) => fact.conceptId.startsWith(RECAST_LINE_CONCEPT_PREFIX));
    const byLabel = Object.fromEntries(facts.filter((fact) => fact.period.end === "2024-03-31").map((fact) => [fact.rawLabel, fact]));
    expect(Object.keys(byLabel).sort()).toEqual(["Finance Cost", "Inventories", "Total Assets"]);
    expect(byLabel["Total Assets"]!.statement).toBe("BS");
    expect(byLabel["Finance Cost"]!.statement).toBe("IS");
    // Named on the balance sheet and as a cash-flow change: the parser's bare
    // key ranks the balance sheet first.
    expect(byLabel["Inventories"]!.statement).toBe("BS");
    expect(facts.every((fact) => fact.factKind === "reported" && fact.confidence === "inferred")).toBe(true);
  });

  it("rebuilds the parse's recast lines from those facts", async () => {
    const factSet = await factSetFor(BARE);
    expect(canProjectRecastPeriods(factSet, BARE)).toBe(true);
    expect(projectRecastPeriods(factSet, BARE).map((period) => period.raw_metric_values)).toEqual([
      { "Total Assets": 1_000, "Inventories": 120, "Finance Cost": 40 },
      { "Total Assets": 1_100, "Inventories": 130, "Finance Cost": 44 },
    ]);
  });

  it("maps a bare label the parse also tags only on its tagged key", async () => {
    const mappings = buildRecastLineMappings(PERIODS);
    expect(mappings.map((mapping) => mapping.rawLabel)).not.toContain("Total Assets");
    expect(mappings.every((mapping) => mapping.statementInferred !== true)).toBe(true);
  });
});
