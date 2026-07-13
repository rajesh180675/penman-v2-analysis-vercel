import type { AnalysisRunDraftV1, AnalysisRunV1 } from "../../engine/analysisRun/contracts";
import { createAnalysisRunV1 } from "../../engine/analysisRun/identity";
import { reproducibilityHash } from "../../lib/evidenceLocking";
import type { AnalysisRunLifecycle, AnalysisRunRepository, AnalysisRunSummary, CursorPage, RunQuery, VersionedAnalysisRun } from "../analysisRunRepository/contracts";
import { AnalysisRunRepositoryError } from "../analysisRunRepository/errors";
import { parseAnalysisRunDraftV1, parseExpectedRevision, parseIdempotencyKey, parseRunId, parseRunQuery } from "../analysisRunRepository/validation";
import { parseWorkspaceAccessContext, parseWorkspaceScope, type WorkspaceAccessContext, type WorkspaceScope } from "../workspaceScope";
import type { SqlTransaction, TransactionalSqlDriver } from "./contracts";

interface RunRow extends Record<string, unknown> {
  readonly run_json: AnalysisRunV1 | string;
  readonly lifecycle: AnalysisRunLifecycle;
  readonly revision: number;
}

interface ReceiptRow extends Record<string, unknown> {
  readonly request_fingerprint: string;
  readonly resource_id: string;
}

function readRunJson(value: AnalysisRunV1 | string): AnalysisRunV1 {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Object.freeze(structuredClone(parsed)) as AnalysisRunV1;
}

function versioned(row: RunRow): VersionedAnalysisRun {
  return Object.freeze({ run: readRunJson(row.run_json), lifecycle: row.lifecycle, revision: Number(row.revision) });
}

function summary(value: VersionedAnalysisRun): AnalysisRunSummary {
  return Object.freeze({
    runId: value.run.runId, issuerId: value.run.issuerId, status: value.run.status,
    lifecycle: value.lifecycle, asOf: value.run.asOf, createdAt: value.run.createdAt,
    reproducibilityHash: value.run.reproducibilityHash, revision: value.revision,
  });
}

async function fingerprint(value: unknown): Promise<string> {
  return `sha256:${await reproducibilityHash(value as Record<string, unknown>)}`;
}

interface SqlCursorV1 {
  readonly version: 1;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly runId: string;
  readonly signature: string;
}

function signature(query: ReturnType<typeof parseRunQuery>): string {
  return JSON.stringify({ issuerId: query.issuerId, statuses: [...query.statuses].sort(), lifecycle: query.lifecycle });
}

function encodeCursor(cursor: SqlCursorV1): string {
  return `sql-v1.${encodeURIComponent(JSON.stringify(cursor))}`;
}

function decodeCursor(value: string, scope: WorkspaceScope, query: ReturnType<typeof parseRunQuery>): SqlCursorV1 {
  try {
    if (!value.startsWith("sql-v1.")) throw new Error("version");
    const parsed = JSON.parse(decodeURIComponent(value.slice(7))) as SqlCursorV1;
    if (parsed.version !== 1 || parsed.organizationId !== scope.organizationId || parsed.workspaceId !== scope.workspaceId || parsed.signature !== signature(query) || !parsed.createdAt || !parsed.runId) throw new Error("scope");
    return parsed;
  } catch {
    throw new AnalysisRunRepositoryError("INVALID_CURSOR", "The pagination cursor is invalid for this workspace or query.");
  }
}

async function selectRun(tx: SqlTransaction, scope: WorkspaceScope, runId: string, forUpdate = false): Promise<VersionedAnalysisRun | null> {
  const result = await tx.query<RunRow>(
    `select run_json, lifecycle, revision from platform_analysis_runs
      where organization_id = $1 and workspace_id = $2 and run_id = $3${forUpdate ? " for update" : ""}`,
    [scope.organizationId, scope.workspaceId, runId],
  );
  return result.rows[0] ? versioned(result.rows[0]) : null;
}

/** PostgreSQL-backed immutable run repository with transactional idempotency and CAS finalization. */
export class SqlAnalysisRunRepository implements AnalysisRunRepository {
  constructor(private readonly driver: TransactionalSqlDriver) {}

  async create(contextValue: WorkspaceAccessContext, draftValue: AnalysisRunDraftV1, keyValue: string): Promise<VersionedAnalysisRun> {
    const context = parseWorkspaceAccessContext(contextValue);
    const draft = structuredClone(parseAnalysisRunDraftV1(draftValue));
    const idempotencyKey = parseIdempotencyKey(keyValue);
    const [run, requestFingerprint] = await Promise.all([createAnalysisRunV1(draft), fingerprint(draft)]);
    return this.driver.transaction(async (tx) => {
      const receiptResult = await tx.query<ReceiptRow>(
        `select request_fingerprint, resource_id from platform_idempotency_receipts
          where organization_id = $1 and workspace_id = $2 and idempotency_key = $3 for update`,
        [context.scope.organizationId, context.scope.workspaceId, idempotencyKey],
      );
      const receipt = receiptResult.rows[0];
      if (receipt) {
        if (receipt.request_fingerprint !== requestFingerprint) throw new AnalysisRunRepositoryError("IDEMPOTENCY_KEY_REUSED", "The idempotency key has already been used for a different request.");
        const replay = await selectRun(tx, context.scope, String(receipt.resource_id));
        if (!replay) throw new AnalysisRunRepositoryError("RUN_NOT_FOUND", "The analysis run was not found.");
        return replay;
      }
      const existing = await selectRun(tx, context.scope, run.runId, true);
      if (existing) throw new AnalysisRunRepositoryError("RUN_ALREADY_EXISTS", "An analysis run with this identifier already exists in the workspace.", { runId: run.runId });
      await tx.query(
        `insert into platform_analysis_runs
          (organization_id, workspace_id, run_id, issuer_id, lifecycle, status, as_of, created_at, reproducibility_hash, revision, run_json)
          values ($1,$2,$3,$4,'open',$5,$6,$7,$8,1,$9::jsonb)`,
        [context.scope.organizationId, context.scope.workspaceId, run.runId, run.issuerId, run.status, run.asOf, run.createdAt, run.reproducibilityHash, JSON.stringify(run)],
      );
      await tx.query(
        `insert into platform_idempotency_receipts
          (organization_id, workspace_id, idempotency_key, operation, request_fingerprint, resource_id)
          values ($1,$2,$3,'run:create',$4,$5)`,
        [context.scope.organizationId, context.scope.workspaceId, idempotencyKey, requestFingerprint, run.runId],
      );
      return Object.freeze({ run, lifecycle: "open" as const, revision: 1 });
    });
  }

  async get(scopeValue: WorkspaceScope, runIdValue: string): Promise<VersionedAnalysisRun | null> {
    const scope = parseWorkspaceScope(scopeValue);
    return selectRun(this.driver, scope, parseRunId(runIdValue));
  }

  async list(scopeValue: WorkspaceScope, queryValue?: RunQuery): Promise<CursorPage<AnalysisRunSummary>> {
    const scope = parseWorkspaceScope(scopeValue);
    const query = parseRunQuery(queryValue);
    const parameters: unknown[] = [scope.organizationId, scope.workspaceId];
    const where = ["organization_id = $1", "workspace_id = $2"];
    if (query.issuerId) { parameters.push(query.issuerId); where.push(`issuer_id = $${parameters.length}`); }
    if (query.statuses.length) { parameters.push([...query.statuses]); where.push(`status = any($${parameters.length}::text[])`); }
    if (query.lifecycle) { parameters.push(query.lifecycle); where.push(`lifecycle = $${parameters.length}`); }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor, scope, query);
      parameters.push(cursor.createdAt, cursor.runId);
      where.push(`(created_at, run_id) < ($${parameters.length - 1}::timestamptz, $${parameters.length})`);
    }
    parameters.push(query.limit + 1);
    const result = await this.driver.query<RunRow>(
      `select run_json, lifecycle, revision from platform_analysis_runs where ${where.join(" and ")}
       order by created_at desc, run_id desc limit $${parameters.length}`,
      parameters,
    );
    const selected = result.rows.slice(0, query.limit).map(versioned);
    const hasMore = result.rows.length > query.limit;
    const anchor = selected.at(-1)?.run;
    return Object.freeze({
      items: Object.freeze(selected.map(summary)),
      nextCursor: hasMore && anchor ? encodeCursor({ version: 1, organizationId: scope.organizationId, workspaceId: scope.workspaceId, createdAt: anchor.createdAt, runId: anchor.runId, signature: signature(query) }) : null,
    });
  }

  async finalize(contextValue: WorkspaceAccessContext, runIdValue: string, revisionValue: number): Promise<VersionedAnalysisRun> {
    const context = parseWorkspaceAccessContext(contextValue);
    const runId = parseRunId(runIdValue);
    const expectedRevision = parseExpectedRevision(revisionValue);
    return this.driver.transaction(async (tx) => {
      const current = await selectRun(tx, context.scope, runId, true);
      if (!current) throw new AnalysisRunRepositoryError("RUN_NOT_FOUND", "The analysis run was not found.", { runId });
      if (current.lifecycle === "finalized" && current.revision === expectedRevision) return current;
      if (current.revision !== expectedRevision) throw new AnalysisRunRepositoryError("REVISION_CONFLICT", "The analysis run revision does not match the expected revision.", { runId, expectedRevision, actualRevision: current.revision });
      const result = await tx.query<RunRow>(
        `update platform_analysis_runs set lifecycle = 'finalized', revision = revision + 1
          where organization_id = $1 and workspace_id = $2 and run_id = $3 and revision = $4 and lifecycle = 'open'
          returning run_json, lifecycle, revision`,
        [context.scope.organizationId, context.scope.workspaceId, runId, expectedRevision],
      );
      if (!result.rows[0]) throw new AnalysisRunRepositoryError("REVISION_CONFLICT", "The analysis run revision changed concurrently.", { runId, expectedRevision });
      return versioned(result.rows[0]);
    });
  }
}
