import type { AnalysisContentKind, ContentRef, Sha256ContentId } from "../../engine/analysisRun";
import { parseWorkspaceAccessContext, parseWorkspaceScope, type WorkspaceAccessContext, type WorkspaceScope } from "../workspaceScope";
import type { ArtifactMetadata, ArtifactPayload, ArtifactRepository } from "./contracts";
import { parseArtifactBytes, parseArtifactMetadata, parseContentRef, parsePurgeAsOf } from "./validation";

interface StoredArtifact {
  readonly ref: ContentRef;
  readonly metadata: ArtifactMetadata;
  readonly bytes: Uint8Array;
  readonly retentionHolds: Set<string>;
}

function scopeKey(scope: WorkspaceScope): string {
  return `${scope.organizationId}\u0000${scope.workspaceId}`;
}

function refKey(ref: ContentRef): string {
  return `${ref.contentHash}\u0000${ref.kind}\u0000${ref.schemaVersion}\u0000${ref.mediaType}`;
}

async function sha256(bytes: Uint8Array): Promise<Sha256ContentId> {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 Web Crypto is unavailable in this runtime.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function clonePayload<TKind extends AnalysisContentKind>(stored: StoredArtifact): ArtifactPayload<TKind> {
  return Object.freeze({
    ref: stored.ref as ContentRef<TKind>,
    metadata: stored.metadata as ArtifactMetadata<TKind>,
    bytes: new Uint8Array(stored.bytes),
  });
}

/** Content-addressed reference adapter with strict workspace partitions. */
export class InMemoryArtifactRepository implements ArtifactRepository {
  readonly #partitions = new Map<string, Map<string, StoredArtifact>>();

  async put<TKind extends AnalysisContentKind>(
    unsafeContext: WorkspaceAccessContext,
    unsafeBytes: Uint8Array,
    unsafeMetadata: ArtifactMetadata<TKind>,
  ): Promise<ContentRef<TKind>> {
    const context = parseWorkspaceAccessContext(unsafeContext);
    const bytes = parseArtifactBytes(unsafeBytes);
    const metadata = parseArtifactMetadata(unsafeMetadata);
    const contentHash = await sha256(bytes);
    const ref = Object.freeze({
      kind: metadata.kind,
      contentHash,
      mediaType: metadata.mediaType,
      byteLength: bytes.byteLength,
      schemaVersion: metadata.schemaVersion,
    }) as ContentRef<TKind>;
    const key = scopeKey(context.scope);
    const partition = this.#partitions.get(key) ?? new Map<string, StoredArtifact>();
    this.#partitions.set(key, partition);
    const identity = refKey(ref);
    const existing = partition.get(identity);
    if (existing) return existing.ref as ContentRef<TKind>;
    partition.set(identity, Object.freeze({ ref, metadata, bytes: new Uint8Array(bytes), retentionHolds: new Set<string>() }));
    return ref;
  }

  async get<TKind extends AnalysisContentKind>(
    unsafeScope: WorkspaceScope,
    unsafeRef: ContentRef<TKind>,
  ): Promise<ArtifactPayload<TKind> | null> {
    const scope = parseWorkspaceScope(unsafeScope);
    const ref = parseContentRef(unsafeRef);
    const stored = this.#partitions.get(scopeKey(scope))?.get(refKey(ref));
    if (!stored || stored.ref.byteLength !== ref.byteLength) return null;
    // Verify bytes on every read so an adapter cannot return corrupted content.
    if (await sha256(stored.bytes) !== ref.contentHash) return null;
    return clonePayload<TKind>(stored);
  }

  async applyRetentionHold(
    unsafeContext: WorkspaceAccessContext,
    unsafeRefs: readonly ContentRef[],
    unsafeHoldId: string,
  ): Promise<void> {
    const context = parseWorkspaceAccessContext(unsafeContext);
    const holdId = unsafeHoldId?.trim();
    if (!holdId || holdId.length > 128) throw new Error("holdId must contain 1-128 characters.");
    const refs = unsafeRefs.map((ref) => parseContentRef(ref));
    const partition = this.#partitions.get(scopeKey(context.scope));
    const stored = refs.map((ref) => partition?.get(refKey(ref)) ?? null);
    if (stored.some((artifact) => artifact === null)) throw new Error("A retention hold cannot reference a missing artifact.");
    for (const artifact of stored) artifact!.retentionHolds.add(holdId);
  }

  async purgeExpired(
    unsafeContext: WorkspaceAccessContext,
    unsafeAsOf: string,
    limit = 100,
  ): Promise<readonly ContentRef[]> {
    const context = parseWorkspaceAccessContext(unsafeContext);
    const asOf = parsePurgeAsOf(unsafeAsOf);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error("Purge limit must be an integer between 1 and 1000.");
    const partition = this.#partitions.get(scopeKey(context.scope));
    if (!partition) return [];
    const expired = [...partition.entries()]
      .filter(([, stored]) => stored.retentionHolds.size === 0 && stored.metadata.retentionUntil !== null && stored.metadata.retentionUntil <= asOf)
      .sort(([, left], [, right]) => left.metadata.retentionUntil!.localeCompare(right.metadata.retentionUntil!))
      .slice(0, limit);
    for (const [key] of expired) partition.delete(key);
    return Object.freeze(expired.map(([, stored]) => stored.ref));
  }
}

export function createInMemoryArtifactRepository(): ArtifactRepository {
  return new InMemoryArtifactRepository();
}
