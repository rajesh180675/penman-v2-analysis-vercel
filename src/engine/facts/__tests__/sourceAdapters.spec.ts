import { describe, expect, it } from "vitest";
import type { CapitalineParseDebug } from "../../capitalineParser";
import type { RawPeriodData } from "../../types";
import {
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
    expect(result.factSet?.facts.map((fact) => fact.conceptId)).toEqual([
      "equity", "revenue", "cfo", "equity", "revenue", "cfo",
    ]);
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
