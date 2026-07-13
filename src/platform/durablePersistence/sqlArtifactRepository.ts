import type { AnalysisContentKind, ContentRef, Sha256ContentId } from "../../engine/analysisRun";
import type { ArtifactMetadata, ArtifactPayload, ArtifactRepository } from "../artifactRepository";
import { parseArtifactBytes, parseArtifactMetadata, parseContentRef, parsePurgeAsOf } from "../artifactRepository/validation";
import { parsePlatformIdentifier, parseWorkspaceAccessContext, parseWorkspaceScope, type WorkspaceAccessContext, type WorkspaceScope } from "../workspaceScope";
import type { DurableObjectStore, TransactionalSqlDriver } from "./contracts";

interface ArtifactRow extends Record<string, unknown> {
  readonly content_hash: Sha256ContentId;
  readonly kind: AnalysisContentKind;
  readonly schema_version: string;
  readonly media_type: string;
  readonly byte_length: number | string;
  readonly object_key: string;
  readonly content_class: string;
  readonly created_at: string | Date;
  readonly issuer_id: string | null;
  readonly retention_until: string | Date | null;
}

function iso(value: string | Date): string { return typeof value === "string" ? new Date(value).toISOString() : value.toISOString(); }

function refFromRow(row: ArtifactRow): ContentRef {
  return Object.freeze({ kind: row.kind, contentHash: row.content_hash, schemaVersion: row.schema_version, mediaType: row.media_type, byteLength: Number(row.byte_length) });
}

function metadataFromRow(row: ArtifactRow): ArtifactMetadata {
  return Object.freeze({ kind: row.kind, schemaVersion: row.schema_version, mediaType: row.media_type, contentClass: row.content_class, createdAt: iso(row.created_at), issuerId: row.issuer_id, retentionUntil: row.retention_until === null ? null : iso(row.retention_until) });
}

async function sha256(bytes: Uint8Array): Promise<Sha256ContentId> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function objectKey(scope: WorkspaceScope, ref: ContentRef): string {
  return ["platform", scope.organizationId, scope.workspaceId, "artifacts", ref.contentHash.slice(7, 9), ref.contentHash.slice(7), encodeURIComponent(ref.kind), encodeURIComponent(ref.schemaVersion), encodeURIComponent(ref.mediaType)].join("/");
}

const SELECT_ARTIFACT = `select content_hash, kind, schema_version, media_type, byte_length, object_key,
  content_class, created_at, issuer_id, retention_until from platform_artifacts`;

/** SQL metadata + durable object bytes repository with read-time hash verification. */
export class SqlArtifactRepository implements ArtifactRepository {
  constructor(private readonly driver: TransactionalSqlDriver, private readonly objects: DurableObjectStore) {}

  async put<TKind extends AnalysisContentKind>(contextValue: WorkspaceAccessContext, bytesValue: Uint8Array, metadataValue: ArtifactMetadata<TKind>): Promise<ContentRef<TKind>> {
    const context = parseWorkspaceAccessContext(contextValue);
    const bytes = parseArtifactBytes(bytesValue);
    const metadata = parseArtifactMetadata(metadataValue);
    const contentHash = await sha256(bytes);
    const ref = Object.freeze({ kind: metadata.kind, contentHash, schemaVersion: metadata.schemaVersion, mediaType: metadata.mediaType, byteLength: bytes.byteLength }) as ContentRef<TKind>;
    const key = objectKey(context.scope, ref);
    await this.objects.putIfAbsent(key, bytes, { contentType: metadata.mediaType, contentHash });
    await this.driver.query(
      `insert into platform_artifacts
        (organization_id, workspace_id, content_hash, kind, schema_version, media_type, byte_length, object_key, content_class, issuer_id, created_at, retention_until)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (organization_id, workspace_id, content_hash, kind, schema_version, media_type) do nothing`,
      [context.scope.organizationId, context.scope.workspaceId, ref.contentHash, ref.kind, ref.schemaVersion, ref.mediaType, ref.byteLength, key, metadata.contentClass, metadata.issuerId, metadata.createdAt, metadata.retentionUntil],
    );
    return ref;
  }

  async get<TKind extends AnalysisContentKind>(scopeValue: WorkspaceScope, refValue: ContentRef<TKind>): Promise<ArtifactPayload<TKind> | null> {
    const scope = parseWorkspaceScope(scopeValue);
    const ref = parseContentRef(refValue);
    const result = await this.driver.query<ArtifactRow>(
      `${SELECT_ARTIFACT} where organization_id = $1 and workspace_id = $2 and content_hash = $3 and kind = $4 and schema_version = $5 and media_type = $6`,
      [scope.organizationId, scope.workspaceId, ref.contentHash, ref.kind, ref.schemaVersion, ref.mediaType],
    );
    const row = result.rows[0];
    if (!row || Number(row.byte_length) !== ref.byteLength) return null;
    const bytes = await this.objects.get(row.object_key);
    if (!bytes || bytes.byteLength !== ref.byteLength || await sha256(bytes) !== ref.contentHash) return null;
    return Object.freeze({ ref: refFromRow(row) as ContentRef<TKind>, metadata: metadataFromRow(row) as ArtifactMetadata<TKind>, bytes: new Uint8Array(bytes) });
  }

  async applyRetentionHold(contextValue: WorkspaceAccessContext, refsValue: readonly ContentRef[], holdIdValue: string): Promise<void> {
    const context = parseWorkspaceAccessContext(contextValue);
    const holdId = parsePlatformIdentifier(holdIdValue, "holdId");
    const refs = refsValue.map((ref) => parseContentRef(ref));
    await this.driver.transaction(async (tx) => {
      for (const ref of refs) {
        const existing = await tx.query(
          `select 1 from platform_artifacts where organization_id = $1 and workspace_id = $2 and content_hash = $3 and kind = $4 and schema_version = $5 and media_type = $6 for update`,
          [context.scope.organizationId, context.scope.workspaceId, ref.contentHash, ref.kind, ref.schemaVersion, ref.mediaType],
        );
        if (existing.rowCount !== 1) throw new Error("A retention hold cannot reference a missing artifact.");
        await tx.query(
          `insert into platform_artifact_holds (organization_id, workspace_id, content_hash, kind, schema_version, media_type, hold_id)
           values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
          [context.scope.organizationId, context.scope.workspaceId, ref.contentHash, ref.kind, ref.schemaVersion, ref.mediaType, holdId],
        );
      }
    });
  }

  async purgeExpired(contextValue: WorkspaceAccessContext, asOfValue: string, limit = 100): Promise<readonly ContentRef[]> {
    const context = parseWorkspaceAccessContext(contextValue);
    const asOf = parsePurgeAsOf(asOfValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error("Purge limit must be between 1 and 1000.");
    const rows = await this.driver.transaction(async (tx) => {
      const selected = await tx.query<ArtifactRow>(
        `${SELECT_ARTIFACT} a where a.organization_id = $1 and a.workspace_id = $2 and a.retention_until <= $3
         and not exists (select 1 from platform_artifact_holds h where h.organization_id = a.organization_id and h.workspace_id = a.workspace_id
           and h.content_hash = a.content_hash and h.kind = a.kind and h.schema_version = a.schema_version and h.media_type = a.media_type)
         order by a.retention_until asc limit $4 for update skip locked`,
        [context.scope.organizationId, context.scope.workspaceId, asOf, limit],
      );
      for (const row of selected.rows) {
        await tx.query(
          `delete from platform_artifacts where organization_id = $1 and workspace_id = $2 and content_hash = $3 and kind = $4 and schema_version = $5 and media_type = $6`,
          [context.scope.organizationId, context.scope.workspaceId, row.content_hash, row.kind, row.schema_version, row.media_type],
        );
      }
      return selected.rows;
    });
    await Promise.all(rows.map((row) => this.objects.delete(row.object_key)));
    return Object.freeze(rows.map(refFromRow));
  }
}
