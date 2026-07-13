import { describe, expect, it } from "vitest";
import {
  ANALYSIS_RUN_SCHEMA_VERSION,
  createAnalysisContentArtifact,
  createAnalysisRunV1,
  type AnalysisContentKind,
  type AnalysisRunDraftV1,
  type ContentRef,
  type LegacyAnalysisRunExecutionResult,
  type LegacyAnalysisRunMaterializationV1,
  type Sha256ContentId,
} from "../../../engine/analysisRun";
import { AnalysisRunStore, createChildRunRelation } from "../index";

type CompletedExecution = Extract<LegacyAnalysisRunExecutionResult, { status: "completed" }>;

function hash(character: string): Sha256ContentId {
  return `sha256:${character.repeat(64).slice(0, 64)}` as Sha256ContentId;
}

function ref<TKind extends AnalysisContentKind>(kind: TKind, character: string): ContentRef<TKind> {
  return { kind, contentHash: hash(character), mediaType: "application/json", byteLength: 10, schemaVersion: `${kind}-v1` };
}

async function run(
  runId: string,
  overrides: Partial<AnalysisRunDraftV1> = {},
) {
  return createAnalysisRunV1({
    schemaVersion: ANALYSIS_RUN_SCHEMA_VERSION,
    executorVersion: "test-executor-v1",
    derivationMode: "legacy-derived",
    issuerId: "issuer-1",
    family: "industrial",
    asOf: "2026-03-31",
    status: "completed",
    sourceArtifactIds: [hash("a")],
    factSetRef: ref("fact-set", "b"),
    policyBundleRef: ref("policy-bundle", "c"),
    modelCatalogRef: ref("model-catalog", "d"),
    familyAnalysisRef: ref("family-analysis", "e"),
    analysisWindowRef: ref("analysis-window", "f"),
    marketSnapshotRef: null,
    assumptionSetRef: ref("assumption-set", "1"),
    forecastCaseRefs: [],
    modelResultRefs: [],
    synthesisRef: null,
    stageResults: [],
    gateResults: [],
    trustEnvelope: {
      schemaVersion: "2026-06-traceability-v20",
      generatedAt: "2026-07-10T00:00:00.000Z",
      runContext: { runId, companyId: "issuer-1", sourceMode: "json", periodCount: 2, latestPeriod: "2026-03-31" },
      confidence: { status: "production-ready", tone: "emerald", headline: "Ready", blockingCount: 0, diagnosticCount: 0, optionalCount: 0 },
    } as AnalysisRunDraftV1["trustEnvelope"],
    publicationRef: null,
    runId,
    relation: { kind: "root", parentRunId: null, parentReproducibilityHash: null },
    createdAt: "2026-07-10T00:00:01.000Z",
    ...overrides,
  });
}

function materialization(label: string): LegacyAnalysisRunMaterializationV1 {
  return {
    pipelineResult: { periods: [{ period_end: "2026-03-31" }] },
    commandCenter: { label },
    modelResults: [],
  } as unknown as LegacyAnalysisRunMaterializationV1;
}

async function result(runId: string): Promise<CompletedExecution> {
  const required = await Promise.all([
    createAnalysisContentArtifact({ kind: "fact-set", schemaVersion: "fact-set-v1", payload: { fixture: "facts" } }),
    createAnalysisContentArtifact({ kind: "policy-bundle", schemaVersion: "policy-bundle-v1", payload: { fixture: "policy" } }),
    createAnalysisContentArtifact({ kind: "model-catalog", schemaVersion: "model-catalog-v1", payload: { fixture: "catalog" } }),
    createAnalysisContentArtifact({ kind: "family-analysis", schemaVersion: "family-analysis-v1", payload: { fixture: "family" } }),
    createAnalysisContentArtifact({ kind: "analysis-window", schemaVersion: "analysis-window-v1", payload: { fixture: "window" } }),
    createAnalysisContentArtifact({ kind: "assumption-set", schemaVersion: "assumption-set-v1", payload: { fixture: "assumptions" } }),
  ] as const);
  const finalized = await run(runId, {
    factSetRef: required[0].ref,
    policyBundleRef: required[1].ref,
    modelCatalogRef: required[2].ref,
    familyAnalysisRef: required[3].ref,
    analysisWindowRef: required[4].ref,
    assumptionSetRef: required[5].ref,
  });
  const artifact = await createAnalysisContentArtifact({ kind: "diagnostic", schemaVersion: "test-v1", payload: { runId } });
  return {
    status: "completed",
    run: finalized,
    artifacts: [...required, artifact],
    diagnostics: [],
    materialization: materialization(runId),
  };
}

describe("AnalysisRunStore", () => {
  it("stores one immutable run and all selectors resolve the same run-scoped materialization", async () => {
    const store = new AnalysisRunStore();
    const execution = await result("run-1");
    await store.addExecution(execution, { makeCurrent: true });
    expect(store.getCurrent()?.run.runId).toBe("run-1");
    expect(store.selectCommandCenter()).toBe(store.selectCommandCenter("run-1"));
    expect(store.selectRecastData()).toHaveLength(1);
    expect(store.selectTrustEnvelope()?.runContext.runId).toBe("run-1");
    expect(Object.isFrozen(store.get("run-1")?.materialization)).toBe(true);
    const artifact = execution.artifacts[0]!;
    expect(store.selectArtifact(artifact.ref.contentHash)?.ref.contentHash).toBe(artifact.ref.contentHash);
    expect(await store.getPersistedRun("run-1")).toMatchObject({ lifecycle: "finalized", revision: 2 });
    expect((await store.listAuditEvents("run-1")).map((event) => event.eventType)).toEqual([
      "run-created",
      "run-finalized",
    ]);
  });

  it("rejects tampered content and a valid second meaning for an existing run id", async () => {
    const store = new AnalysisRunStore();
    const original = await result("run-1");
    await store.addExecution(original);
    const tampered = {
      ...original,
      run: { ...original.run, asOf: "2025-03-31" },
    } as LegacyAnalysisRunExecutionResult;
    await expect(store.addExecution(tampered)).rejects.toThrow(/hash verification/i);

    const different = await run("run-1", { asOf: "2024-03-31" });
    await expect(store.addExecution({ ...original, run: different })).rejects.toThrow(/immutable/i);
  });

  it("indexes analytically identical child runs by hash and creates an explicit fork relation", async () => {
    const store = new AnalysisRunStore();
    const parentResult = await result("parent");
    await store.addExecution(parentResult);
    const relation = createChildRunRelation(parentResult.run, "assumption-change");
    const child = await run("child", {
      relation,
      factSetRef: parentResult.run.factSetRef,
      policyBundleRef: parentResult.run.policyBundleRef,
      modelCatalogRef: parentResult.run.modelCatalogRef,
      familyAnalysisRef: parentResult.run.familyAnalysisRef,
      analysisWindowRef: parentResult.run.analysisWindowRef,
      assumptionSetRef: parentResult.run.assumptionSetRef,
      createdAt: "2026-07-11T00:00:00.000Z",
      trustEnvelope: {
        ...parentResult.run.trustEnvelope,
        generatedAt: "2026-07-11T00:00:00.000Z",
        runContext: { ...parentResult.run.trustEnvelope.runContext, runId: "child" },
      },
    });
    await store.addExecution({ ...parentResult, run: child, materialization: materialization("child") });
    expect(child.reproducibilityHash).toBe(parentResult.run.reproducibilityHash);
    expect(store.findByHash(child.reproducibilityHash)).toHaveLength(2);
    expect(relation).toEqual(expect.objectContaining({ kind: "child", parentRunId: "parent" }));
  });

  it("fails closed when a run references an artifact that was not persisted", async () => {
    const store = new AnalysisRunStore();
    const execution = await result("missing-ref");
    await expect(store.addExecution({ ...execution, artifacts: execution.artifacts.filter((artifact) => artifact.ref.kind !== "fact-set") }))
      .rejects.toThrow(/missing or corrupt/i);
  });
});
