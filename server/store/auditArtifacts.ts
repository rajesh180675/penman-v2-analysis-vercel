import * as crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  auditBlobPath,
  auditEventDir,
  listDirectoryFiles,
  readBuffer,
  readJson,
} from "./fsStore";

type ArtifactDescriptor = {
  filename?: string;
  pathname?: string | null;
  contentHash?: string;
  contentHashAlgorithm?: "sha256" | "fnv1a32-fallback";
  contentEncoding?: "gzip" | null;
  contentType?: string;
  uncompressedBytes?: number;
  storedBytes?: number;
};

function fnv1a32(buffer: Buffer): string {
  let hash = 0x811c9dc5;
  for (const byte of buffer) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function expectedDescriptor(runId: string, pathname: string, filename: string): Promise<ArtifactDescriptor | null> {
  const events = await listDirectoryFiles(auditEventDir(runId));
  for (const file of events.reverse()) {
    const event = await readJson<{ eventType?: string; payload?: { artifact?: ArtifactDescriptor } }>(file);
    const artifact = event?.eventType === "analysis-snapshot" ? event.payload?.artifact : null;
    if (!artifact) continue;
    if (artifact.pathname === pathname || artifact.filename === filename) return artifact;
  }
  return null;
}

export function localArtifactFilename(runId: string, pathname: string): string | null {
  const normalized = pathname.replace(/\\/g, "/");
  const prefix = `audit/artifacts/${runId}/`;
  if (!normalized.startsWith(prefix)) return null;
  const filename = normalized.slice(prefix.length);
  if (!filename || filename.includes("/") || filename.includes("..") || filename.length >= 128) return null;
  return filename;
}

export async function readAndVerifyLocalArtifact(runId: string, pathname: string) {
  const filename = localArtifactFilename(runId, pathname);
  if (!filename) return null;
  const filePath = auditBlobPath(runId, "artifacts", filename);
  const stored = await readBuffer(filePath);
  if (!stored) return null;
  const meta = await readJson<{
    contentType?: string;
    contentEncoding?: string | null;
    uploadedAt?: string;
    size?: number;
  }>(`${filePath}.meta.json`);
  const descriptor = await expectedDescriptor(runId, pathname, filename);
  const encoding = descriptor?.contentEncoding ?? meta?.contentEncoding ?? (filename.endsWith(".gz") ? "gzip" : null);
  let decoded: Buffer;
  try {
    decoded = encoding === "gzip" ? gunzipSync(stored) : stored;
  } catch {
    return {
      stored,
      meta,
      descriptor,
      verification: { status: "invalid-compression", expectedHash: descriptor?.contentHash ?? null, actualHash: null },
      snapshotSummary: null,
    };
  }
  const algorithm = descriptor?.contentHashAlgorithm ?? "sha256";
  const actualHash = algorithm === "fnv1a32-fallback"
    ? fnv1a32(decoded)
    : crypto.createHash("sha256").update(decoded).digest("hex");
  const expectedHash = descriptor?.contentHash ?? null;
  let parsed: Record<string, unknown> | null = null;
  try {
    const value = JSON.parse(decoded.toString("utf8"));
    parsed = value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    parsed = null;
  }
  return {
    stored,
    meta,
    descriptor,
    verification: {
      status: !expectedHash ? "unverifiable" : expectedHash === actualHash ? "verified" : "mismatch",
      expectedHash,
      actualHash,
      algorithm,
      decodedBytes: decoded.byteLength,
      parsed: parsed !== null,
    },
    snapshotSummary: parsed ? {
      schemaVersion: parsed.schemaVersion ?? null,
      companyId: parsed.companyId ?? null,
      family: parsed.family ?? null,
      periodCount: parsed.periodCount ?? null,
      latestPeriod: parsed.latestPeriod ?? null,
      policyVersions: parsed.policyVersions ?? null,
    } : null,
  };
}
