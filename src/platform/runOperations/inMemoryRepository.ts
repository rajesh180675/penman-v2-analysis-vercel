import { reproducibilityHash } from "../../lib/evidenceLocking";
import { parseWorkspaceAccessContext, parseWorkspaceScope, parsePlatformIdentifier, type WorkspaceAccessContext, type WorkspaceScope } from "../workspaceScope";
import type { RunAuditEvent, RunAuditEventDraft, RunLockRecord, RunOperationsRepository } from "./contracts";

interface Partition {
  readonly eventsByRun: Map<string, RunAuditEvent[]>;
  readonly eventReceipts: Map<string, { readonly fingerprint: string; readonly event: RunAuditEvent }>;
  readonly locksByRun: Map<string, RunLockRecord>;
}

export class RunOperationsError extends Error {
  constructor(
    readonly code: "IDEMPOTENCY_KEY_REUSED" | "RUN_ALREADY_LOCKED" | "EVENT_SEQUENCE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "RunOperationsError";
  }
}

function scopeKey(scope: WorkspaceScope): string {
  return `${scope.organizationId}\u0000${scope.workspaceId}`;
}

function timestamp(value: string, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-8601 timestamp.`);
  }
  return value;
}

function positiveRevision(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer.`);
  return value;
}

async function fingerprint(value: unknown) {
  return `sha256:${await reproducibilityHash(value as Record<string, unknown>)}` as const;
}

/** Append-only event chain and one-way publication lock reference adapter. */
export class InMemoryRunOperationsRepository implements RunOperationsRepository {
  readonly #partitions = new Map<string, Partition>();
  #mutationTail: Promise<void> = Promise.resolve();

  #partition(scope: WorkspaceScope, create: boolean): Partition | null {
    const key = scopeKey(scope);
    const existing = this.#partitions.get(key);
    if (existing || !create) return existing ?? null;
    const partition: Partition = { eventsByRun: new Map(), eventReceipts: new Map(), locksByRun: new Map() };
    this.#partitions.set(key, partition);
    return partition;
  }

  #mutate<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.#mutationTail.then(operation, operation);
    this.#mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async appendEvent(
    unsafeContext: WorkspaceAccessContext,
    unsafeDraft: RunAuditEventDraft,
    idempotencyKey: string,
  ): Promise<RunAuditEvent> {
    const context = parseWorkspaceAccessContext(unsafeContext);
    const draft: RunAuditEventDraft = Object.freeze({
      ...unsafeDraft,
      eventId: parsePlatformIdentifier(unsafeDraft.eventId, "eventId"),
      runId: parsePlatformIdentifier(unsafeDraft.runId, "runId"),
      correlationId: parsePlatformIdentifier(unsafeDraft.correlationId, "correlationId"),
      runRevision: positiveRevision(unsafeDraft.runRevision, "runRevision"),
      occurredAt: timestamp(unsafeDraft.occurredAt, "occurredAt"),
    });
    const parsedIdempotencyKey = parsePlatformIdentifier(idempotencyKey, "idempotencyKey");
    const requestFingerprint = await fingerprint(draft);
    return this.#mutate(async () => {
      const partition = this.#partition(context.scope, true)!;
      const receipt = partition.eventReceipts.get(parsedIdempotencyKey);
      if (receipt) {
        if (receipt.fingerprint !== requestFingerprint) {
          throw new RunOperationsError("IDEMPOTENCY_KEY_REUSED", "The event idempotency key was reused for different content.");
        }
        return receipt.event;
      }
      const events = partition.eventsByRun.get(draft.runId) ?? [];
      if (events.some((event) => event.eventId === draft.eventId)) {
        throw new RunOperationsError("EVENT_SEQUENCE_INVALID", "Event IDs must be unique within a run.");
      }
      const previous = events.at(-1) ?? null;
      const core = {
        ...draft,
        actorPrincipalId: context.principal.principalId,
        sequence: events.length + 1,
        previousEventHash: previous?.eventHash ?? null,
      };
      const event = Object.freeze({ ...core, eventHash: await fingerprint(core) });
      events.push(event);
      partition.eventsByRun.set(draft.runId, events);
      partition.eventReceipts.set(parsedIdempotencyKey, { fingerprint: requestFingerprint, event });
      return event;
    });
  }

  async listEvents(
    unsafeScope: WorkspaceScope,
    unsafeRunId: string,
    options: { readonly afterSequence?: number | undefined; readonly limit?: number | undefined } = {},
  ): Promise<readonly RunAuditEvent[]> {
    const scope = parseWorkspaceScope(unsafeScope);
    const runId = parsePlatformIdentifier(unsafeRunId, "runId");
    const afterSequence = options.afterSequence ?? 0;
    const limit = options.limit ?? 100;
    if (!Number.isInteger(afterSequence) || afterSequence < 0) throw new Error("afterSequence must be a non-negative integer.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("limit must be between 1 and 500.");
    const events = this.#partition(scope, false)?.eventsByRun.get(runId) ?? [];
    return Object.freeze(events.filter((event) => event.sequence > afterSequence).slice(0, limit));
  }

  async lockRun(
    unsafeContext: WorkspaceAccessContext,
    input: Omit<RunLockRecord, "principalId" | "lockRevision">,
  ): Promise<RunLockRecord> {
    const context = parseWorkspaceAccessContext(unsafeContext);
    const parsed = {
      lockId: parsePlatformIdentifier(input.lockId, "lockId"),
      runId: parsePlatformIdentifier(input.runId, "runId"),
      runRevision: positiveRevision(input.runRevision, "runRevision"),
      reason: input.reason?.trim(),
      lockedAt: timestamp(input.lockedAt, "lockedAt"),
    };
    if (!parsed.reason || parsed.reason.length > 1_000) throw new Error("reason must be 1-1000 characters.");
    return this.#mutate(() => {
      const partition = this.#partition(context.scope, true)!;
      const existing = partition.locksByRun.get(parsed.runId);
      if (existing) {
        if (existing.lockId === parsed.lockId && existing.runRevision === parsed.runRevision) return existing;
        throw new RunOperationsError("RUN_ALREADY_LOCKED", "The run already has an immutable publication lock.");
      }
      const lock = Object.freeze({ ...parsed, principalId: context.principal.principalId, lockRevision: 1 as const });
      partition.locksByRun.set(parsed.runId, lock);
      return lock;
    });
  }

  async getLock(unsafeScope: WorkspaceScope, unsafeRunId: string): Promise<RunLockRecord | null> {
    const scope = parseWorkspaceScope(unsafeScope);
    const runId = parsePlatformIdentifier(unsafeRunId, "runId");
    return this.#partition(scope, false)?.locksByRun.get(runId) ?? null;
  }
}

export function createInMemoryRunOperationsRepository(): RunOperationsRepository {
  return new InMemoryRunOperationsRepository();
}
