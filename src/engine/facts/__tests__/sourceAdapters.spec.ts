import { describe, expect, it } from "vitest";
import type { CapitalineParseDebug } from "../../capitalineParser";
import type { RawPeriodData } from "../../types";
import {
  RECAST_LINE_CONCEPT_PREFIX,
  adaptLegacyRawPeriodsToFactSet,
  buildCapitalineCanonicalFactBundle,
  buildTextCanonicalFactBundle,
} from "../index";

const RAW: RawPeriodData[] = [
  {
    company_id: "ACME",
    period_end: "2024-03-31",
    currency_unit: "Crores",
    accounting_standard: "ind-as",
    raw_metric_values: {
      "Total Equity__BalanceSheet": 600,
      "Revenue From Operations__ProfitLoss": 900,
      "Net Cash From Operating Activities__CashFlow": 140,
    },
  },
  {
    company_id: "ACME",
    period_end: "2025-03-31",
    currency_unit: "Crores",
    accounting_standard: "ind-as",
    raw_metric_values: {
      "Total Equity__BalanceSheet": 680,
      "Revenue From Operations__ProfitLoss": 990,
      "Net Cash From Operating Activities__CashFlow": 155,
    },
  },
];

describe("production canonical source adapters", () => {
  it("hashes a text source and emits ontology-backed facts with honest nullable locators", async () => {
    const bundle = await buildTextCanonicalFactBundle({
      rawData: RAW,
      sourceText: JSON.stringify(RAW),
      sourceMode: "json",
      fileName: "acme.json",
      scope: "consolidated",
      contentClass: "confidential-financial-statements",
    });
    expect(bundle).not.toBeNull();
    expect(bundle!.sourceArtifacts[0]!.artifactId).toMatch(/^sha256:[0-9a-f]{64}$/);

    const result = await adaptLegacyRawPeriodsToFactSet({ rawData: RAW, ...bundle! });
    expect(result.status).toBe("created");
    expect(result.factSet?.facts.filter((fact) => !fact.conceptId.startsWith(RECAST_LINE_CONCEPT_PREFIX)).map((fact) => fact.conceptId)).toEqual([
      "equity", "revenue", "cfo", "equity", "revenue", "cfo",
    ]);
    // Beside them, a fact for each line the recast reads, so an upload's recast
    // can read its periods from the facts as a library run's does.
    expect(new Set(result.factSet?.facts.filter((fact) => fact.conceptId.startsWith(RECAST_LINE_CONCEPT_PREFIX)).map((fact) => fact.rawLabel))).toEqual(new Set([
      "Total Equity__BalanceSheet", "Revenue From Operations__ProfitLoss", "Net Cash From Operating Activities__CashFlow",
    ]));
    const revenue = result.factSet?.facts.find((fact) => fact.conceptId === "revenue");
    expect(revenue?.period.start).toBe("2023-04-01");
    expect(revenue?.origin).toMatchObject({ row: null, column: null, cellRange: null });
  });

  it("preserves the winning Capitaline file and one-based cell coordinate", async () => {
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    const debug = {
      companyId: "ACME",
      files: [],
      detectedPeriods: ["2024-03-31", "2025-03-31"],
      sourceArtifactHashes: [
        { fileName: "BalanceSheet.xls", sha256: hashA, byteLength: 100 },
        { fileName: "ProfitLoss.xls", sha256: hashB, byteLength: 120 },
      ],
      factOrigins: Object.fromEntries(RAW.map((raw, periodIndex) => [raw.period_end, {
        "Total Equity__BalanceSheet": { fileName: "BalanceSheet.xls", parserMethod: "xlsx", row: 7, column: periodIndex + 2 },
        "Revenue From Operations__ProfitLoss": { fileName: "ProfitLoss.xls", parserMethod: "html-dom", row: 9, column: periodIndex + 2 },
        "Net Cash From Operating Activities__CashFlow": { fileName: "ProfitLoss.xls", parserMethod: "html-dom", row: 11, column: periodIndex + 2 },
      }])),
      rawGrids: [],
      metrics: { totalCompositeKeys: 6, totalBaseKeys: 3, baseKeyCollisions: [], byStatement: { BalanceSheet: 2, ProfitLoss: 2, CashFlow: 2, Segment: 0, Unknown: 0 } },
      warnings: [],
      sample: { firstRows: [] },
      rawMetricKeys: [],
    } satisfies CapitalineParseDebug;
    const bundle = buildCapitalineCanonicalFactBundle({
      rawData: RAW,
      debug,
      scope: "consolidated",
      contentClass: "confidential-financial-statements",
    });
    const result = await adaptLegacyRawPeriodsToFactSet({ rawData: RAW, ...bundle! });
    expect(result.status).toBe("created");
    const revenue = result.factSet?.facts.find((fact) => fact.conceptId === "revenue" && fact.period.end === "2024-03-31");
    expect(revenue?.origin).toMatchObject({
      artifactId: `sha256:${hashB}`,
      parserMethod: "capitaline:html-dom",
      row: 9,
      column: 2,
    });
  });

  it("records a file the export carries twice as one artifact", async () => {
    // ITC's export has CashFlow_.xls at its root and again, byte for byte, in
    // `revised schd/`. Two artifacts with one content id blocked the fact set.
    const cashFlow = "c".repeat(64);
    const debug = {
      companyId: "ACME",
      files: [],
      detectedPeriods: RAW.map((period) => period.period_end),
      sourceArtifactHashes: [
        { fileName: "BalanceSheet.xls", sha256: "a".repeat(64), byteLength: 100 },
        { fileName: "ProfitLoss.xls", sha256: "b".repeat(64), byteLength: 120 },
        { fileName: "CashFlow.xls", sha256: cashFlow, byteLength: 90 },
        { fileName: "CashFlow.xls", sha256: cashFlow, byteLength: 90 },
        { fileName: "CashFlowCopy.xls", sha256: cashFlow, byteLength: 90 },
      ],
      factOrigins: Object.fromEntries(RAW.map((raw, periodIndex) => [raw.period_end, {
        "Total Equity__BalanceSheet": { fileName: "BalanceSheet.xls", parserMethod: "xlsx", row: 7, column: periodIndex + 2 },
        "Revenue From Operations__ProfitLoss": { fileName: "ProfitLoss.xls", parserMethod: "xlsx", row: 9, column: periodIndex + 2 },
        "Net Cash From Operating Activities__CashFlow": {
          fileName: periodIndex === 0 ? "CashFlow.xls" : "CashFlowCopy.xls",
          parserMethod: "xlsx",
          row: 11,
          column: periodIndex + 2,
        },
      }])),
      rawGrids: [],
      metrics: { totalCompositeKeys: 6, totalBaseKeys: 3, baseKeyCollisions: [], byStatement: { BalanceSheet: 2, ProfitLoss: 2, CashFlow: 2, Segment: 0, Unknown: 0 } },
      warnings: [],
      sample: { firstRows: [] },
      rawMetricKeys: [],
    } satisfies CapitalineParseDebug;
    const bundle = buildCapitalineCanonicalFactBundle({ rawData: RAW, debug, scope: "consolidated", contentClass: "confidential-financial-statements" });
    expect(bundle!.sourceArtifacts.map((artifact) => artifact.fileName)).toEqual(["BalanceSheet.xls", "ProfitLoss.xls", "CashFlow.xls"]);

    const result = await adaptLegacyRawPeriodsToFactSet({ rawData: RAW, ...bundle! });
    expect(result.status).toBe("created");
    // Either name resolves to the one artifact, so no origin is dropped.
    const cfo = result.factSet?.facts.filter((fact) => fact.conceptId === "cfo");
    expect(cfo?.map((fact) => (fact.origin.kind === "reported" ? fact.origin.artifactId : null))).toEqual([`sha256:${cashFlow}`, `sha256:${cashFlow}`]);
  });

  it("fails closed when a mapped Capitaline value has no artifact coordinate", async () => {
    const debug = {
      companyId: "ACME",
      files: [],
      detectedPeriods: RAW.map((period) => period.period_end),
      sourceArtifactHashes: [{ fileName: "BalanceSheet.xls", sha256: "c".repeat(64), byteLength: 100 }],
      factOrigins: Object.fromEntries(RAW.map((raw) => [raw.period_end, {
        "Total Equity__BalanceSheet": { fileName: "BalanceSheet.xls", parserMethod: "xlsx", row: 7, column: 2 },
      }])),
      rawGrids: [],
      metrics: { totalCompositeKeys: 2, totalBaseKeys: 1, baseKeyCollisions: [], byStatement: { BalanceSheet: 2, ProfitLoss: 0, CashFlow: 0, Segment: 0, Unknown: 0 } },
      warnings: [],
      sample: { firstRows: [] },
      rawMetricKeys: [],
    } satisfies CapitalineParseDebug;
    const bundle = buildCapitalineCanonicalFactBundle({ rawData: RAW, debug, scope: "consolidated", contentClass: "confidential" });
    const result = await adaptLegacyRawPeriodsToFactSet({ rawData: RAW, ...bundle! });
    expect(result.status).toBe("blocked");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "METRIC_ORIGIN_MISSING")).toBe(true);
  });
});
