import { describe, expect, it } from "vitest";
import type { RawPeriodData } from "../../types";
import {
  adaptLegacyRawPeriodsToFactSet,
  createTransformationDag,
  createTransformationNode,
  type LegacyConceptMapping,
  type SourceArtifact,
} from "../index";

const artifactId = `sha256:${"a".repeat(64)}` as const;
const artifact: SourceArtifact = {
  artifactId,
  fileName: "filing.json",
  mediaType: "application/json",
  byteLength: 100,
  sourceMode: "json",
  acquiredAt: "2026-07-10T00:00:00.000Z",
  filingAsOf: "2025-03-31",
  issuerId: "issuer-1",
  scope: "consolidated",
  parserVersion: "legacy-adapter-test-v1",
  contentClass: "financial-statements",
};
const mapping: LegacyConceptMapping = {
  rawLabel: "Total Assets__BalanceSheet",
  conceptId: "total-assets",
  statement: "BS",
  periodKind: "instant",
  normalizedUnit: "INR_CRORE",
  storedScale: "crore",
  currency: "INR",
};

function raw(currency_unit: RawPeriodData["currency_unit"] = "Lakhs"): RawPeriodData {
  return {
    company_id: "issuer-1",
    period_end: "2025-03-31",
    currency_unit,
    accounting_standard: "ind-as",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1_000,
      "Unmapped Value__BalanceSheet": 500,
    },
  };
}

describe("legacy RawPeriodData fact adapter", () => {
  it("emits only explicitly mapped facts and never fabricates source coordinates", async () => {
    const result = await adaptLegacyRawPeriodsToFactSet({
      rawData: [raw()],
      sourceArtifacts: [artifact],
      periodSources: {
        "2025-03-31": {
          kind: "reported",
          artifactId,
          filingVersion: "original",
          scope: "consolidated",
          accountingStandard: "ind-as",
          durationStart: null,
        },
      },
      conceptMappings: [mapping],
    });
    expect(result.status).toBe("created");
    expect(result.factSet?.facts).toHaveLength(1);
    expect(result.factSet?.facts[0]).toEqual(expect.objectContaining({ conceptId: "total-assets", rawLabel: mapping.rawLabel }));
    expect(result.factSet?.facts[0]?.origin).toEqual(expect.objectContaining({
      sheet: null,
      row: null,
      column: null,
      cellRange: null,
      xbrlContextId: null,
    }));
    expect(result.unitTrace[0]).toEqual(expect.objectContaining({
      originalCurrencyUnit: "Lakhs",
      upstreamMultiplierToCrore: 0.01,
      status: "declared",
    }));
  });

  it("fails closed when the declared artifact is absent", async () => {
    const result = await adaptLegacyRawPeriodsToFactSet({
      rawData: [raw()],
      sourceArtifacts: [],
      periodSources: {
        "2025-03-31": {
          kind: "reported",
          artifactId,
          filingVersion: "original",
          scope: "consolidated",
          accountingStandard: "ind-as",
          durationStart: null,
        },
      },
      conceptMappings: [mapping],
    });
    expect(result.status).toBe("blocked");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("SOURCE_ARTIFACT_MISSING");
  });

  it("records source-unavailable periods without inventing a fact", async () => {
    const result = await adaptLegacyRawPeriodsToFactSet({
      rawData: [raw("Unknown")],
      sourceArtifacts: [artifact],
      periodSources: { "2025-03-31": { kind: "source-unavailable", reason: "Original filing was not retained." } },
      conceptMappings: [mapping],
    });
    expect(result.status).toBe("blocked");
    expect(result.factSet).toBeNull();
    expect(result.diagnostics[0]).toEqual(expect.objectContaining({ code: "SOURCE_UNAVAILABLE" }));
    expect(result.unitTrace[0]).toEqual(expect.objectContaining({ status: "unknown", upstreamMultiplierToCrore: null }));
  });
});

describe("transformation DAG", () => {
  const core = (inputFactIds: string[], outputFactIds: string[]) => ({
    transformationId: `transform-${outputFactIds.join("-")}`,
    functionId: "recast.total-assets",
    functionVersion: "1.0.0",
    inputFactIds,
    outputFactIds,
    policyRefs: ["policy-v1"],
    evidenceRefs: [],
    parameters: {},
  });

  it("has deterministic DAG identity while preserving semantic input order in node identity", async () => {
    const first = await createTransformationNode(core(["root-a", "root-b"], ["derived-a"]));
    const second = await createTransformationNode(core(["derived-a"], ["derived-b"]));
    const swappedInputs = await createTransformationNode(core(["root-b", "root-a"], ["derived-a"]));
    expect(swappedInputs.nodeId).not.toBe(first.nodeId);
    const left = await createTransformationDag({ rootFactIds: ["root-b", "root-a"], nodes: [first, second] });
    const right = await createTransformationDag({ rootFactIds: ["root-a", "root-b"], nodes: [second, first] });
    expect(left.ok && right.ok && left.value.dagId).toBe(right.ok ? right.value.dagId : null);
  });

  it("rejects missing inputs and cycles", async () => {
    const missing = await createTransformationNode(core(["not-a-root"], ["derived"]));
    const missingDag = await createTransformationDag({ rootFactIds: [], nodes: [missing] });
    expect(missingDag.ok).toBe(false);
    if (missingDag.ok === false) expect(missingDag.errors.map((error) => error.code)).toContain("MISSING_INPUT");

    const a = await createTransformationNode(core(["fact-b"], ["fact-a"]));
    const b = await createTransformationNode(core(["fact-a"], ["fact-b"]));
    const cycle = await createTransformationDag({ rootFactIds: [], nodes: [a, b] });
    expect(cycle.ok).toBe(false);
    if (cycle.ok === false) expect(cycle.errors.map((error) => error.code)).toContain("CYCLE");
  });
});
