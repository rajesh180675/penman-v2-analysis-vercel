import { reproducibilityHash } from "../../lib/evidenceLocking";

export const BACKUP_MANIFEST_SCHEMA_VERSION = "2026-07-platform-backup-v1" as const;

export interface BackupEntry {
  readonly key: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface BackupManifestEntry {
  readonly key: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly contentHash: `sha256:${string}`;
}

export interface BackupAuthentication {
  readonly algorithm: "hmac-sha256";
  readonly keyId: string;
  readonly signature: string;
}

export interface BackupAuthenticator {
  readonly keyId: string;
  sign(manifestHash: string): Promise<BackupAuthentication>;
  verify(manifestHash: string, authentication: BackupAuthentication): Promise<boolean>;
}

export interface BackupPackage {
  readonly manifest: {
    readonly schemaVersion: typeof BACKUP_MANIFEST_SCHEMA_VERSION;
    readonly backupId: string;
    readonly organizationId: string;
    readonly workspaceId: string;
    readonly createdAt: string;
    readonly entries: readonly BackupManifestEntry[];
    readonly manifestHash: `sha256:${string}`;
    readonly authentication: BackupAuthentication;
  };
  readonly entries: readonly BackupEntry[];
}

async function hashBytes(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function createBackupPackage(input: {
  readonly backupId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly entries: readonly BackupEntry[];
  readonly authenticator: BackupAuthenticator;
}): Promise<BackupPackage> {
  const sorted = [...input.entries].sort((left, right) => left.key.localeCompare(right.key));
  if (new Set(sorted.map((entry) => entry.key)).size !== sorted.length) throw new Error("Backup entry keys must be unique.");
  const entries = await Promise.all(sorted.map(async (entry) => Object.freeze({
    key: entry.key, mediaType: entry.mediaType, byteLength: entry.bytes.byteLength, contentHash: await hashBytes(entry.bytes),
  })));
  if (sorted.some((entry) => !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(entry.key) || entry.key.includes("..") || entry.key.startsWith("/"))) throw new Error("Backup entry keys must be safe relative object keys.");
  const core = { schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION, backupId: input.backupId, organizationId: input.organizationId, workspaceId: input.workspaceId, createdAt: input.createdAt, entries };
  const manifestHash = `sha256:${await reproducibilityHash(core)}` as const;
  const authentication = await input.authenticator.sign(manifestHash);
  return Object.freeze({
    manifest: Object.freeze({ ...core, entries: Object.freeze(entries), manifestHash, authentication: Object.freeze(authentication) }),
    entries: Object.freeze(sorted.map((entry) => Object.freeze({ ...entry, bytes: new Uint8Array(entry.bytes) }))),
  });
}

export interface RestoreSink {
  restoreAtomically(entries: readonly BackupEntry[]): Promise<void>;
}

export async function verifyAndRestoreBackup(
  backup: BackupPackage,
  sink: RestoreSink,
  authenticator: BackupAuthenticator,
): Promise<{ readonly status: "restored" | "blocked"; readonly restoredCount: number; readonly errors: readonly string[] }> {
  const { manifestHash: _manifestHash, authentication: _authentication, ...core } = backup.manifest;
  const expectedManifestHash = `sha256:${await reproducibilityHash(core)}`;
  const errors: string[] = [];
  if (expectedManifestHash !== backup.manifest.manifestHash) errors.push("MANIFEST_HASH_MISMATCH");
  if (!await authenticator.verify(backup.manifest.manifestHash, backup.manifest.authentication)) errors.push("MANIFEST_AUTHENTICATION_FAILED");
  const payloadKeys = backup.entries.map((entry) => entry.key);
  if (new Set(payloadKeys).size !== payloadKeys.length) errors.push("DUPLICATE_PAYLOAD_KEYS");
  const manifestKeys = new Set(backup.manifest.entries.map((entry) => entry.key));
  for (const key of payloadKeys) if (!manifestKeys.has(key)) errors.push(`UNMANIFESTED_ENTRY:${key}`);
  if (backup.entries.length !== backup.manifest.entries.length) errors.push("ENTRY_COUNT_MISMATCH");
  const payloadByKey = new Map(backup.entries.map((entry) => [entry.key, entry]));
  for (const manifestEntry of backup.manifest.entries) {
    const payload = payloadByKey.get(manifestEntry.key);
    if (!payload) { errors.push(`ENTRY_MISSING:${manifestEntry.key}`); continue; }
    if (payload.mediaType !== manifestEntry.mediaType) errors.push(`ENTRY_MEDIA_TYPE_MISMATCH:${manifestEntry.key}`);
    if (payload.bytes.byteLength !== manifestEntry.byteLength || await hashBytes(payload.bytes) !== manifestEntry.contentHash) errors.push(`ENTRY_HASH_MISMATCH:${manifestEntry.key}`);
  }
  if (errors.length) return Object.freeze({ status: "blocked", restoredCount: 0, errors: Object.freeze(errors) });
  const verifiedEntries = backup.manifest.entries.map((manifestEntry) => {
    const payload = payloadByKey.get(manifestEntry.key)!;
    return Object.freeze({ key: manifestEntry.key, mediaType: manifestEntry.mediaType, bytes: new Uint8Array(payload.bytes) });
  });
  await sink.restoreAtomically(Object.freeze(verifiedEntries));
  return Object.freeze({ status: "restored", restoredCount: verifiedEntries.length, errors: [] });
}

function hex(bytes: Uint8Array): string { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function fromHex(value: string): Uint8Array { return new Uint8Array(value.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []); }

export class HmacSha256BackupAuthenticator implements BackupAuthenticator {
  constructor(readonly keyId: string, private readonly secret: Uint8Array) {
    if (secret.byteLength < 32) throw new Error("Backup authentication keys must contain at least 256 bits.");
  }

  private importKey() {
    return crypto.subtle.importKey("raw", this.secret as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  }

  async sign(manifestHash: string): Promise<BackupAuthentication> {
    const key = await this.importKey();
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifestHash));
    return Object.freeze({ algorithm: "hmac-sha256", keyId: this.keyId, signature: hex(new Uint8Array(signature)) });
  }

  async verify(manifestHash: string, authentication: BackupAuthentication): Promise<boolean> {
    if (authentication.algorithm !== "hmac-sha256" || authentication.keyId !== this.keyId || !/^[a-f0-9]{64}$/.test(authentication.signature)) return false;
    const key = await this.importKey();
    return crypto.subtle.verify("HMAC", key, fromHex(authentication.signature) as BufferSource, new TextEncoder().encode(manifestHash));
  }
}
