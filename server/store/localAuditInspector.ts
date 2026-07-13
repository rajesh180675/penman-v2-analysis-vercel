import * as path from "node:path";
import {
  auditBlobDir,
  auditEventDir,
  auditRunPath,
  listDirectoryFiles,
  pathModifiedAt,
  readJson,
} from "./fsStore";
import { getLastLocalAuditCleanupReport } from "./auditLifecycle";

function summarizePayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") summary[key] = value.length > 300 ? `${value.slice(0, 300)}…` : value;
    else if (Array.isArray(value)) summary[key] = { count: value.length };
    else if (value && typeof value === "object") summary[key] = { keys: Object.keys(value).slice(0, 20) };
    else summary[key] = value;
  }
  return summary;
}

type LocalEvent = {
  eventId?: string;
  runId?: string;
  eventType?: string;
  companyId?: string | null;
  sourceMode?: string | null;
  payload?: unknown;
  timestamp?: string;
  createdAt?: string;
  runAccessHash?: string | null;
  contentClass?: string | null;
  retentionDays?: number | null;
};

async function listBlobs(runId: string, kind: "inputs" | "artifacts") {
  const dir = auditBlobDir(runId, kind);
  const files = (await listDirectoryFiles(dir)).filter((file) => !file.endsWith(".meta.json"));
  const items = await Promise.all(files.map(async (file) => {
    const meta = await readJson<{
      uploadedAt?: string;
      size?: number;
      contentType?: string;
      contentEncoding?: string | null;
      eventType?: string;
    }>(`${file}.meta.json`);
    return {
      pathname: `audit/${kind}/${runId}/${path.basename(file)}`,
      uploadedAt: meta?.uploadedAt ?? await pathModifiedAt(file) ?? new Date(0).toISOString(),
      size: meta?.size ?? 0,
      contentType: meta?.contentType ?? "application/octet-stream",
      contentEncoding: meta?.contentEncoding ?? null,
      eventType: meta?.eventType ?? null,
    };
  }));
  return items.sort((left, right) => new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime());
}

export async function buildLocalInspectorPayload(runId: string) {
  const eventFiles = await listDirectoryFiles(auditEventDir(runId));
  const events = (await Promise.all(eventFiles.filter((file) => file.endsWith(".json")).map((file) => readJson<LocalEvent>(file))))
    .filter((event): event is LocalEvent => Boolean(event))
    .sort((left, right) => new Date(right.createdAt ?? right.timestamp ?? 0).getTime() - new Date(left.createdAt ?? left.timestamp ?? 0).getTime());
  const inputs = await listBlobs(runId, "inputs");
  const artifacts = await listBlobs(runId, "artifacts");
  const run = await readJson<{
    companyId?: string;
    sourceMode?: string;
    contentClass?: string;
    retentionDays?: number;
  }>(auditRunPath(runId));
  const latestByType = (eventType: string) => events.find((event) => event.eventType === eventType)?.payload ?? null;
  const timeline = events.slice(0, 20).map((event) => ({
    pathname: `audit/events/${runId}/${event.eventId ?? "event"}.json`,
    uploadedAt: event.createdAt ?? event.timestamp ?? new Date(0).toISOString(),
    createdAt: event.createdAt ?? event.timestamp ?? new Date(0).toISOString(),
    eventType: event.eventType ?? "event",
    companyId: event.companyId ?? null,
    sourceMode: event.sourceMode ?? null,
    payloadSummary: summarizePayload(event.payload),
  }));
  const findings: string[] = [];
  const recommendations: string[] = [];
  if (!events.length) findings.push("No persisted audit events were found for this run.");
  if (!inputs.length) findings.push("No persisted source input was found for this run.");
  if (!artifacts.length) findings.push("No persisted analysis artifact was found for this run.");
  if (!artifacts.length) recommendations.push("Allow the analysis snapshot artifact to finish persisting, then refresh the inspector.");
  const cleanup = getLastLocalAuditCleanupReport();

  return {
    ok: true,
    runId,
    latestAt: timeline[0]?.createdAt ?? artifacts[0]?.uploadedAt ?? inputs[0]?.uploadedAt ?? null,
    counts: { events: events.length, inputs: inputs.length, artifacts: artifacts.length },
    inputs: inputs.slice(0, 10),
    artifacts: artifacts.slice(0, 10),
    timeline,
    latestAnalysisSnapshot: latestByType("analysis-snapshot"),
    latestMarketSnapshot: latestByType("market-data-refreshed"),
    latestValuationSignal: latestByType("valuation-signal-updated"),
    latestValuationManifest: latestByType("valuation-manifest-updated"),
    latestValuationAlert: latestByType("valuation-alert-triggered"),
    health: {
      severity: findings.length ? "warning" : "ok",
      findings: findings.length ? findings : ["Local audit event and artifact persistence are healthy."],
      recommendations,
      derived: {
        hasAnalysisReady: events.some((event) => event.eventType === "run-status-analysis-ready"),
        hasArtifacts: artifacts.length > 0,
        hasInputs: inputs.length > 0,
      },
    },
    persistedMonitorReport: null,
    governance: {
      retentionDays: run?.retentionDays ?? 45,
      contentClass: run?.contentClass ?? "confidential-financial-statements",
      adminTokenVersion: "local",
    },
    retentionHealth: {
      status: cleanup ? "healthy" : "not-yet-checked",
      mode: "local-opportunistic",
      lastCheckedAt: cleanup?.checkedAt ?? null,
      expiredRunCount: cleanup?.expiredRuns.length ?? 0,
      expiredArtifactCount: cleanup?.expiredArtifacts.length ?? 0,
      orphanCount: cleanup?.orphanedDirectories.length ?? 0,
      summary: cleanup
        ? `Cleanup checked ${cleanup.expiredRuns.length} expired run(s), ${cleanup.expiredArtifacts.length} expired artifact(s), and ${cleanup.orphanedDirectories.length} orphan director${cleanup.orphanedDirectories.length === 1 ? "y" : "ies"}.`
        : "Cleanup will run opportunistically on the next audit request.",
    },
  };
}
