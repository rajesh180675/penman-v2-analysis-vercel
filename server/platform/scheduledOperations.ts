import { timingSafeEqual } from "node:crypto";
import {
  HmacSha256BackupAuthenticator,
  ProductionBackupRestoreDrill,
  SqlOutboxDispatcher,
  type DurableObjectStore,
  type TransactionalSqlDriver,
} from "../../src/platform";
import { WebhookOutboxSink } from "./webhookOutboxSink";

interface WorkspaceRow extends Record<string, unknown> {
  readonly organization_id: string;
  readonly workspace_id: string;
}

export function cronAuthorizationMatches(authorization: string | undefined, secret: string | undefined): boolean {
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const presented = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export function backupAuthenticatorFromEnvironment() {
  const keyId = process.env.PLATFORM_BACKUP_HMAC_KEY_ID?.trim();
  const encoded = process.env.PLATFORM_BACKUP_HMAC_KEY_BASE64?.trim();
  if (!keyId || !encoded) throw new Error("Platform backup authentication is not configured.");
  return new HmacSha256BackupAuthenticator(keyId, new Uint8Array(Buffer.from(encoded, "base64")));
}

export async function listActiveWorkspaceScopes(sql: TransactionalSqlDriver, limit = 25) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Workspace operation limit is invalid.");
  const rows = await sql.query<WorkspaceRow>(
    `select distinct organization_id, workspace_id from platform_workspace_memberships
     where status = 'active' and (valid_until is null or valid_until > now())
     order by organization_id, workspace_id limit $1`,
    [limit],
  );
  return rows.rows.map((row) => Object.freeze({ organizationId: row.organization_id, workspaceId: row.workspace_id }));
}

export async function runScheduledBackups(input: { readonly sql: TransactionalSqlDriver; readonly objects: DurableObjectStore; readonly now: string; readonly limit?: number }) {
  const scopes = await listActiveWorkspaceScopes(input.sql, input.limit);
  const drill = new ProductionBackupRestoreDrill(input.sql, input.objects, backupAuthenticatorFromEnvironment());
  const results = [];
  for (const [index, scope] of scopes.entries()) {
    const backupId = `scheduled-${Date.parse(input.now)}-${index}`;
    const backup = await drill.createWorkspaceBackup({ ...scope, backupId, createdAt: input.now });
    results.push(Object.freeze({ ...scope, backupId, objectKey: backup.objectKey }));
  }
  return Object.freeze(results);
}

export async function runScheduledRestoreDrills(input: { readonly sql: TransactionalSqlDriver; readonly objects: DurableObjectStore; readonly now: string; readonly limit?: number }) {
  const scopes = await listActiveWorkspaceScopes(input.sql, input.limit);
  const drill = new ProductionBackupRestoreDrill(input.sql, input.objects, backupAuthenticatorFromEnvironment());
  const results = [];
  for (const [index, scope] of scopes.entries()) {
    const drillId = `scheduled_${Date.parse(input.now)}_${index}`;
    const result = await drill.runLatestRestoreDrill({ ...scope, drillId, restoredAt: input.now });
    results.push(Object.freeze({ ...scope, drillId, ...result }));
  }
  return Object.freeze(results);
}

export async function runScheduledOutbox(input: { readonly sql: TransactionalSqlDriver; readonly now: string; readonly workerId: string; readonly limit?: number }) {
  const endpoint = process.env.PLATFORM_OUTBOX_WEBHOOK_URL?.trim();
  const encoded = process.env.PLATFORM_OUTBOX_HMAC_KEY_BASE64?.trim();
  if (!endpoint || !encoded) throw new Error("Platform outbox delivery is not configured.");
  const sink = new WebhookOutboxSink({ endpoint, secret: new Uint8Array(Buffer.from(encoded, "base64")) });
  return new SqlOutboxDispatcher(input.sql, sink).dispatchBatch({ workerId: input.workerId, now: input.now, ...(input.limit ? { limit: input.limit } : {}) });
}
