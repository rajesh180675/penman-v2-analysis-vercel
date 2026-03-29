import { get, list, put } from "@vercel/blob";
import {
  extractEventTypeFromPath,
  extractKindFromPath,
  extractRunIdFromPath,
  getAuditReadToken,
  isAuditConfigured,
  sanitizePathSegment,
} from "./_lib.js";

function authHeaderMatches(request, expected) {
  const header = request.headers.authorization || request.headers.Authorization;
  return Boolean(expected) && header === `Bearer ${expected}`;
}

export function isMonitorEnabled() {
  return (process.env.AUDIT_MONITOR_ENABLED ?? "true").toLowerCase() !== "false";
}

export function getMonitorConfig() {
  return {
    lookbackLimit: Number(process.env.AUDIT_MONITOR_LOOKBACK_LIMIT || 25),
    stalledMinutes: Number(process.env.AUDIT_MONITOR_STALL_MINUTES || 5),
    analysisArtifactGraceMinutes: Number(process.env.AUDIT_MONITOR_ARTIFACT_GRACE_MINUTES || 3),
  };
}

export function requireMonitorAuth(request, response) {
  const adminToken = process.env.AUDIT_ADMIN_TOKEN;
  const cronSecret = process.env.CRON_SECRET;
  const auditToken = getAuditReadToken(request);

  if (adminToken && auditToken === adminToken) return true;
  if (authHeaderMatches(request, cronSecret)) return true;
  if (!adminToken && !cronSecret) return true;

  response.status(401).json({ error: "Unauthorized monitor access." });
  return false;
}

export function requireCronAuth(request, response) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  if (authHeaderMatches(request, cronSecret)) return true;
  response.status(401).json({ error: "Unauthorized cron invocation." });
  return false;
}

async function readBlobJson(pathname) {
  const blob = await get(pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  const text = await new Response(blob.stream).text();
  return JSON.parse(text);
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== "object") return payload ?? null;

  const summary = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      summary[key] = value.length > 250 ? `${value.slice(0, 250)}...` : value;
      continue;
    }
    if (Array.isArray(value)) {
      summary[key] = { count: value.length };
      continue;
    }
    if (value && typeof value === "object") {
      summary[key] = { keys: Object.keys(value).slice(0, 12) };
      continue;
    }
    summary[key] = value;
  }

  return summary;
}

function summarizeAnalysisSnapshot(payload) {
  if (!payload || typeof payload !== "object") return null;
  return {
    companyId: payload.companyId ?? null,
    latestPeriod: payload.latestPeriod ?? null,
    qualityGate: payload.qualityGate ?? null,
    policyVersions: payload.policyVersions ?? null,
    coverageSummary: payload.mappingAudit?.coverageSummary ?? null,
    traceability: payload.traceability ?? null,
    outOfSpecTop: Array.isArray(payload.mappingAudit?.outOfSpecLabels)
      ? payload.mappingAudit.outOfSpecLabels.slice(0, 10)
      : [],
  };
}

function minuteDiff(iso) {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

async function getRunTimeline(runId, limit = 40) {
  const result = await list({
    prefix: `audit-runs/${runId}/`,
    limit,
    mode: "expanded",
  });

  const blobs = [...result.blobs].sort((a, b) => {
    return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
  });

  const eventBlobs = blobs.filter((blob) => extractKindFromPath(blob.pathname) === "events");
  const artifactBlobs = blobs.filter((blob) => extractKindFromPath(blob.pathname) === "artifacts");
  const inputBlobs = blobs.filter((blob) => extractKindFromPath(blob.pathname) === "inputs");

  const timeline = [];
  let latestAnalysisSnapshot = null;
  for (const blob of eventBlobs.slice(0, Math.min(eventBlobs.length, 25))) {
    try {
      const parsed = await readBlobJson(blob.pathname);
      const analysisSnapshot = parsed?.eventType === "analysis-snapshot"
        ? summarizeAnalysisSnapshot(parsed?.payload)
        : null;
      if (analysisSnapshot && !latestAnalysisSnapshot) {
        latestAnalysisSnapshot = analysisSnapshot;
      }
      timeline.push({
        pathname: blob.pathname,
        uploadedAt: blob.uploadedAt,
        createdAt: parsed?.createdAt ?? blob.uploadedAt,
        eventType: parsed?.eventType ?? extractEventTypeFromPath(blob.pathname),
        companyId: parsed?.companyId ?? null,
        sourceMode: parsed?.sourceMode ?? null,
        payloadSummary: summarizePayload(parsed?.payload),
        analysisSnapshot,
      });
    } catch {
      timeline.push({
        pathname: blob.pathname,
        uploadedAt: blob.uploadedAt,
        createdAt: blob.uploadedAt,
        eventType: extractEventTypeFromPath(blob.pathname),
        companyId: null,
        sourceMode: null,
        payloadSummary: null,
      });
    }
  }

  return {
    runId,
    latestAt: timeline[0]?.createdAt ?? blobs[0]?.uploadedAt ?? null,
    counts: {
      events: eventBlobs.length,
      inputs: inputBlobs.length,
      artifacts: artifactBlobs.length,
    },
    inputs: inputBlobs.slice(0, 10).map((blob) => ({
      pathname: blob.pathname,
      uploadedAt: blob.uploadedAt,
      size: blob.size,
    })),
    artifacts: artifactBlobs.slice(0, 10).map((blob) => ({
      pathname: blob.pathname,
      uploadedAt: blob.uploadedAt,
      size: blob.size,
    })),
    timeline,
    latestAnalysisSnapshot,
  };
}

async function listRecentRunIds(limit) {
  const result = await list({
    prefix: "audit-runs/",
    limit: Math.max(limit * 6, limit),
    mode: "expanded",
  });

  const grouped = new Map();
  for (const blob of result.blobs) {
    const runId = extractRunIdFromPath(blob.pathname);
    if (!runId) continue;
    const existing = grouped.get(runId);
    if (!existing || new Date(blob.uploadedAt).getTime() > new Date(existing.latestAt).getTime()) {
      grouped.set(runId, { runId, latestAt: blob.uploadedAt });
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime())
    .slice(0, limit)
    .map((entry) => entry.runId);
}

function buildRecommendations({ hasError, hasAnalysisReady, hasArtifacts, hasInputs, latestError, qualityGate }) {
  const recommendations = [];

  if (hasError) {
    recommendations.push("Inspect the latest engine or ingestion error event for the failing run.");
    recommendations.push("Reproduce the run locally using the persisted input payload or uploaded file.");
  }
  if (hasInputs && !hasAnalysisReady) {
    recommendations.push("Check parser and pipeline status for a stalled run before analysis completed.");
  }
  if (hasAnalysisReady && !hasArtifacts) {
    recommendations.push("Check export/report generation because analysis completed without artifact persistence.");
  }
  if (latestError) {
    recommendations.push(`Triage error signature: ${latestError.slice(0, 180)}`);
  }
  if (qualityGate?.valuationBlocked) {
    recommendations.push("Resolve valuation-critical mapping gaps before trusting valuation outputs.");
  }
  if (qualityGate?.scopeAssessment?.blocked) {
    recommendations.push("Route this run to a financial-company-specific framework instead of the industrial engine.");
  }
  if (recommendations.length === 0) {
    recommendations.push("No immediate action required.");
  }

  return recommendations;
}

export function evaluateRunHealth(run, config = getMonitorConfig()) {
  const eventTypes = run.timeline.map((item) => item.eventType).filter(Boolean);
  const latestErrorEvent = run.timeline.find((item) => {
    return item.eventType === "engine-error" || item.eventType === "input-ingest-failed" || item.eventType === "run-status-error";
  });
  const latestError = latestErrorEvent?.payloadSummary?.error ?? null;
  const hasError = Boolean(latestErrorEvent);
  const hasAnalysisReady = eventTypes.includes("run-status-analysis-ready");
  const hasArtifacts = run.counts.artifacts > 0;
  const hasInputs = run.counts.inputs > 0;
  const ageMinutes = run.latestAt ? minuteDiff(run.latestAt) : null;
  const coverageSummary = run.latestAnalysisSnapshot?.coverageSummary ?? null;
  const qualityGate = run.latestAnalysisSnapshot?.qualityGate ?? null;
  const traceability = run.latestAnalysisSnapshot?.traceability ?? null;

  const findings = [];
  let severity = "ok";

  if (hasError) {
    severity = "critical";
    findings.push("Run emitted an ingest or engine error.");
  }

  if (!hasError && hasInputs && !hasAnalysisReady && ageMinutes !== null && ageMinutes >= config.stalledMinutes) {
    severity = "warning";
    findings.push(`Run appears stalled before analysis completion for ${Math.round(ageMinutes)} minutes.`);
  }

  if (!hasError && hasAnalysisReady && !hasArtifacts && ageMinutes !== null && ageMinutes >= config.analysisArtifactGraceMinutes) {
    severity = severity === "ok" ? "warning" : severity;
    findings.push("Analysis completed but no persisted report artifacts were found yet.");
  }

  if (coverageSummary?.unresolvedBySeverity?.critical?.length) {
    severity = "critical";
    findings.push(`Valuation-critical mapping gaps remain: ${coverageSummary.unresolvedBySeverity.critical.map((issue) => issue.title).join(", ")}.`);
  } else if (coverageSummary?.unresolvedBySeverity?.warning?.length) {
    if (severity === "ok") severity = "warning";
    findings.push(`Ratio-critical mapping gaps remain: ${coverageSummary.unresolvedBySeverity.warning.map((issue) => issue.title).join(", ")}.`);
  }

  if (qualityGate?.valuationBlocked && !hasError) {
    severity = severity === "ok" ? "warning" : severity;
    findings.push("Quality gate marked valuation as blocked for this run.");
  }
  if (qualityGate?.scopeAssessment?.blocked || traceability?.qualityGate?.scopeBlocked) {
    severity = "critical";
    findings.push("Dataset is outside the supported industrial-company scope.");
  }

  if (severity === "ok") {
    findings.push("Run completed without monitor-detected issues.");
  }

  return {
    severity,
    findings,
    recommendations: buildRecommendations({
      hasError,
      hasAnalysisReady,
      hasArtifacts,
      hasInputs,
      latestError,
      qualityGate,
    }),
    derived: {
      ageMinutes,
      hasError,
      hasAnalysisReady,
      hasArtifacts,
      hasInputs,
      latestError,
      qualityGate,
      policyVersions: run.latestAnalysisSnapshot?.policyVersions ?? null,
      traceability,
    },
  };
}

async function persistBlobJson(pathname, payload) {
  return put(pathname, JSON.stringify(payload, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function readExistingIssueRecord(runId) {
  try {
    return await readBlobJson(`audit-monitor/issues/${sanitizePathSegment(runId)}.json`);
  } catch {
    return null;
  }
}

async function maybeCreateGitHubIssue(report) {
  const token = process.env.GITHUB_MONITOR_TOKEN;
  const repo = process.env.GITHUB_MONITOR_REPO;
  if (!token || !repo) {
    return { created: false, reason: "github_not_configured" };
  }

  const existing = await readExistingIssueRecord(report.runId);
  if (existing?.issueUrl) {
    return { created: false, reason: "already_created", issueUrl: existing.issueUrl };
  }

  const title = `[audit-monitor] ${report.severity.toUpperCase()} run ${report.runId.slice(0, 8)} for ${report.companyId || "unknown-company"}`;
  const traceabilityJson = JSON.stringify(report.traceability ?? {}, null, 2);
  const body = [
    "Automated audit monitor detected a problematic run.",
    "",
    `Run ID: ${report.runId}`,
    `Severity: ${report.severity}`,
    `Company ID: ${report.companyId || "unknown"}`,
    `Source mode: ${report.sourceMode || "unknown"}`,
    `Latest at: ${report.latestAt || "unknown"}`,
    "",
    "Findings:",
    ...report.findings.map((item) => `- ${item}`),
    "",
    "Recommendations:",
    ...report.recommendations.map((item) => `- ${item}`),
    "",
    "Traceability:",
    "```json",
    traceabilityJson,
    "```",
    "",
    "Latest timeline:",
    ...report.timeline.slice(0, 5).map((item) => `- ${item.createdAt}: ${item.eventType}`),
  ].join("\n");

  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "penman-v2-audit-monitor",
    },
    body: JSON.stringify({
      title,
      body,
      labels: ["audit-monitor"],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      created: false,
      reason: `github_error:${response.status}`,
      detail: text.slice(0, 500),
    };
  }

  const issue = await response.json();
  const record = {
    createdAt: new Date().toISOString(),
    runId: report.runId,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    severity: report.severity,
  };
  await persistBlobJson(`audit-monitor/issues/${sanitizePathSegment(report.runId)}.json`, record);
  return {
    created: true,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
  };
}

async function persistMonitorReport(report) {
  const safeRunId = sanitizePathSegment(report.runId);
  await persistBlobJson(`audit-monitor/reports/${safeRunId}.json`, report);
}

export async function runAuditMonitor(options = {}) {
  if (!isAuditConfigured()) {
    throw new Error("Audit storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.");
  }
  if (!isMonitorEnabled()) {
    return { ok: true, disabled: true, reports: [] };
  }

  const config = getMonitorConfig();
  const limit = Math.min(Math.max(Number(options.limit) || config.lookbackLimit, 1), 100);
  const runIds = options.runId ? [sanitizePathSegment(options.runId)] : await listRecentRunIds(limit);

  const reports = [];
  for (const runId of runIds) {
    const run = await getRunTimeline(runId, 60);
    const health = evaluateRunHealth(run, config);
    const report = {
      generatedAt: new Date().toISOString(),
      runId,
      latestAt: run.latestAt,
      companyId: run.timeline[0]?.companyId ?? null,
      sourceMode: run.timeline[0]?.sourceMode ?? null,
      latestPeriod: run.latestAnalysisSnapshot?.latestPeriod ?? null,
      policyVersions: run.latestAnalysisSnapshot?.policyVersions ?? null,
      traceability: run.latestAnalysisSnapshot?.traceability ?? null,
      qualityGate: run.latestAnalysisSnapshot?.qualityGate ?? null,
      coverageSummary: run.latestAnalysisSnapshot?.coverageSummary ?? null,
      counts: run.counts,
      severity: health.severity,
      findings: health.findings,
      recommendations: health.recommendations,
      derived: health.derived,
      timeline: run.timeline.slice(0, 10),
      inputs: run.inputs,
      artifacts: run.artifacts,
      actions: [],
    };

    if (report.severity !== "ok") {
      const issueOutcome = await maybeCreateGitHubIssue(report);
      report.actions.push({
        type: "github-issue",
        ...issueOutcome,
      });
    }

    await persistMonitorReport(report);
    reports.push(report);
  }

  return {
    ok: true,
    disabled: false,
    generatedAt: new Date().toISOString(),
    reports,
  };
}

export async function listMonitorReports(limit = 25) {
  const result = await list({
    prefix: "audit-monitor/reports/",
    limit,
    mode: "expanded",
  });

  const reports = [];
  for (const blob of result.blobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())) {
    try {
      const parsed = await readBlobJson(blob.pathname);
      reports.push(parsed);
    } catch {
      reports.push({
        runId: extractRunIdFromPath(blob.pathname),
        generatedAt: blob.uploadedAt,
        severity: "unknown",
      });
    }
  }

  return {
    reports,
    cursor: result.cursor ?? null,
    hasMore: result.hasMore,
  };
}

export async function getMonitorReport(runId) {
  return readBlobJson(`audit-monitor/reports/${sanitizePathSegment(runId)}.json`);
}
