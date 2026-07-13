import {
  createAnalysisRunV1,
  type AnalysisRunDraftV1,
  type AnalysisRunV1,
} from "../../engine/analysisRun";
import { reproducibilityHash } from "../../lib/evidenceLocking";
import {
  parseWorkspaceAccessContext,
  parseWorkspaceScope,
  type WorkspaceAccessContext,
  type WorkspaceScope,
} from "../workspaceScope";
import type {
  AnalysisRunLifecycle,
  AnalysisRunRepository,
  AnalysisRunSummary,
  CursorPage,
  RunQuery,
  VersionedAnalysisRun,
} from "./contracts";
import { AnalysisRunRepositoryError } from "./errors";
import {
  parseAnalysisRunDraftV1,
  parseExpectedRevision,
  parseIdempotencyKey,
  parseRunId,
  parseRunQuery,
  type ParsedRunQuery,
} from "./validation";

interface StoredRun {
  readonly value: VersionedAnalysisRun;
}

interface IdempotencyReceipt {
  readonly runId: string;
  readonly requestFingerprint: string;
}

interface WorkspacePartition {
  readonly runs: Map<string, StoredRun>;
  readonly idempotencyReceipts: Map<string, IdempotencyReceipt>;
}

interface CursorPayloadV1 {
  readonly version: 1;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly anchorRunId: string;
  readonly anchorCreatedAt: string;
  readonly filterSignature: string;
}

function workspaceKey(scope: WorkspaceScope): string {
  // Platform identifiers cannot contain NUL, so this tuple encoding cannot
  // collide even when one identifier is a prefix of another.
  return `${scope.organizationId}\u0000${scope.workspaceId}`;
}

function freezeVersion(
  run: AnalysisRunV1,
  lifecycle: AnalysisRunLifecycle,
  revision: number,
): VersionedAnalysisRun {
  return Object.freeze({ run, lifecycle, revision });
}

function summaryOf(value: VersionedAnalysisRun): AnalysisRunSummary {
  return Object.freeze({
    runId: value.run.runId,
    issuerId: value.run.issuerId,
    status: value.run.status,
    lifecycle: value.lifecycle,
    asOf: value.run.asOf,
    createdAt: value.run.createdAt,
    reproducibilityHash: value.run.reproducibilityHash,
    revision: value.revision,
  });
}

function normalizedFilterSignature(query: ParsedRunQuery): string {
  return JSON.stringify({
    issuerId: query.issuerId,
    statuses: [...query.statuses].sort(),
    lifecycle: query.lifecycle,
  });
}

function encodeCursor(payload: CursorPayloadV1): string {
  return `v1.${encodeURIComponent(JSON.stringify(payload))}`;
}

function invalidCursor(): never {
  throw new AnalysisRunRepositoryError(
    "INVALID_CURSOR",
    "The pagination cursor is invalid for this workspace or query.",
  );
}

function decodeCursor(
  cursor: string,
  scope: WorkspaceScope,
  query: ParsedRunQuery,
): CursorPayloadV1 {
  if (!cursor.startsWith("v1.")) return invalidCursor();

  let value: unknown;
  try {
    value = JSON.parse(decodeURIComponent(cursor.slice(3)));
  } catch {
    return invalidCursor();
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidCursor();
  }
  const payload = value as Record<string, unknown>;
  const expectedKeys = [
    "version",
    "organizationId",
    "workspaceId",
    "anchorRunId",
    "anchorCreatedAt",
    "filterSignature",
  ];
  if (
    Object.keys(payload).length !== expectedKeys.length
    || expectedKeys.some((key) => !(key in payload))
    || payload.version !== 1
    || typeof payload.organizationId !== "string"
    || typeof payload.workspaceId !== "string"
    || typeof payload.anchorRunId !== "string"
    || typeof payload.anchorCreatedAt !== "string"
    || typeof payload.filterSignature !== "string"
    || payload.organizationId !== scope.organizationId
    || payload.workspaceId !== scope.workspaceId
    || payload.filterSignature !== normalizedFilterSignature(query)
  ) {
    return invalidCursor();
  }
  return payload as unknown as CursorPayloadV1;
}

async function fingerprintDraft(draft: AnalysisRunDraftV1): Promise<string> {
  const digest = await reproducibilityHash(draft as unknown as Record<string, unknown>);
  return `sha256:${digest}`;
}

/**
 * Transaction-semantics reference adapter for local mode and unit tests.
 *
 * The adapter keeps immutable analytical payloads separate from mutable
 * repository metadata. A tiny process-local mutation queue provides atomic
 * create/idempotency and compare-and-swap finalization semantics even when
 * callers issue concurrent promises.
 */
export class InMemoryAnalysisRunRepository implements AnalysisRunRepository {
  private readonly partitions = new Map<string, WorkspacePartition>();
  private mutationTail: Promise<void> = Promise.resolve();

  private withMutationLock<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private partition(scope: WorkspaceScope, create: boolean): WorkspacePartition | null {
    const key = workspaceKey(scope);
    const existing = this.partitions.get(key);
    if (existing) return existing;
    if (!create) return null;
    const partition: WorkspacePartition = {
      runs: new Map(),
      idempotencyReceipts: new Map(),
    };
    this.partitions.set(key, partition);
    return partition;
  }

  async create(
    unsafeContext: WorkspaceAccessContext,
    unsafeDraft: AnalysisRunDraftV1,
    unsafeIdempotencyKey: string,
  ): Promise<VersionedAnalysisRun> {
    const context = parseWorkspaceAccessContext(unsafeContext);
    const parsedDraft = parseAnalysisRunDraftV1(unsafeDraft);
    // Snapshot the validated JSON graph before the first async boundary. This
    // prevents a caller from racing nested mutations against hashing/freezing.
    const draft = JSON.parse(JSON.stringify(parsedDraft)) as AnalysisRunDraftV1;
    const idempotencyKey = parseIdempotencyKey(unsafeIdempotencyKey);
    const [run, requestFingerprint] = await Promise.all([
      createAnalysisRunV1(draft),
      fingerprintDraft(draft),
    ]);

    return this.withMutationLock(() => {
      const partition = this.partition(context.scope, true)!;
      const receipt = partition.idempotencyReceipts.get(idempotencyKey);
      if (receipt) {
        if (receipt.requestFingerprint !== requestFingerprint) {
          throw new AnalysisRunRepositoryError(
            "IDEMPOTENCY_KEY_REUSED",
            "The idempotency key has already been used for a different request.",
          );
        }
        const stored = partition.runs.get(receipt.runId);
        if (!stored) {
          // This invariant can only be violated by an adapter implementation
          // bug; expose the same non-enumerating response as a missing run.
          throw new AnalysisRunRepositoryError("RUN_NOT_FOUND", "The analysis run was not found.");
        }
        return stored.value;
      }

      if (partition.runs.has(run.runId)) {
        throw new AnalysisRunRepositoryError(
          "RUN_ALREADY_EXISTS",
          "An analysis run with this identifier already exists in the workspace.",
          { runId: run.runId },
        );
      }

      const value = freezeVersion(run, "open", 1);
      partition.runs.set(run.runId, { value });
      partition.idempotencyReceipts.set(idempotencyKey, {
        runId: run.runId,
        requestFingerprint,
      });
      return value;
    });
  }

  async get(unsafeScope: WorkspaceScope, unsafeRunId: string): Promise<VersionedAnalysisRun | null> {
    const scope = parseWorkspaceScope(unsafeScope);
    const runId = parseRunId(unsafeRunId);
    return this.partition(scope, false)?.runs.get(runId)?.value ?? null;
  }

  async list(
    unsafeScope: WorkspaceScope,
    unsafeQuery?: RunQuery | undefined,
  ): Promise<CursorPage<AnalysisRunSummary>> {
    const scope = parseWorkspaceScope(unsafeScope);
    const query = parseRunQuery(unsafeQuery);
    const partition = this.partition(scope, false);
    const filtered = [...(partition?.runs.values() ?? [])]
      .map((stored) => stored.value)
      .filter((value) => query.issuerId === null || value.run.issuerId === query.issuerId)
      .filter((value) => query.statuses.length === 0 || query.statuses.includes(value.run.status))
      .filter((value) => query.lifecycle === null || value.lifecycle === query.lifecycle)
      .sort((left, right) => {
        const byCreatedAt = Date.parse(right.run.createdAt) - Date.parse(left.run.createdAt);
        return byCreatedAt !== 0 ? byCreatedAt : left.run.runId.localeCompare(right.run.runId);
      });

    let start = 0;
    if (query.cursor !== null) {
      const cursor = decodeCursor(query.cursor, scope, query);
      const anchorIndex = filtered.findIndex(
        (value) => value.run.runId === cursor.anchorRunId
          && value.run.createdAt === cursor.anchorCreatedAt,
      );
      if (anchorIndex < 0) return invalidCursor();
      start = anchorIndex + 1;
    }

    const selected = filtered.slice(start, start + query.limit);
    const items = Object.freeze(selected.map(summaryOf));
    const hasMore = start + selected.length < filtered.length;
    const anchor = selected.at(-1);
    const nextCursor = hasMore && anchor
      ? encodeCursor({
          version: 1,
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          anchorRunId: anchor.run.runId,
          anchorCreatedAt: anchor.run.createdAt,
          filterSignature: normalizedFilterSignature(query),
        })
      : null;
    return Object.freeze({ items, nextCursor });
  }

  async finalize(
    unsafeContext: WorkspaceAccessContext,
    unsafeRunId: string,
    unsafeExpectedRevision: number,
  ): Promise<VersionedAnalysisRun> {
    const context = parseWorkspaceAccessContext(unsafeContext);
    const runId = parseRunId(unsafeRunId);
    const expectedRevision = parseExpectedRevision(unsafeExpectedRevision);

    return this.withMutationLock(() => {
      const partition = this.partition(context.scope, false);
      const stored = partition?.runs.get(runId);
      if (!stored) {
        throw new AnalysisRunRepositoryError(
          "RUN_NOT_FOUND",
          "The analysis run was not found.",
          { runId },
        );
      }
      if (stored.value.revision !== expectedRevision) {
        throw new AnalysisRunRepositoryError(
          "REVISION_CONFLICT",
          "The analysis run revision does not match the expected revision.",
          {
            runId,
            expectedRevision,
            actualRevision: stored.value.revision,
          },
        );
      }
      if (stored.value.lifecycle === "finalized") return stored.value;

      const value = freezeVersion(stored.value.run, "finalized", stored.value.revision + 1);
      partition!.runs.set(runId, { value });
      return value;
    });
  }
}

export function createInMemoryAnalysisRunRepository(): AnalysisRunRepository {
  return new InMemoryAnalysisRunRepository();
}
