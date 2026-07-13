import type { ContentRef, Sha256ContentId } from "../../engine/analysisRun";
import { reproducibilityHash } from "../../lib/evidenceLocking";
import type { RunAuditEvent, RunAuditEventDraft, RunLockRecord, RunOperationsRepository } from "../runOperations";
import { RunOperationsError } from "../runOperations/inMemoryRepository";
import { parsePlatformIdentifier, parseWorkspaceAccessContext, parseWorkspaceScope, type WorkspaceAccessContext, type WorkspaceScope } from "../workspaceScope";
import type { SqlTransaction, TransactionalSqlDriver } from "./contracts";

interface EventRow extends Record<string, unknown> {
  readonly event_id: string; readonly run_id: string; readonly run_revision: number;
  readonly event_type: RunAuditEvent["eventType"]; readonly occurred_at: string | Date;
  readonly correlation_id: string; readonly payload_ref: ContentRef | string | null;
  readonly actor_principal_id: string; readonly sequence: number;
  readonly previous_event_hash: Sha256ContentId | null; readonly event_hash: Sha256ContentId;
}

interface LockRow extends Record<string, unknown> {
  readonly lock_id: string; readonly run_id: string; readonly run_revision: number;
  readonly reason: string; readonly locked_at: string | Date; readonly principal_id: string; readonly lock_revision: 1;
}

interface ReceiptRow extends Record<string, unknown> { readonly request_fingerprint: string; readonly resource_id: string; }

function timestamp(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO-8601 timestamp.`);
  return value;
}

function revision(value: number): number { if (!Number.isInteger(value) || value < 1) throw new Error("runRevision must be positive."); return value; }
function iso(value: string | Date): string { return typeof value === "string" ? new Date(value).toISOString() : value.toISOString(); }
function json<T>(value: T | string): T { return typeof value === "string" ? JSON.parse(value) as T : value; }
async function hash(value: unknown): Promise<Sha256ContentId> { return `sha256:${await reproducibilityHash(value as Record<string, unknown>)}`; }

function eventFromRow(row: EventRow): RunAuditEvent {
  return Object.freeze({
    eventId: row.event_id, runId: row.run_id, runRevision: Number(row.run_revision), eventType: row.event_type,
    occurredAt: iso(row.occurred_at), correlationId: row.correlation_id,
    payloadRef: row.payload_ref === null ? null : json<ContentRef>(row.payload_ref),
    actorPrincipalId: row.actor_principal_id, sequence: Number(row.sequence),
    previousEventHash: row.previous_event_hash, eventHash: row.event_hash,
  });
}

function lockFromRow(row: LockRow): RunLockRecord {
  return Object.freeze({ lockId: row.lock_id, runId: row.run_id, runRevision: Number(row.run_revision), reason: row.reason, lockedAt: iso(row.locked_at), principalId: row.principal_id, lockRevision: 1 });
}

const EVENT_COLUMNS = "event_id, run_id, run_revision, event_type, occurred_at, correlation_id, payload_ref, actor_principal_id, sequence, previous_event_hash, event_hash";
const LOCK_COLUMNS = "lock_id, run_id, run_revision, reason, locked_at, principal_id, lock_revision";

async function requireRunLock(tx: SqlTransaction, scope: WorkspaceScope, runId: string): Promise<void> {
  const result = await tx.query("select 1 from platform_analysis_runs where organization_id = $1 and workspace_id = $2 and run_id = $3 for update", [scope.organizationId, scope.workspaceId, runId]);
  if (result.rowCount !== 1) throw new Error("The analysis run was not found.");
}

/** PostgreSQL append-only event chain and immutable publication-lock repository. */
export class SqlRunOperationsRepository implements RunOperationsRepository {
  constructor(private readonly driver: TransactionalSqlDriver) {}

  async appendEvent(contextValue: WorkspaceAccessContext, draftValue: RunAuditEventDraft, keyValue: string): Promise<RunAuditEvent> {
    const context = parseWorkspaceAccessContext(contextValue);
    const draft = Object.freeze({
      ...draftValue,
      eventId: parsePlatformIdentifier(draftValue.eventId, "eventId"),
      runId: parsePlatformIdentifier(draftValue.runId, "runId"),
      correlationId: parsePlatformIdentifier(draftValue.correlationId, "correlationId"),
      runRevision: revision(draftValue.runRevision), occurredAt: timestamp(draftValue.occurredAt, "occurredAt"),
    });
    const idempotencyKey = parsePlatformIdentifier(keyValue, "idempotencyKey");
    const requestFingerprint = await hash(draft);
    return this.driver.transaction(async (tx) => {
      const receiptResult = await tx.query<ReceiptRow>(
        "select request_fingerprint, resource_id from platform_idempotency_receipts where organization_id = $1 and workspace_id = $2 and idempotency_key = $3 for update",
        [context.scope.organizationId, context.scope.workspaceId, idempotencyKey],
      );
      const receipt = receiptResult.rows[0];
      if (receipt) {
        if (receipt.request_fingerprint !== requestFingerprint) throw new RunOperationsError("IDEMPOTENCY_KEY_REUSED", "The event idempotency key was reused for different content.");
        const replay = await tx.query<EventRow>(`select ${EVENT_COLUMNS} from platform_run_events where organization_id = $1 and workspace_id = $2 and event_id = $3`, [context.scope.organizationId, context.scope.workspaceId, receipt.resource_id]);
        if (!replay.rows[0]) throw new RunOperationsError("EVENT_SEQUENCE_INVALID", "The event receipt does not resolve to an event.");
        return eventFromRow(replay.rows[0]);
      }
      await requireRunLock(tx, context.scope, draft.runId);
      const previousResult = await tx.query<EventRow>(
        `select ${EVENT_COLUMNS} from platform_run_events where organization_id = $1 and workspace_id = $2 and run_id = $3 order by sequence desc limit 1`,
        [context.scope.organizationId, context.scope.workspaceId, draft.runId],
      );
      const previous = previousResult.rows[0] ? eventFromRow(previousResult.rows[0]) : null;
      const core = { ...draft, actorPrincipalId: context.principal.principalId, sequence: (previous?.sequence ?? 0) + 1, previousEventHash: previous?.eventHash ?? null };
      const event = Object.freeze({ ...core, eventHash: await hash(core) });
      await tx.query(
        `insert into platform_run_events
          (organization_id, workspace_id, run_id, sequence, event_id, run_revision, event_type, occurred_at, correlation_id, actor_principal_id, previous_event_hash, event_hash, payload_ref)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
        [context.scope.organizationId, context.scope.workspaceId, event.runId, event.sequence, event.eventId, event.runRevision, event.eventType, event.occurredAt, event.correlationId, event.actorPrincipalId, event.previousEventHash, event.eventHash, event.payloadRef === null ? null : JSON.stringify(event.payloadRef)],
      );
      await tx.query(
        `insert into platform_idempotency_receipts (organization_id, workspace_id, idempotency_key, operation, request_fingerprint, resource_id)
         values ($1,$2,$3,'event:append',$4,$5)`,
        [context.scope.organizationId, context.scope.workspaceId, idempotencyKey, requestFingerprint, event.eventId],
      );
      return event;
    });
  }

  async listEvents(scopeValue: WorkspaceScope, runIdValue: string, options: { readonly afterSequence?: number; readonly limit?: number } = {}): Promise<readonly RunAuditEvent[]> {
    const scope = parseWorkspaceScope(scopeValue);
    const runId = parsePlatformIdentifier(runIdValue, "runId");
    const after = options.afterSequence ?? 0;
    const limit = options.limit ?? 100;
    if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid event page request.");
    const result = await this.driver.query<EventRow>(
      `select ${EVENT_COLUMNS} from platform_run_events where organization_id = $1 and workspace_id = $2 and run_id = $3 and sequence > $4 order by sequence asc limit $5`,
      [scope.organizationId, scope.workspaceId, runId, after, limit],
    );
    return Object.freeze(result.rows.map(eventFromRow));
  }

  async lockRun(contextValue: WorkspaceAccessContext, inputValue: Omit<RunLockRecord, "principalId" | "lockRevision">): Promise<RunLockRecord> {
    const context = parseWorkspaceAccessContext(contextValue);
    const input = {
      lockId: parsePlatformIdentifier(inputValue.lockId, "lockId"), runId: parsePlatformIdentifier(inputValue.runId, "runId"),
      runRevision: revision(inputValue.runRevision), reason: inputValue.reason?.trim(), lockedAt: timestamp(inputValue.lockedAt, "lockedAt"),
    };
    if (!input.reason || input.reason.length > 1_000) throw new Error("reason must contain 1-1000 characters.");
    return this.driver.transaction(async (tx) => {
      await requireRunLock(tx, context.scope, input.runId);
      const existing = await tx.query<LockRow>(`select ${LOCK_COLUMNS} from platform_run_locks where organization_id = $1 and workspace_id = $2 and run_id = $3 for update`, [context.scope.organizationId, context.scope.workspaceId, input.runId]);
      if (existing.rows[0]) {
        const lock = lockFromRow(existing.rows[0]);
        if (lock.lockId === input.lockId && lock.runRevision === input.runRevision) return lock;
        throw new RunOperationsError("RUN_ALREADY_LOCKED", "The run already has an immutable publication lock.");
      }
      const lock = Object.freeze({ ...input, principalId: context.principal.principalId, lockRevision: 1 as const });
      await tx.query(
        `insert into platform_run_locks (organization_id, workspace_id, run_id, lock_id, run_revision, reason, locked_at, principal_id, lock_revision)
         values ($1,$2,$3,$4,$5,$6,$7,$8,1)`,
        [context.scope.organizationId, context.scope.workspaceId, lock.runId, lock.lockId, lock.runRevision, lock.reason, lock.lockedAt, lock.principalId],
      );
      return lock;
    });
  }

  async getLock(scopeValue: WorkspaceScope, runIdValue: string): Promise<RunLockRecord | null> {
    const scope = parseWorkspaceScope(scopeValue);
    const runId = parsePlatformIdentifier(runIdValue, "runId");
    const result = await this.driver.query<LockRow>(`select ${LOCK_COLUMNS} from platform_run_locks where organization_id = $1 and workspace_id = $2 and run_id = $3`, [scope.organizationId, scope.workspaceId, runId]);
    return result.rows[0] ? lockFromRow(result.rows[0]) : null;
  }
}
