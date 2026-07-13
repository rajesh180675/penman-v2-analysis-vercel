import {
  getAuditGovernanceConfig,
  getRunAccessToken,
  hashAuditToken,
  isAuditReadAuthorized,
  isAuditConfigured,
  sanitizePathSegment,
} from "./_lib.js";
import { evaluateRunHealth, getMonitorConfig, getMonitorReport, getRunTimeline } from "./_monitor-lib.js";

function isAuthorizedForRun(request, timeline) {
  const presented = getRunAccessToken(request);
  if (!presented) return false;
  const presentedHash = hashAuditToken(presented);
  return timeline.some((item) => item.runAccessHash && item.runAccessHash === presentedHash);
}

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

  const runId = typeof request.query?.runId === "string" ? sanitizePathSegment(request.query.runId) : null;
  if (!runId) {
    response.status(400).json({ error: "runId is required." });
    return;
  }

  const run = await getRunTimeline(runId, 80);
  if (!run.timeline.length && run.counts.events === 0 && run.counts.inputs === 0 && run.counts.artifacts === 0) {
    response.status(404).json({ error: "Run not found." });
    return;
  }

  const adminAuthorized = isAuditReadAuthorized(request);
  if (!adminAuthorized && !isAuthorizedForRun(request, run.timeline)) {
    response.status(401).json({ error: "Unauthorized run inspector access." });
    return;
  }

  const health = evaluateRunHealth(run, getMonitorConfig());
  const persistedMonitorReport = await getMonitorReport(runId).catch(() => null);
  const governance = getAuditGovernanceConfig();
  const retentionCutoff = Date.now() - governance.retentionDays * 24 * 60 * 60 * 1_000;
  const expiredVisibleCount = [...run.inputs, ...run.artifacts]
    .filter((item) => new Date(item.uploadedAt).getTime() < retentionCutoff).length;

  response.status(200).json({
    ok: true,
    runId,
    latestAt: run.latestAt,
    counts: run.counts,
    inputs: run.inputs,
    artifacts: run.artifacts,
    timeline: run.timeline.slice(0, 20).map(({ runAccessHash, ...item }) => item),
    latestAnalysisSnapshot: run.latestAnalysisSnapshot,
    latestMarketSnapshot: run.latestMarketSnapshot,
    latestValuationSignal: run.latestValuationSignal,
    latestValuationManifest: run.latestValuationManifest,
    latestValuationAlert: run.latestValuationAlert,
    health,
    persistedMonitorReport,
    governance,
    retentionHealth: {
      status: expiredVisibleCount > 0 ? "warning" : "scheduled",
      mode: "vercel-cron",
      lastCheckedAt: persistedMonitorReport?.generatedAt ?? null,
      expiredRunCount: 0,
      expiredArtifactCount: expiredVisibleCount,
      orphanCount: 0,
      summary: expiredVisibleCount > 0
        ? `${expiredVisibleCount} visible blob(s) are older than the ${governance.retentionDays}-day policy and should be removed by the next cron pass.`
        : `Vercel cron enforces the ${governance.retentionDays}-day policy and one-day orphan grace period.`,
    },
  });
}
