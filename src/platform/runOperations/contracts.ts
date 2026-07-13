import type { ContentRef, Sha256ContentId } from "../../engine/analysisRun";
import type { WorkspaceAccessContext, WorkspaceScope } from "../workspaceScope";

export type RunAuditEventType =
  | "run-created"
  | "run-finalized"
  | "scenario-forked"
  | "publication-created"
  | "run-locked"
  | "retention-changed"
  | "artifact-purged";

export interface RunAuditEventDraft {
  readonly eventId: string;
  readonly runId: string;
  readonly runRevision: number;
  readonly eventType: RunAuditEventType;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly payloadRef: ContentRef | null;
}

export interface RunAuditEvent extends RunAuditEventDraft {
  readonly actorPrincipalId: string;
  readonly sequence: number;
  readonly previousEventHash: Sha256ContentId | null;
  readonly eventHash: Sha256ContentId;
}

export interface RunLockRecord {
  readonly lockId: string;
  readonly runId: string;
  readonly runRevision: number;
  readonly reason: string;
  readonly lockedAt: string;
  readonly principalId: string;
  readonly lockRevision: 1;
}

export interface RunOperationsRepository {
  appendEvent(
    context: WorkspaceAccessContext,
    draft: RunAuditEventDraft,
    idempotencyKey: string,
  ): Promise<RunAuditEvent>;
  listEvents(
    scope: WorkspaceScope,
    runId: string,
    options?: { readonly afterSequence?: number | undefined; readonly limit?: number | undefined },
  ): Promise<readonly RunAuditEvent[]>;
  lockRun(
    context: WorkspaceAccessContext,
    input: Omit<RunLockRecord, "principalId" | "lockRevision">,
  ): Promise<RunLockRecord>;
  getLock(scope: WorkspaceScope, runId: string): Promise<RunLockRecord | null>;
}
