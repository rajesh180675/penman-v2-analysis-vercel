import type { AnalysisContentKind, ContentRef } from "../../engine/analysisRun";
import type { WorkspaceAccessContext, WorkspaceScope } from "../workspaceScope";

export interface ArtifactMetadata<TKind extends AnalysisContentKind = AnalysisContentKind> {
  readonly kind: TKind;
  readonly schemaVersion: string;
  readonly mediaType: string;
  readonly contentClass: string;
  readonly createdAt: string;
  readonly issuerId: string | null;
  readonly retentionUntil: string | null;
}

export interface ArtifactPayload<TKind extends AnalysisContentKind = AnalysisContentKind> {
  readonly ref: ContentRef<TKind>;
  readonly metadata: ArtifactMetadata<TKind>;
  readonly bytes: Uint8Array;
}

export interface ArtifactRepository {
  put<TKind extends AnalysisContentKind>(
    context: WorkspaceAccessContext,
    bytes: Uint8Array,
    metadata: ArtifactMetadata<TKind>,
  ): Promise<ContentRef<TKind>>;
  get<TKind extends AnalysisContentKind>(
    scope: WorkspaceScope,
    ref: ContentRef<TKind>,
  ): Promise<ArtifactPayload<TKind> | null>;
  applyRetentionHold(
    context: WorkspaceAccessContext,
    refs: readonly ContentRef[],
    holdId: string,
  ): Promise<void>;
  purgeExpired(
    context: WorkspaceAccessContext,
    asOf: string,
    limit?: number | undefined,
  ): Promise<readonly ContentRef[]>;
}
