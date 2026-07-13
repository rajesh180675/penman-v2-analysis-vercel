import type { AnalysisRunDraftV1, AnalysisRunV1, ContentRef } from "../engine/analysisRun/contracts";
import { reproducibilityHash } from "../lib/evidenceLocking";
import type { ArtifactMetadata, ArtifactPayload, ArtifactRepository } from "./artifactRepository";
import type { AnalysisRunRepository, RunQuery } from "./analysisRunRepository";
import { parseIdempotencyKey } from "./analysisRunRepository/validation";
import type { RunOperationsRepository } from "./runOperations";
import { parsePlatformIdentifier, type WorkspaceAccessContext } from "./workspaceScope";
import type { PlatformSecurityBoundary, WorkspacePermission } from "./security";
import type { AtomicRunLifecycleCoordinator } from "./atomicRunLifecycle";

export const ANALYSIS_PLATFORM_SERVICE_VERSION = "2026-07-analysis-platform-service-v1" as const;

export interface OperationStamp {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface RunGovernanceAdmissionVerifier {
  verify(
    context: WorkspaceAccessContext,
    run: AnalysisRunDraftV1 | AnalysisRunV1,
    artifacts: readonly ArtifactPayload[],
  ): Promise<void>;
}

export class AnalysisPlatformServiceError extends Error {
  constructor(
    readonly code: "RUN_NOT_FOUND" | "RUN_NOT_FINALIZED" | "RUN_REVISION_MISMATCH" | "RUN_REFERENCE_MISSING" | "RUN_REFERENCE_ISSUER_MISMATCH" | "OPERATION_STAMP_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "AnalysisPlatformServiceError";
  }
}

/**
 * Versioned application service shared by local adapters and future HTTP
 * handlers. Authentication remains a server boundary concern; every method
 * requires an already established workspace access context.
 */
export class AnalysisPlatformServiceV1 {
  constructor(
    private readonly runs: AnalysisRunRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly operations: RunOperationsRepository,
    private readonly security: PlatformSecurityBoundary,
    private readonly atomicLifecycle: AtomicRunLifecycleCoordinator | null = null,
    private readonly governanceAdmission: RunGovernanceAdmissionVerifier | null = null,
  ) {}

  private async authorize(context: WorkspaceAccessContext, permission: WorkspacePermission): Promise<void> {
    await this.security.authorize(context, permission);
  }

  private async prepareStamp(stamp: OperationStamp): Promise<OperationStamp & { readonly eventIdempotencyKey: string }> {
    try {
      const eventId = parsePlatformIdentifier(stamp.eventId, "stamp.eventId");
      const correlationId = parsePlatformIdentifier(stamp.correlationId, "stamp.correlationId");
      const idempotencyKey = parseIdempotencyKey(stamp.idempotencyKey);
      if (!/^\d{4}-\d{2}-\d{2}T/.test(stamp.occurredAt) || !Number.isFinite(Date.parse(stamp.occurredAt))) throw new Error("invalid occurredAt");
      const digest = await reproducibilityHash({ idempotencyKey, operation: "audit-event" });
      return Object.freeze({ ...stamp, eventId, correlationId, idempotencyKey, eventIdempotencyKey: parsePlatformIdentifier(`event:${digest}`, "stamp.eventIdempotencyKey") });
    } catch (error) {
      if (error instanceof AnalysisPlatformServiceError) throw error;
      throw new AnalysisPlatformServiceError("OPERATION_STAMP_INVALID", error instanceof Error ? error.message : "The operation stamp is invalid.");
    }
  }

  private referencedArtifacts(run: AnalysisRunDraftV1 | AnalysisRunV1): readonly ContentRef[] {
    const refs: ContentRef[] = [run.factSetRef, run.policyBundleRef, run.modelCatalogRef];
    for (const ref of [run.familyAnalysisRef, run.analysisWindowRef, run.marketSnapshotRef, run.assumptionSetRef, run.synthesisRef, run.publicationRef]) if (ref) refs.push(ref);
    refs.push(...run.forecastCaseRefs, ...run.modelResultRefs);
    for (const stage of run.stageResults) refs.push(...stage.inputRefs, ...stage.outputRefs, ...stage.evidenceRefs, ...stage.diagnosticRefs);
    for (const gate of run.gateResults) {
      refs.push(...gate.evidenceRefs);
      for (const check of gate.checks) refs.push(...check.evidenceRefs);
    }
    const unique = new Map(refs.map((ref) => [`${ref.kind}:${ref.contentHash}:${ref.schemaVersion}:${ref.mediaType}:${ref.byteLength}`, ref]));
    return Object.freeze([...unique.values()]);
  }

  private async verifyReferenceClosure(context: WorkspaceAccessContext, run: AnalysisRunDraftV1 | AnalysisRunV1): Promise<void> {
    const artifacts: ArtifactPayload[] = [];
    for (const ref of this.referencedArtifacts(run)) {
      const artifact = await this.artifacts.get(context.scope, ref);
      if (!artifact) throw new AnalysisPlatformServiceError("RUN_REFERENCE_MISSING", `Referenced artifact '${ref.contentHash}' is missing or corrupt.`);
      if (artifact.metadata.issuerId !== null && artifact.metadata.issuerId !== run.issuerId) {
        throw new AnalysisPlatformServiceError("RUN_REFERENCE_ISSUER_MISMATCH", `Referenced artifact '${ref.contentHash}' belongs to another issuer.`);
      }
      artifacts.push(artifact);
    }
    if (this.governanceAdmission) await this.governanceAdmission.verify(context, run, artifacts);
  }

  async createRun(context: WorkspaceAccessContext, draft: AnalysisRunDraftV1, stamp: OperationStamp) {
    await this.authorize(context, "run:create");
    const prepared = await this.prepareStamp(stamp);
    await this.verifyReferenceClosure(context, draft);
    const event = {
      eventId: prepared.eventId, runId: draft.runId, runRevision: 1, eventType: "run-created" as const,
      occurredAt: prepared.occurredAt, correlationId: prepared.correlationId, payloadRef: null,
    };
    if (this.atomicLifecycle) return this.atomicLifecycle.createRunAndAppendEvent({
      context, draft, runIdempotencyKey: prepared.idempotencyKey, event, eventIdempotencyKey: prepared.eventIdempotencyKey,
    });
    const versioned = await this.runs.create(context, draft, prepared.idempotencyKey);
    await this.operations.appendEvent(context, {
      ...event,
      runId: versioned.run.runId,
      runRevision: versioned.revision,
    }, prepared.eventIdempotencyKey);
    return versioned;
  }

  async getRun(context: WorkspaceAccessContext, runId: string) {
    await this.authorize(context, "run:read");
    return this.runs.get(context.scope, runId);
  }

  async listRuns(context: WorkspaceAccessContext, query?: RunQuery) {
    await this.authorize(context, "run:read");
    return this.runs.list(context.scope, query);
  }

  async listRunEvents(
    context: WorkspaceAccessContext,
    runId: string,
    options?: { readonly afterSequence?: number | undefined; readonly limit?: number | undefined },
  ) {
    await this.authorize(context, "run:read");
    return this.operations.listEvents(context.scope, runId, options);
  }

  async finalizeRun(
    context: WorkspaceAccessContext,
    runId: string,
    expectedRevision: number,
    stamp: OperationStamp,
  ) {
    await this.authorize(context, "run:finalize");
    const prepared = await this.prepareStamp(stamp);
    const current = await this.runs.get(context.scope, runId);
    if (!current) throw new AnalysisPlatformServiceError("RUN_NOT_FOUND", "The analysis run was not found.");
    await this.verifyReferenceClosure(context, current.run);
    const event = { eventId: prepared.eventId, runId, eventType: "run-finalized" as const, occurredAt: prepared.occurredAt, correlationId: prepared.correlationId, payloadRef: null };
    if (this.atomicLifecycle) return this.atomicLifecycle.finalizeRunAndAppendEvent({ context, runId, expectedRevision, event, eventIdempotencyKey: prepared.eventIdempotencyKey });
    const versioned = current.lifecycle === "finalized" && current.revision === expectedRevision + 1
      ? current
      : await this.runs.finalize(context, runId, expectedRevision);
    await this.operations.appendEvent(context, {
      ...event,
      runRevision: versioned.revision,
    }, prepared.eventIdempotencyKey);
    return versioned;
  }

  async lockRun(
    context: WorkspaceAccessContext,
    input: {
      readonly runId: string;
      readonly expectedRevision: number;
      readonly lockId: string;
      readonly reason: string;
      readonly stamp: OperationStamp;
    },
  ) {
    await this.authorize(context, "publication:lock");
    const prepared = await this.prepareStamp(input.stamp);
    const run = await this.runs.get(context.scope, input.runId);
    if (!run) throw new AnalysisPlatformServiceError("RUN_NOT_FOUND", "The analysis run was not found.");
    if (run.lifecycle !== "finalized") {
      throw new AnalysisPlatformServiceError("RUN_NOT_FINALIZED", "Only a finalized analysis run can be locked.");
    }
    if (run.revision !== input.expectedRevision) {
      throw new AnalysisPlatformServiceError("RUN_REVISION_MISMATCH", "The lock revision does not match the finalized run revision.");
    }
    await this.verifyReferenceClosure(context, run.run);
    const refs = this.referencedArtifacts(run.run);
    const holdId = `run-lock:${input.lockId}`;
    const lockDraft = { lockId: input.lockId, runId: input.runId, runRevision: run.revision, reason: input.reason, lockedAt: prepared.occurredAt };
    const event = { eventId: prepared.eventId, runId: input.runId, runRevision: run.revision, eventType: "run-locked" as const, occurredAt: prepared.occurredAt, correlationId: prepared.correlationId, payloadRef: null };
    if (this.atomicLifecycle) return this.atomicLifecycle.lockRunAndAppendEvent({ context, lock: lockDraft, refs, holdId, event, eventIdempotencyKey: prepared.eventIdempotencyKey });
    await this.artifacts.applyRetentionHold(context, refs, holdId);
    const lock = await this.operations.lockRun(context, {
      ...lockDraft,
    });
    await this.operations.appendEvent(context, {
      ...event,
    }, prepared.eventIdempotencyKey);
    return lock;
  }

  async putArtifact<TKind extends ArtifactMetadata["kind"]>(
    context: WorkspaceAccessContext,
    bytes: Uint8Array,
    metadata: ArtifactMetadata<TKind>,
  ) {
    await this.authorize(context, "artifact:write");
    return this.artifacts.put(context, bytes, metadata);
  }

  async getArtifact(context: WorkspaceAccessContext, ref: Parameters<ArtifactRepository["get"]>[1]) {
    await this.authorize(context, "artifact:read");
    return this.artifacts.get(context.scope, ref);
  }
}
