import { del, list } from "@vercel/blob";
import {
  getAuditGovernanceConfig,
  isAuditConfigured,
  logAudit,
} from "../audit/_lib.js";
import { requireCronAuth } from "../audit/monitor-lib.js";

export default async function handler(request, response) {
  if (!isAuditConfigured()) {
    response.status(503).json({
      error: "Audit storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.",
    });
    return;
  }

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!requireCronAuth(request, response)) return;

  const governance = getAuditGovernanceConfig();
  const cutoff = Date.now() - governance.retentionDays * 24 * 60 * 60 * 1000;
  const prefixes = ["audit-runs/", "audit-monitor/"];
  const deleted = [];

  for (const prefix of prefixes) {
    let cursor = undefined;
    let hasMore = true;

    while (hasMore) {
      const result = await list({
        prefix,
        limit: 1000,
        mode: "expanded",
        ...(cursor ? { cursor } : {}),
      });

      const expired = result.blobs.filter((blob) => new Date(blob.uploadedAt).getTime() < cutoff);
      if (expired.length > 0) {
        await del(expired.map((blob) => blob.url));
        deleted.push(...expired.map((blob) => ({
          pathname: blob.pathname,
          uploadedAt: blob.uploadedAt,
          size: blob.size,
        })));
      }

      cursor = result.cursor;
      hasMore = result.hasMore;
    }
  }

  logAudit("retention.pruned", {
    deletedCount: deleted.length,
    retentionDays: governance.retentionDays,
  });

  response.status(200).json({
    ok: true,
    retentionDays: governance.retentionDays,
    deletedCount: deleted.length,
    deleted,
  });
}
