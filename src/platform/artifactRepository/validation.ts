import type { AnalysisContentKind, ContentRef, Sha256ContentId } from "../../engine/analysisRun";
import type { ArtifactMetadata } from "./contracts";

export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

const KINDS: readonly AnalysisContentKind[] = [
  "fact-set", "policy-bundle", "model-catalog", "family-analysis", "analysis-window",
  "market-snapshot", "assumption-set", "forecast-case", "model-result", "synthesis",
  "publication", "diagnostic", "evidence",
];
const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const HASH = /^sha256:[0-9a-f]{64}$/;

export class ArtifactRepositoryValidationError extends Error {
  readonly code = "ARTIFACT_INPUT_INVALID" as const;
  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ArtifactRepositoryValidationError";
  }
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /\p{C}/u.test(value)) {
    throw new ArtifactRepositoryValidationError(field, `must be non-empty text of at most ${maximum} characters`);
  }
  return value;
}

function instant(value: unknown, field: string): string {
  const parsed = text(value, field, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(parsed) || !Number.isFinite(Date.parse(parsed))) {
    throw new ArtifactRepositoryValidationError(field, "must be an ISO-8601 timestamp");
  }
  return parsed;
}

export function parseArtifactBytes(value: unknown): Uint8Array {
  // `instanceof` is not reliable across the jsdom/browser worker realm
  // boundary. Validate the typed-array internal shape without accepting wider
  // integer views or DataView.
  if (!ArrayBuffer.isView(value) || !("BYTES_PER_ELEMENT" in value) || value.BYTES_PER_ELEMENT !== 1) {
    throw new ArtifactRepositoryValidationError("bytes", "must be Uint8Array");
  }
  if (value.byteLength === 0) throw new ArtifactRepositoryValidationError("bytes", "must not be empty");
  if (value.byteLength > MAX_ARTIFACT_BYTES) {
    throw new ArtifactRepositoryValidationError("bytes", `must not exceed ${MAX_ARTIFACT_BYTES} bytes`);
  }
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

export function parseArtifactMetadata<TKind extends AnalysisContentKind>(value: ArtifactMetadata<TKind>): ArtifactMetadata<TKind> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ArtifactRepositoryValidationError("metadata", "must be an object");
  }
  const allowed = new Set(["kind", "schemaVersion", "mediaType", "contentClass", "createdAt", "issuerId", "retentionUntil"]);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra) throw new ArtifactRepositoryValidationError(`metadata.${extra}`, "field is not permitted");
  if (!KINDS.includes(value.kind)) throw new ArtifactRepositoryValidationError("metadata.kind", "is not a supported content kind");
  const createdAt = instant(value.createdAt, "metadata.createdAt");
  const retentionUntil = value.retentionUntil === null ? null : instant(value.retentionUntil, "metadata.retentionUntil");
  if (retentionUntil !== null && Date.parse(retentionUntil) < Date.parse(createdAt)) {
    throw new ArtifactRepositoryValidationError("metadata.retentionUntil", "must not precede createdAt");
  }
  const issuerId = value.issuerId === null ? null : text(value.issuerId, "metadata.issuerId", 128);
  if (issuerId !== null && !IDENTIFIER.test(issuerId)) {
    throw new ArtifactRepositoryValidationError("metadata.issuerId", "contains unsupported characters");
  }
  return Object.freeze({
    kind: value.kind,
    schemaVersion: text(value.schemaVersion, "metadata.schemaVersion", 128),
    mediaType: text(value.mediaType, "metadata.mediaType", 128),
    contentClass: text(value.contentClass, "metadata.contentClass", 128),
    createdAt,
    issuerId,
    retentionUntil,
  });
}

export function parseContentRef<TKind extends AnalysisContentKind>(value: ContentRef<TKind>): ContentRef<TKind> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ArtifactRepositoryValidationError("ref", "must be an object");
  }
  if (!KINDS.includes(value.kind)) throw new ArtifactRepositoryValidationError("ref.kind", "is unsupported");
  if (!HASH.test(value.contentHash)) throw new ArtifactRepositoryValidationError("ref.contentHash", "must be a lowercase SHA-256 content ID");
  if (!Number.isInteger(value.byteLength) || value.byteLength < 0 || value.byteLength > MAX_ARTIFACT_BYTES) {
    throw new ArtifactRepositoryValidationError("ref.byteLength", "is outside the supported range");
  }
  return Object.freeze({
    kind: value.kind,
    contentHash: value.contentHash as Sha256ContentId,
    mediaType: text(value.mediaType, "ref.mediaType", 128),
    byteLength: value.byteLength,
    schemaVersion: text(value.schemaVersion, "ref.schemaVersion", 128),
  });
}

export function parsePurgeAsOf(value: string): string {
  return instant(value, "asOf");
}
