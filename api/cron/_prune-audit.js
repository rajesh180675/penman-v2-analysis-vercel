import { del, get, list } from "@vercel/blob";
import {
  extractKindFromPath,
  extractRunIdFromPath,
  getAuditGovernanceConfig,
  isAuditConfigured,
  logAudit,
} from "../audit/_lib.js";
import { requireCronAuth } from "../audit/monitor-lib.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

async function listAll(prefix) {
  const blobs = [];
  let cursor;
  let hasMore = true;
  while (hasMore) {
    const result = await list({ prefix, limit: 1000, mode: "expanded", ...(cursor ? { cursor } : {}) });
    blobs.push(...result.blobs);
    cursor = result.cursor;
    hasMore = result.hasMore;
  }
  return blobs;
}

async function retentionForRun(eventBlobs, fallback) {
  const latest = [...eventBlobs].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
  if (!latest) return fallback;
  try {
    const blob = await get(latest.pathname, { access: "private" });
    if (!blob || blob.statusCode !== 200 || !blob.stream) return fallback;
    const event = JSON.parse(await new Response(blob.stream).text());
    const days = Number(event?.retentionDays);
    return Number.isFinite(days) && days > 0 ? days : fallback;
  } catch {
    return fallback;
  }
}

export function classifyAuditPruneCandidate({ blob, now, retentionDays, hasEvents, orphanGraceDays = 1 }) {
  const ageMs = now - new Date(blob.uploadedAt).getTime();
  if (ageMs > retentionDays * DAY_MS) return "expired";
  const kind = extractKindFromPath(blob.pathname);
  if (!hasEvents && (kind === "artifacts" || kind === "inputs") && ageMs > orphanGraceDays * DAY_MS) return "orphan";
  return null;
}

export default async function handler(request, response) {
  if (!isAuditConfigured()) {
    response.status(503).json({ error: "Audit storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel." });
    return;
  }
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }
  if (!requireCronAuth(request, response)) return;

  const governance = getAuditGovernanceConfig();
  const now = Date.now();
  const auditBlobs = await listAll("audit-runs/");
  const byRun = new Map();
  for (const blob of auditBlobs) {
    const runId = extractRunIdFromPath(blob.pathname);
    if (!runId) continue;
    const group = byRun.get(runId) ?? [];
    group.push(blob);
    byRun.set(runId, group);
  }
  const deleted = [];
  for (const [runId, blobs] of byRun.entries()) {
    const eventBlobs = blobs.filter((blob) => extractKindFromPath(blob.pathname) === "events");
    const retentionDays = await retentionForRun(eventBlobs, governance.retentionDays);
    const candidates = blobs.map((blob) => ({
      blob,
      reason: classifyAuditPruneCandidate({ blob, now, retentionDays, hasEvents: eventBlobs.length > 0 }),
    })).filter((item) => item.reason);
    if (candidates.length) {
      await del(candidates.map((item) => item.blob.url));
      deleted.push(...candidates.map((item) => ({ runId, pathname: item.blob.pathname, uploadedAt: item.blob.uploadedAt, size: item.blob.size, reason: item.reason, retentionDays })));
    }
  }

  const monitorCutoff = now - governance.retentionDays * DAY_MS;
  const monitorExpired = (await listAll("audit-monitor/")).filter((blob) => new Date(blob.uploadedAt).getTime() < monitorCutoff);
  if (monitorExpired.length) {
    await del(monitorExpired.map((blob) => blob.url));
    deleted.push(...monitorExpired.map((blob) => ({ pathname: blob.pathname, uploadedAt: blob.uploadedAt, size: blob.size, reason: "expired-monitor", retentionDays: governance.retentionDays })));
  }

  logAudit("retention.pruned", { deletedCount: deleted.length, retentionDays: governance.retentionDays });
  response.status(200).json({ ok: true, retentionDays: governance.retentionDays, deletedCount: deleted.length, deleted });
}
