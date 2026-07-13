import { canonicalize, reproducibilityHash } from "../../lib/evidenceLocking";
import type {
  AnalysisContentKind,
  ContentRef,
  DeepReadonly,
} from "./contracts";

/**
 * A payload emitted beside its storage-independent content reference.
 *
 * PR 1.2 does not choose a persistence adapter. Returning both pieces lets a
 * later browser-worker, CLI, or server adapter persist the exact bytes without
 * asking the legacy engines to execute again.
 */
export interface AnalysisContentArtifact<
  TKind extends AnalysisContentKind = AnalysisContentKind,
  TPayload = unknown,
> {
  readonly ref: ContentRef<TKind>;
  readonly payload: DeepReadonly<TPayload>;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function cloneAndFreeze<T>(value: T): DeepReadonly<T> {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as DeepReadonly<T>;
  }
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) clone[key] = cloneAndFreeze(nested);
    return Object.freeze(clone) as DeepReadonly<T>;
  }
  return value as DeepReadonly<T>;
}

/** Build a deterministic SHA-256 reference for a JSON-compatible payload. */
export async function createAnalysisContentArtifact<
  TKind extends AnalysisContentKind,
  TPayload,
>(params: {
  kind: TKind;
  schemaVersion: string;
  payload: TPayload;
  mediaType?: string | undefined;
}): Promise<AnalysisContentArtifact<TKind, TPayload>> {
  // Snapshot first: a caller may retain and later mutate a legacy output. The
  // bytes beside a ContentRef must remain the bytes that produced its digest.
  const payload = cloneAndFreeze(params.payload);
  const canonical = canonicalize(payload as unknown as Record<string, unknown>);
  const digest = await reproducibilityHash(payload as unknown as Record<string, unknown>);
  return {
    ref: {
      kind: params.kind,
      contentHash: `sha256:${digest}`,
      mediaType: params.mediaType ?? "application/json",
      byteLength: utf8ByteLength(canonical),
      schemaVersion: params.schemaVersion,
    },
    payload,
  };
}

/** Verify that an artifact payload still matches both its digest and byte stamp. */
export async function verifyAnalysisContentArtifact(
  artifact: AnalysisContentArtifact,
): Promise<boolean> {
  const canonical = canonicalize(artifact.payload as Record<string, unknown>);
  const digest = await reproducibilityHash(artifact.payload as Record<string, unknown>);
  return artifact.ref.contentHash === `sha256:${digest}`
    && artifact.ref.byteLength === utf8ByteLength(canonical);
}
