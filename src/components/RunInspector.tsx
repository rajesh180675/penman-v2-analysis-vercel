import { useEffect, useMemo, useState } from "react";
import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { AuditSubmissionMeta, getAuditRecoveryState, listRememberedAuditRuns, rememberAuditRun } from "../lib/audit";
import { AnalysisStatusBadge } from "./AnalysisStatusBadge";

interface Props {
  auditMeta?: AuditSubmissionMeta | null;
  analysisStatus?: AnalysisStatusSummary | null;
}

type InspectorPayload = {
  ok: boolean;
  runId: string;
  latestAt: string | null;
  counts: { events: number; inputs: number; artifacts: number };
  inputs: Array<{ pathname: string; uploadedAt: string; size: number }>;
  artifacts: Array<{ pathname: string; uploadedAt: string; size: number }>;
  timeline: Array<{
    pathname: string;
    uploadedAt: string;
    createdAt: string;
    eventType: string;
    companyId: string | null;
    sourceMode: string | null;
    payloadSummary: Record<string, unknown> | null;
    analysisSnapshot?: {
      latestPeriod?: string | null;
      qualityGate?: { tier?: string; valuationBlocked?: boolean } | null;
      traceability?: {
        confidence?: { status?: string; headline?: string } | null;
      } | null;
    } | null;
  }>;
  health: {
    severity: "ok" | "warning" | "critical";
    findings: string[];
    recommendations: string[];
    derived: {
      hasAnalysisReady: boolean;
      hasArtifacts: boolean;
      hasInputs: boolean;
    };
  };
  persistedMonitorReport?: {
    generatedAt?: string;
    severity?: string;
    actions?: Array<{ type: string; created?: boolean; issueUrl?: string; reason?: string }>;
  } | null;
  latestAnalysisSnapshot?: {
    latestPeriod?: string | null;
    traceability?: {
      schemaVersion?: string;
      generatedAt?: string | null;
      runContext?: {
        runId?: string | null;
        companyId?: string | null;
        sourceMode?: string | null;
        periodCount?: number;
        latestPeriod?: string | null;
      } | null;
      confidence?: {
        status?: string;
        headline?: string;
        blockingCount?: number;
        diagnosticCount?: number;
        optionalCount?: number;
      } | null;
      mappingCoverage?: {
        outOfSpecLabelCount?: number;
        actionableOutOfSpecLabelCount?: number;
        backlogByAction?: Record<string, number>;
      } | null;
      analysisContext?: {
        rawPeriodCount?: number;
        recastPeriodCount?: number;
        hasRecastData?: boolean;
        hasDebugInfo?: boolean;
        debugFiles?: number;
        rawMetricKeyCount?: number;
        engineError?: string | null;
      } | null;
      backlogPreview?: Array<{
        statement: string;
        key: string;
        action: string;
        priority: string;
        periodsObserved: number;
        latestValue: number | null;
      }>;
    } | null;
  } | null;
  governance?: {
    retentionDays?: number;
    contentClass?: string;
    adminTokenVersion?: string;
  } | null;
};

function formatBytes(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function RunInspector({ auditMeta, analysisStatus }: Props) {
  const [knownRuns, setKnownRuns] = useState(() => listRememberedAuditRuns());
  const [selectedRunId, setSelectedRunId] = useState(auditMeta?.runId ?? knownRuns[0]?.runId ?? "");
  const [payload, setPayload] = useState<InspectorPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auditMeta) return;
    rememberAuditRun(auditMeta);
    const nextRuns = listRememberedAuditRuns();
    setKnownRuns(nextRuns);
    setSelectedRunId(auditMeta.runId);
  }, [auditMeta]);

  const selectedRun = useMemo(() => {
    return knownRuns.find((item) => item.runId === selectedRunId) ?? null;
  }, [knownRuns, selectedRunId]);

  const recovery = useMemo(() => getAuditRecoveryState(), [payload, selectedRunId]);
  const traceability = payload?.latestAnalysisSnapshot?.traceability ?? null;

  useEffect(() => {
    if (!selectedRun) {
      setPayload(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/audit/inspector?runId=${encodeURIComponent(selectedRun.runId)}`, {
          headers: {
            "x-audit-run-token": selectedRun.runAccessToken,
          },
        });
        if (!response.ok) {
          throw new Error(`Run inspector failed with ${response.status}`);
        }
        const nextPayload = await response.json() as InspectorPayload;
        if (!cancelled) setPayload(nextPayload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 7000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedRun]);

  if (!knownRuns.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600">
        <p className="font-semibold text-slate-800">No audited runs available yet</p>
        <p className="mt-1 text-sm">Load a dataset first, then this inspector will show the full server-side timeline, artifacts, and monitor status.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {analysisStatus && <AnalysisStatusBadge status={analysisStatus} />}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Run Inspector</h2>
            <p className="mt-1 text-sm text-slate-500">
              First-class audit timeline for the current browser-authorized run, without exposing broad admin audit access.
            </p>
          </div>
          <div className="min-w-[260px]">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Selected run</label>
            <select
              value={selectedRunId}
              onChange={(event) => setSelectedRunId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {knownRuns.map((run) => (
                <option key={run.runId} value={run.runId}>
                  {run.companyId} · {run.runId.slice(0, 8)} · {run.sourceMode}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Inspector error:</strong> {error}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Events" value={payload ? String(payload.counts.events) : loading ? "…" : "—"} />
        <MetricCard label="Inputs" value={payload ? String(payload.counts.inputs) : loading ? "…" : "—"} />
        <MetricCard label="Artifacts" value={payload ? String(payload.counts.artifacts) : loading ? "…" : "—"} />
        <MetricCard
          label="Monitor"
          value={payload ? payload.health.severity.toUpperCase() : loading ? "…" : "—"}
          tone={payload?.health.severity === "critical" ? "red" : payload?.health.severity === "warning" ? "amber" : "emerald"}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.35fr,0.95fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-slate-800">Timeline</h3>
          <div className="mt-4 space-y-3">
            {payload?.timeline?.length ? payload.timeline.map((item) => (
              <div key={item.pathname} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-slate-800">{item.eventType}</div>
                  <div className="text-xs text-slate-500">{new Date(item.createdAt || item.uploadedAt).toLocaleString("en-IN")}</div>
                </div>
                <div className="mt-1 text-xs text-slate-500">{item.pathname}</div>
                {item.payloadSummary && (
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                    {JSON.stringify(item.payloadSummary, null, 2)}
                  </pre>
                )}
              </div>
            )) : (
              <p className="text-sm text-slate-500">{loading ? "Loading timeline…" : "No persisted timeline events found."}</p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-slate-800">Monitor Findings</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {payload?.health.findings?.map((finding) => (
                <li key={finding} className="rounded-lg bg-slate-50 px-3 py-2">{finding}</li>
              )) ?? <li className="text-slate-500">No findings yet.</li>}
            </ul>
            <div className="mt-4 text-xs text-slate-500">
              Latest report: {payload?.persistedMonitorReport?.generatedAt ? new Date(payload.persistedMonitorReport.generatedAt).toLocaleString("en-IN") : "live only"}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-slate-800">Artifacts and Inputs</h3>
            <div className="mt-3 space-y-3 text-sm">
              {[...(payload?.inputs ?? []), ...(payload?.artifacts ?? [])].map((item) => (
                <div key={item.pathname} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="font-medium text-slate-800">{item.pathname.split("/").pop()}</div>
                  <div className="text-xs text-slate-500">{formatBytes(item.size)} · {new Date(item.uploadedAt).toLocaleString("en-IN")}</div>
                </div>
              ))}
              {!payload?.inputs?.length && !payload?.artifacts?.length && (
                <p className="text-slate-500">{loading ? "Loading persisted blobs…" : "No persisted inputs or artifacts found yet."}</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-slate-800">Traceability</h3>
            {traceability ? (
              <div className="mt-3 space-y-4 text-sm text-slate-700">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Schema: <strong>{traceability.schemaVersion ?? "—"}</strong>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Generated: <strong>{traceability.generatedAt ? new Date(traceability.generatedAt).toLocaleString("en-IN") : "—"}</strong>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Source mode: <strong>{traceability.runContext?.sourceMode ?? "—"}</strong>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Confidence: <strong>{traceability.confidence?.status ?? "—"}</strong>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Raw/Recast periods: <strong>{traceability.analysisContext?.rawPeriodCount ?? 0} / {traceability.analysisContext?.recastPeriodCount ?? 0}</strong>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Debug files / keys: <strong>{traceability.analysisContext?.debugFiles ?? 0} / {traceability.analysisContext?.rawMetricKeyCount ?? 0}</strong>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Out-of-spec / actionable: <strong>{traceability.mappingCoverage?.outOfSpecLabelCount ?? 0} / {traceability.mappingCoverage?.actionableOutOfSpecLabelCount ?? 0}</strong>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Review backlog: <strong>{traceability.mappingCoverage?.backlogByAction?.review ?? 0}</strong>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 px-3 py-3">
                  <div className="font-medium text-slate-800">{traceability.confidence?.headline ?? "Traceability confidence"}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Blocking {traceability.confidence?.blockingCount ?? 0} · Diagnostic {traceability.confidence?.diagnosticCount ?? 0} · Optional {traceability.confidence?.optionalCount ?? 0}
                  </div>
                  {traceability.analysisContext?.engineError && (
                    <div className="mt-2 text-xs text-red-700">Engine error: {traceability.analysisContext.engineError}</div>
                  )}
                </div>
                <div>
                  <div className="mb-2 font-medium text-slate-800">Backlog preview</div>
                  {traceability.backlogPreview?.length ? (
                    <div className="space-y-2">
                      {traceability.backlogPreview.map((entry) => (
                        <div key={`${entry.statement}:${entry.key}`} className="rounded-lg border border-slate-200 px-3 py-2">
                          <div className="font-medium text-slate-800">{entry.key}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {entry.statement} · {entry.action} · {entry.priority} · periods {entry.periodsObserved} · latest {entry.latestValue ?? "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-500">No backlog preview for this run.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">{loading ? "Loading traceability…" : "No traceability payload found yet."}</p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-slate-800">Governance and Recovery</h3>
            <div className="mt-3 grid gap-3 text-sm text-slate-700">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                Sensitive class: <strong>{selectedRun?.contentClass ?? payload?.governance?.contentClass ?? "—"}</strong>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                Retention: <strong>{selectedRun?.retentionDays ?? payload?.governance?.retentionDays ?? "—"} days</strong>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                Pending queued events: <strong>{recovery.pendingEvents.length}</strong>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                Pending failed uploads/exports: <strong>{recovery.pendingFailures.length}</strong>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "emerald" | "amber" | "red" }) {
  const toneClass = tone === "emerald"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "red"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-slate-200 bg-white text-slate-800";
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}
