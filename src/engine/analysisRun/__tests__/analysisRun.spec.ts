import { describe, expect, it } from "vitest";
import {
  ANALYSIS_RUN_SCHEMA_VERSION,
  canonicalizeAnalysisRunCore,
  createAnalysisRunV1,
  hashAnalysisRunCore,
  verifyAnalysisRunIdentity,
} from "../index";
import type {
  AnalysisContentKind,
  AnalysisRunCoreV1,
  AnalysisRunDraftV1,
  AnalysisRunV1,
  ContentRef,
  GateResult,
  Sha256ContentId,
  ValuationModelResult,
} from "../index";

function contentId(character: string): Sha256ContentId {
  return `sha256:${character.repeat(64).slice(0, 64)}` as Sha256ContentId;
}

function ref<TKind extends AnalysisContentKind>(
  kind: TKind,
  character: string,
): ContentRef<TKind> {
  return {
    kind,
    contentHash: contentId(character),
    mediaType: "application/json",
    byteLength: 100,
    schemaVersion: `${kind}-v1`,
  };
}

function gateResult(observed: number): GateResult {
  return {
    gateId: "syntactic-validity",
    gateVersion: "gate-v1",
    stage: "fact-extraction",
    status: "passed",
    blocksNext: false,
    evidenceRefs: [ref("evidence", "e")],
    checks: [
      {
        checkId: "parser-fidelity",
        label: "Parser fidelity",
        status: "passed",
        blocksGate: false,
        observed,
        threshold: 0.95,
        unit: "fraction",
        evidenceRefs: [ref("evidence", "e")],
        summary: "Parser fidelity clears the policy threshold.",
      },
    ],
    summary: "Syntactic validity passed.",
  };
}

function trustEnvelope(generatedAt: string, embeddedRunId: string): AnalysisRunCoreV1["trustEnvelope"] {
  return {
    schemaVersion: "2026-06-traceability-v20",
    generatedAt,
    runContext: {
      runId: embeddedRunId,
      companyId: "issuer-1",
      sourceMode: "json",
      periodCount: 5,
      latestPeriod: "2026-03-31",
    },
    confidence: {
      status: "guarded",
      headline: "Reviewer attention required",
      tone: "amber",
      blockingCount: 0,
      diagnosticCount: 1,
      optionalCount: 0,
    },
  } as unknown as AnalysisRunCoreV1["trustEnvelope"];
}

function draft(overrides: Partial<AnalysisRunDraftV1> = {}): AnalysisRunDraftV1 {
  return {
    schemaVersion: ANALYSIS_RUN_SCHEMA_VERSION,
    executorVersion: "executor-v1",
    derivationMode: "native",
    issuerId: "issuer-1",
    family: "industrial",
    asOf: "2026-03-31",
    status: "completed",
    sourceArtifactIds: [contentId("a")],
    factSetRef: ref("fact-set", "b"),
    policyBundleRef: ref("policy-bundle", "c"),
    modelCatalogRef: ref("model-catalog", "d"),
    familyAnalysisRef: ref("family-analysis", "e"),
    analysisWindowRef: ref("analysis-window", "f"),
    marketSnapshotRef: ref("market-snapshot", "1"),
    assumptionSetRef: ref("assumption-set", "2"),
    forecastCaseRefs: [ref("forecast-case", "3")],
    modelResultRefs: [ref("model-result", "4")],
    synthesisRef: ref("synthesis", "5"),
    stageResults: [
      {
        stageId: "fact-extraction",
        stageVersion: "stage-v1",
        sequence: 2,
        status: "completed",
        blocksNext: false,
        reasonCode: null,
        inputRefs: [ref("fact-set", "b")],
        outputRefs: [ref("fact-set", "b")],
        evidenceRefs: [ref("evidence", "e")],
        diagnosticRefs: [],
      },
    ],
    gateResults: [gateResult(0.3)],
    trustEnvelope: trustEnvelope("2026-07-10T08:00:00.000Z", "run-1"),
    publicationRef: ref("publication", "6"),
    runId: "run-1",
    relation: {
      kind: "root",
      parentRunId: null,
      parentReproducibilityHash: null,
    },
    createdAt: "2026-07-10T08:00:01.000Z",
    ...overrides,
  };
}

describe("AnalysisRunV1 canonical identity", () => {
  it("is stable across object key insertion order", async () => {
    const normal = draft();
    const reorderedFactSetRef = {
      schemaVersion: normal.factSetRef.schemaVersion,
      byteLength: normal.factSetRef.byteLength,
      mediaType: normal.factSetRef.mediaType,
      contentHash: normal.factSetRef.contentHash,
      kind: normal.factSetRef.kind,
    } satisfies ContentRef<"fact-set">;
    const reordered = draft({ factSetRef: reorderedFactSetRef });

    expect(canonicalizeAnalysisRunCore(normal)).toBe(canonicalizeAnalysisRunCore(reordered));
    expect(await hashAnalysisRunCore(normal)).toBe(await hashAnalysisRunCore(reordered));
  });

  it("uses the repository numeric normalization for stable floating-point identity", async () => {
    const floatingPoint = draft({ gateResults: [gateResult(0.1 + 0.2)] });
    const exactDecimal = draft({ gateResults: [gateResult(0.3)] });

    expect(await hashAnalysisRunCore(floatingPoint)).toBe(await hashAnalysisRunCore(exactDecimal));
  });

  it("changes identity when stable analytical content changes", async () => {
    const original = draft();
    const changed = draft({ assumptionSetRef: ref("assumption-set", "9") });

    expect(await hashAnalysisRunCore(original)).not.toBe(await hashAnalysisRunCore(changed));
  });

  it("excludes volatile instance, lineage, and envelope-generation metadata", async () => {
    const root = draft();
    const child = draft({
      runId: "run-2",
      createdAt: "2026-07-11T10:30:00.000Z",
      relation: {
        kind: "child",
        parentRunId: "run-parent",
        parentReproducibilityHash: contentId("8"),
        forkReason: "manual-rerun",
      },
      trustEnvelope: trustEnvelope("2026-07-11T10:29:59.000Z", "run-2"),
    });

    expect(await hashAnalysisRunCore(root)).toBe(await hashAnalysisRunCore(child));
  });

  it("finalizes a deeply immutable run without self-referential hash input", async () => {
    const input = draft();
    const run = await createAnalysisRunV1(input);
    const canonicalCore = canonicalizeAnalysisRunCore(run);

    expect(run.reproducibilityHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(canonicalCore).not.toContain("reproducibilityHash");
    expect(canonicalCore).not.toContain(run.runId);
    expect(canonicalCore).not.toContain(run.createdAt);
    expect(canonicalCore).not.toContain(input.trustEnvelope.generatedAt!);
    expect(await verifyAnalysisRunIdentity(run)).toBe(true);
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.stageResults)).toBe(true);
    expect(Object.isFrozen(run.trustEnvelope.runContext)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);

    const tampered = { ...run, asOf: "2025-03-31" } as AnalysisRunV1;
    expect(await verifyAnalysisRunIdentity(tampered)).toBe(false);
  });
});

describe("ValuationModelResult states", () => {
  it("keeps computed, non-computed, and invalid outcomes distinct", () => {
    const common = {
      modelId: "cash-fcff",
      modelVersion: "model-v1",
      category: "intrinsic" as const,
      independenceGroup: "cash-statement",
      caseId: "base",
    };
    const results: readonly ValuationModelResult[] = [
      {
        ...common,
        status: "computed",
        enterpriseValue: 1_000,
        equityValue: 900,
        perShare: 90,
        unit: "INR_PER_SHARE",
        evidenceRefs: [],
        transformationRefs: [],
        diagnostics: {},
        guardResults: [],
      },
      {
        ...common,
        status: "insufficient-evidence",
        reasonCode: "FCF_WINDOW_TOO_SHORT",
        missingRequirements: [],
      },
      {
        ...common,
        status: "invalid",
        reasonCode: "TERMINAL_SPREAD_INVALID",
        failedGuards: [],
      },
    ];

    expect(results.map((result) => result.status)).toEqual([
      "computed",
      "insufficient-evidence",
      "invalid",
    ]);
  });
});
