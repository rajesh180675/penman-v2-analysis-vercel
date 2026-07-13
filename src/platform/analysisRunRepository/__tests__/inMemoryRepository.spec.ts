import { describe, expect, it } from "vitest";
import {
  ANALYSIS_RUN_SCHEMA_VERSION,
  verifyAnalysisRunIdentity,
  type AnalysisRunDraftV1,
  type ContentRef,
} from "../../../engine/analysisRun";
import { createLocalWorkspaceAccessContext } from "../../workspaceScope";
import {
  AnalysisRunRepositoryError,
  createInMemoryAnalysisRunRepository,
} from "..";

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

function ref<TKind extends ContentRef["kind"]>(kind: TKind, character: string): ContentRef<TKind> {
  return {
    kind,
    contentHash: hash(character),
    mediaType: "application/json",
    byteLength: 10,
    schemaVersion: "fixture-v1",
  };
}

function draft(
  runId: string,
  createdAt: string,
  issuerId = "issuer-1",
): AnalysisRunDraftV1 {
  return {
    schemaVersion: ANALYSIS_RUN_SCHEMA_VERSION,
    executorVersion: "repository-fixture-v1",
    derivationMode: "native",
    issuerId,
    family: "industrial",
    asOf: "2026-03-31",
    status: "completed",
    sourceArtifactIds: [],
    factSetRef: ref("fact-set", "a"),
    policyBundleRef: ref("policy-bundle", "b"),
    modelCatalogRef: ref("model-catalog", "c"),
    familyAnalysisRef: null,
    analysisWindowRef: null,
    marketSnapshotRef: null,
    assumptionSetRef: null,
    forecastCaseRefs: [],
    modelResultRefs: [],
    synthesisRef: null,
    stageResults: [],
    gateResults: [],
    trustEnvelope: {
      schemaVersion: "2026-06-traceability-v20",
      generatedAt: createdAt,
      runContext: {
        runId,
        companyId: issuerId,
        sourceMode: "fixture",
        periodCount: 2,
        latestPeriod: "2026-03-31",
      },
      confidence: {
        status: "production-ready",
        headline: "Fixture run is ready.",
        tone: "emerald",
        blockingCount: 0,
        diagnosticCount: 0,
        optionalCount: 0,
      },
    } as AnalysisRunDraftV1["trustEnvelope"],
    publicationRef: null,
    runId,
    relation: { kind: "root", parentRunId: null, parentReproducibilityHash: null },
    createdAt,
  };
}

function expectRepositoryError(error: unknown, code: AnalysisRunRepositoryError["code"]): boolean {
  expect(error).toBeInstanceOf(AnalysisRunRepositoryError);
  expect((error as AnalysisRunRepositoryError).code).toBe(code);
  return true;
}

describe("in-memory AnalysisRun repository", () => {
  it("creates immutable content once and replays the same idempotent request", async () => {
    const repository = createInMemoryAnalysisRunRepository();
    const context = createLocalWorkspaceAccessContext("analyst-1", "workspace-a");
    const first = await repository.create(context, draft("run-1", "2026-07-11T10:00:00.000Z"), "create:run-1");
    const replay = await repository.create(context, draft("run-1", "2026-07-11T10:00:00.000Z"), "create:run-1");

    expect(replay).toBe(first);
    expect(first).toMatchObject({ lifecycle: "open", revision: 1 });
    expect(Object.isFrozen(first.run)).toBe(true);
    expect(Object.isFrozen(first.run.trustEnvelope)).toBe(true);
    expect(await verifyAnalysisRunIdentity(first.run)).toBe(true);
  });

  it("isolates workspace partitions and binds pagination cursors to scope and filters", async () => {
    const repository = createInMemoryAnalysisRunRepository();
    const workspaceA = createLocalWorkspaceAccessContext("analyst-1", "workspace-a");
    const workspaceB = createLocalWorkspaceAccessContext("analyst-1", "workspace-b");
    await repository.create(workspaceA, draft("run-1", "2026-07-11T10:00:00.000Z"), "create:1");
    await repository.create(workspaceA, draft("run-2", "2026-07-11T11:00:00.000Z"), "create:2");
    await repository.create(workspaceA, draft("run-3", "2026-07-11T12:00:00.000Z", "issuer-2"), "create:3");

    expect(await repository.get(workspaceB.scope, "run-1")).toBeNull();
    expect((await repository.list(workspaceB.scope)).items).toEqual([]);
    const firstPage = await repository.list(workspaceA.scope, { limit: 1, issuerId: "issuer-1" });
    expect(firstPage.items.map((item) => item.runId)).toEqual(["run-2"]);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await repository.list(workspaceA.scope, {
      limit: 1,
      issuerId: "issuer-1",
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.items.map((item) => item.runId)).toEqual(["run-1"]);
    await expect(repository.list(workspaceB.scope, { limit: 1, issuerId: "issuer-1", cursor: firstPage.nextCursor }))
      .rejects.toSatisfy((error) => expectRepositoryError(error, "INVALID_CURSOR"));
  });

  it("uses compare-and-swap revisions for finalization and rejects idempotency reuse", async () => {
    const repository = createInMemoryAnalysisRunRepository();
    const context = createLocalWorkspaceAccessContext("analyst-1", "workspace-a");
    await repository.create(context, draft("run-1", "2026-07-11T10:00:00.000Z"), "create:run-1");

    await expect(repository.create(
      context,
      draft("run-2", "2026-07-11T11:00:00.000Z"),
      "create:run-1",
    )).rejects.toSatisfy((error) => expectRepositoryError(error, "IDEMPOTENCY_KEY_REUSED"));

    const finalized = await repository.finalize(context, "run-1", 1);
    expect(finalized).toMatchObject({ lifecycle: "finalized", revision: 2 });
    await expect(repository.finalize(context, "run-1", 1))
      .rejects.toSatisfy((error) => expectRepositoryError(error, "REVISION_CONFLICT"));
    expect(await repository.finalize(context, "run-1", 2)).toBe(finalized);
  });
});
