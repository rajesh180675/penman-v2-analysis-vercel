import type { AnalysisRunDraftV1, ContentRef } from "../engine/analysisRun/contracts";
import type { VersionedAnalysisRun } from "./analysisRunRepository";
import type { RunAuditEventDraft, RunLockRecord } from "./runOperations";
import type { WorkspaceAccessContext } from "./workspaceScope";

export interface AtomicRunLifecycleCoordinator {
  createRunAndAppendEvent(input: {
    readonly context: WorkspaceAccessContext;
    readonly draft: AnalysisRunDraftV1;
    readonly runIdempotencyKey: string;
    readonly event: RunAuditEventDraft;
    readonly eventIdempotencyKey: string;
  }): Promise<VersionedAnalysisRun>;
  finalizeRunAndAppendEvent(input: {
    readonly context: WorkspaceAccessContext;
    readonly runId: string;
    readonly expectedRevision: number;
    readonly event: Omit<RunAuditEventDraft, "runRevision">;
    readonly eventIdempotencyKey: string;
  }): Promise<VersionedAnalysisRun>;
  lockRunAndAppendEvent(input: {
    readonly context: WorkspaceAccessContext;
    readonly lock: Omit<RunLockRecord, "principalId" | "lockRevision">;
    readonly refs: readonly ContentRef[];
    readonly holdId: string;
    readonly event: RunAuditEventDraft;
    readonly eventIdempotencyKey: string;
  }): Promise<RunLockRecord>;
}
