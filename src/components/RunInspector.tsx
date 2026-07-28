import { useEffect, useMemo, useRef, useState } from "react";
import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { AuditSubmissionMeta, getAuditRecoveryState, listRememberedAuditRuns, rememberAuditRun } from "../lib/audit";
import { AnalysisStatusBadge } from "./AnalysisStatusBadge";
import { fetchAuditArtifactDownload, inspectAuditArtifact, type AuditArtifactInspection } from "../lib/auditArtifacts";
import { MetricCard } from "./run-inspector/atoms";
import { formatBytes } from "./run-inspector/RunInspector.formatters";
import { TraceabilitySection } from "./run-inspector/TraceabilitySection";
import { InspectorPayload, WatchlistRow } from "./run-inspector/types";

interface Props {
  auditMeta?: AuditSubmissionMeta | null | undefined;
  analysisStatus?: AnalysisStatusSummary | null | undefined;
}

export default function RunInspector({ auditMeta, analysisStatus }: Props) {
  const [knownRuns, setKnownRuns] = useState(() => listRememberedAuditRuns());
  const [selectedRunId, setSelectedRunId] = useState(auditMeta?.runId ?? knownRuns[0]?.runId ?? "");
  const [payload, setPayload] = useState<InspectorPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watchlistRows, setWatchlistRows] = useState<WatchlistRow[]>([]);
  const [artifactInspections, setArtifactInspections] = useState<Record<string, AuditArtifactInspection>>({});
  const [artifactAction, setArtifactAction] = useState<string | null>(null);
  const automaticVerificationAttempts = useRef(new Set<string>());

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

  // `getAuditRecoveryState()` takes no arguments — it reads persisted state
  // outside React. `payload` and `selectedRunId` are the invalidation keys that
  // say "re-read it now": a new payload arrives on the 7s poll, and switching
  // runs changes which run's recovery state is relevant. Removing them, as the
  // rule suggests, would read the state once at mount and never again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recovery = useMemo(() => getAuditRecoveryState(), [payload, selectedRunId]);
  const traceability = payload?.latestAnalysisSnapshot?.traceability ?? null;
  const marketSnapshot = payload?.latestMarketSnapshot ?? null;
  const valuationSignal = payload?.latestValuationSignal ?? null;
  const valuationManifest = payload?.latestValuationManifest ?? null;
  const valuationAlert = payload?.latestValuationAlert ?? null;

  useEffect(() => {
    setArtifactInspections({});
    setArtifactAction(null);
    automaticVerificationAttempts.current.clear();
  }, [selectedRunId]);

  const verifyArtifact = async (pathname: string) => {
    if (!selectedRun?.runAccessToken) return;
    setArtifactAction(`verify:${pathname}`);
    setError(null);
    try {
      const inspection = await inspectAuditArtifact({ runId: selectedRun.runId, pathname, runAccessToken: selectedRun.runAccessToken });
      setArtifactInspections((current) => ({ ...current, [pathname]: inspection }));
    } catch (artifactError) {
      setError(artifactError instanceof Error ? artifactError.message : String(artifactError));
    } finally {
      setArtifactAction(null);
    }
  };

  const downloadArtifact = async (pathname: string) => {
    if (!selectedRun?.runAccessToken) return;
    setArtifactAction(`download:${pathname}`);
    setError(null);
    try {
      const download = await fetchAuditArtifactDownload({ runId: selectedRun.runId, pathname, runAccessToken: selectedRun.runAccessToken });
      const url = URL.createObjectURL(download.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = download.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (artifactError) {
      setError(artifactError instanceof Error ? artifactError.message : String(artifactError));
    } finally {
      setArtifactAction(null);
    }
  };

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
        if (!selectedRun.runAccessToken) {
          throw new Error("Run inspector token not available in this browser session.");
        }
        const response = await fetch(`/api/audit/inspector?runId=${encodeURIComponent(selectedRun.runId)}`, {
          headers: {
            "x-audit-run-token": selectedRun.runAccessToken,
            "x-penman-local": "1",
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

  useEffect(() => {
    if (!selectedRun?.runAccessToken || !payload?.artifacts.length || artifactAction) return;
    const newestSnapshot = payload.artifacts.find((item) =>
      item.eventType === "analysis-snapshot-artifact"
      || item.pathname.toLowerCase().includes("analysis-snapshot"));
    if (!newestSnapshot || artifactInspections[newestSnapshot.pathname]) return;
    if (automaticVerificationAttempts.current.has(newestSnapshot.pathname)) return;
    automaticVerificationAttempts.current.add(newestSnapshot.pathname);
    void verifyArtifact(newestSnapshot.pathname);
    // `verifyArtifact` is redefined every render, so listing it would re-fire
    // this effect on every render — and the effect's job is to fire once per
    // newly-seen snapshot, which is what `automaticVerificationAttempts` tracks.
    // No stale closure: the only non-stable value it reads is `selectedRun`,
    // which is already a dependency, plus setState functions, which are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactAction, artifactInspections, payload?.artifacts, selectedRun]);

  useEffect(() => {
    if (!knownRuns.length) {
      setWatchlistRows([]);
      return;
    }
    let cancelled = false;
    const loadWatchlist = async () => {
      const rows = await Promise.all(knownRuns.map(async (run) => {
        try {
          if (!run.runAccessToken) return null;
          const response = await fetch(`/api/audit/inspector?runId=${encodeURIComponent(run.runId)}`, {
            headers: { "x-audit-run-token": run.runAccessToken, "x-penman-local": "1" },
          });
          if (!response.ok) return null;
          const item = await response.json() as InspectorPayload;
          return {
            runId: run.runId,
            companyId: run.companyId,
            sourceMode: run.sourceMode,
            signalLabel: item.latestValuationSignal?.label ?? item.latestValuationSignal?.state ?? "—",
            convictionBucket: item.latestValuationManifest?.opportunity?.convictionBucket ?? "—",
            opportunityScore: item.latestValuationManifest?.opportunity?.opportunityScore ?? null,
            expectedCagrStress: item.latestValuationManifest?.opportunity?.expectedCagrStress ?? null,
            latestAt: item.latestAt ?? null,
          } satisfies WatchlistRow;
        } catch {
          return null;
        }
      }));
      if (!cancelled) {
        const filteredRows: WatchlistRow[] = rows.filter((item) => item != null) as WatchlistRow[];
        filteredRows.sort((a, b) => {
          const scoreDiff = (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1);
          if (scoreDiff !== 0) return scoreDiff;
          return (b.expectedCagrStress ?? -1) - (a.expectedCagrStress ?? -1);
        });
        setWatchlistRows(filteredRows);
      }
    };
    void loadWatchlist();
    const timer = window.setInterval(() => {
      void loadWatchlist();
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [knownRuns]);

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

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800">Opportunity Watchlist</h3>
            <p className="mt-1 text-sm text-slate-500">Local portfolio-style ranking across remembered audited runs using the persisted valuation manifest.</p>
          </div>
          <div className="text-xs text-slate-500">{watchlistRows.length} tracked runs</div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Company</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Signal</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Bucket</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Score</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Stress CAGR</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Latest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {watchlistRows.map((row) => (
                <tr key={row.runId} className={row.runId === selectedRunId ? "bg-indigo-50" : ""}>
                  <td className="px-3 py-2">
                    <button className="font-medium text-slate-800 hover:text-indigo-700" onClick={() => setSelectedRunId(row.runId)}>
                      {row.companyId}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{row.signalLabel}</td>
                  <td className="px-3 py-2 text-slate-700">{row.convictionBucket}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.opportunityScore != null ? row.opportunityScore.toFixed(0) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.expectedCagrStress != null ? `${(row.expectedCagrStress * 100).toFixed(1)}%` : "—"}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-500">{row.latestAt ? new Date(row.latestAt).toLocaleString("en-IN") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Latest Market Snapshot</h3>
          {marketSnapshot ? (
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <div>Symbol: <strong>{marketSnapshot.symbol ?? "—"}</strong></div>
              <div>Provider: <strong>{marketSnapshot.provider ?? "—"}</strong></div>
              <div>Price: <strong>{marketSnapshot.price != null ? `₹${marketSnapshot.price.toFixed(2)}` : "—"}</strong></div>
              <div>Risk-free rate: <strong>{marketSnapshot.riskFreeRate != null ? `${(marketSnapshot.riskFreeRate * 100).toFixed(2)}%` : "—"}</strong></div>
              <div>Freshness: <strong>{marketSnapshot.freshness ?? "—"}</strong></div>
              <div>Fetched: <strong>{marketSnapshot.fetchedAt ? new Date(marketSnapshot.fetchedAt).toLocaleString("en-IN") : "—"}</strong></div>
              <div>Current price percentile: <strong>{marketSnapshot.history?.currentPricePercentile != null ? `${(marketSnapshot.history.currentPricePercentile * 100).toFixed(0)}th` : "—"}</strong></div>
              <div>52-week range: <strong>{marketSnapshot.history?.low52Week != null ? `₹${marketSnapshot.history.low52Week.toFixed(2)}` : "—"}</strong> to <strong>{marketSnapshot.history?.high52Week != null ? `₹${marketSnapshot.history.high52Week.toFixed(2)}` : "—"}</strong></div>
              {marketSnapshot.warnings?.length ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {marketSnapshot.warnings.join(" ")}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{loading ? "Loading market snapshot…" : "No live market snapshot has been persisted for this run yet."}</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Latest Valuation Signal</h3>
          {valuationSignal ? (
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <div>State: <strong>{valuationSignal.label ?? valuationSignal.state ?? "—"}</strong></div>
              <div>Summary: <strong>{valuationSignal.summary ?? "—"}</strong></div>
              <div>Confidence: <strong>{valuationSignal.confidenceState ?? "—"}</strong></div>
              <div>Base upside: <strong>{valuationSignal.baseUpsidePct != null ? `${(valuationSignal.baseUpsidePct * 100).toFixed(1)}%` : "—"}</strong></div>
              <div>Stress upside: <strong>{valuationSignal.stressUpsidePct != null ? `${(valuationSignal.stressUpsidePct * 100).toFixed(1)}%` : "—"}</strong></div>
              <div>Historical percentile: <strong>{valuationSignal.historicalPercentile != null ? `${(valuationSignal.historicalPercentile * 100).toFixed(0)}th` : "—"}</strong></div>
              <div>Reverse DCF implied growth: <strong>{valuationSignal.reverseDcfImpliedGrowth != null ? `${(valuationSignal.reverseDcfImpliedGrowth * 100).toFixed(2)}%` : "—"}</strong></div>
              <div>Required margin of safety: <strong>{valuationSignal.requiredMarginOfSafetyPct != null ? `${(valuationSignal.requiredMarginOfSafetyPct * 100).toFixed(1)}%` : "—"}</strong></div>
              <div>Opportunity score: <strong>{valuationSignal.opportunityScore != null ? `${valuationSignal.opportunityScore.toFixed(0)}/100` : "—"}</strong></div>
              <div>Stress CAGR: <strong>{valuationSignal.expectedCagrStress != null ? `${(valuationSignal.expectedCagrStress * 100).toFixed(1)}%` : "—"}</strong></div>
              <div>Conviction bucket: <strong>{valuationSignal.convictionBucket ?? "—"}</strong></div>
              {valuationSignal.killSwitches?.length ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  Kill-switches: {valuationSignal.killSwitches.join(" · ")}
                </div>
              ) : null}
              {valuationSignal.supportingFlags?.length ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  Supporting flags: {valuationSignal.supportingFlags.join(" · ")}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{loading ? "Loading valuation signal…" : "No valuation signal event has been persisted for this run yet."}</p>
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Latest Valuation Manifest</h3>
          {valuationManifest ? (
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <div>Sector template: <strong>{valuationManifest.sectorTemplate?.label ?? "—"}</strong></div>
              <div>Owner earnings / share: <strong>{valuationManifest.diagnostics?.ownerEarningsPerShare != null ? `₹${valuationManifest.diagnostics.ownerEarningsPerShare.toFixed(2)}` : "—"}</strong></div>
              <div>Reinvestment rate: <strong>{valuationManifest.diagnostics?.reinvestmentRate != null ? `${(valuationManifest.diagnostics.reinvestmentRate * 100).toFixed(1)}%` : "—"}</strong></div>
              <div>Incremental ROIC: <strong>{valuationManifest.diagnostics?.incrementalRoic != null ? `${(valuationManifest.diagnostics.incrementalRoic * 100).toFixed(1)}%` : "—"}</strong></div>
              <div>Expected return spread vs risk-free: <strong>{valuationManifest.marketContext?.expectedReturnSpreadVsRf != null ? `${(valuationManifest.marketContext.expectedReturnSpreadVsRf * 100).toFixed(1)}%` : "—"}</strong></div>
              <div>Implied market cap: <strong>{valuationManifest.marketContext?.marketCapFromPrice != null ? `₹${valuationManifest.marketContext.marketCapFromPrice.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr` : "—"}</strong></div>
              <div>Price / stress value: <strong>{valuationManifest.marketContext?.priceToStressValueRatio != null ? `${valuationManifest.marketContext.priceToStressValueRatio.toFixed(2)}x` : "—"}</strong></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                {valuationManifest.reverseDcf?.expectationLabel ?? valuationManifest.opportunity?.thesis ?? "No manifest commentary yet."}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{loading ? "Loading valuation manifest…" : "No valuation manifest has been persisted for this run yet."}</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Alerts and Backtest</h3>
          <div className="mt-4 space-y-3 text-sm text-slate-700">
            <div>Latest alert: <strong>{valuationAlert?.label ?? valuationAlert?.state ?? "—"}</strong></div>
            <div>Alert summary: <strong>{valuationAlert?.summary ?? "—"}</strong></div>
            <div>1Y forward win rate: <strong>{valuationManifest?.backtest?.forwardWinRate1Y != null ? `${(valuationManifest.backtest.forwardWinRate1Y * 100).toFixed(0)}%` : "—"}</strong></div>
            <div>3Y forward win rate: <strong>{valuationManifest?.backtest?.forwardWinRate3Y != null ? `${(valuationManifest.backtest.forwardWinRate3Y * 100).toFixed(0)}%` : "—"}</strong></div>
            <div>Median 3Y CAGR: <strong>{valuationManifest?.backtest?.median3Y != null ? `${(valuationManifest.backtest.median3Y * 100).toFixed(1)}%` : "—"}</strong></div>
            <div>Historical note: <strong>{valuationManifest?.backtest?.latestComparedToHistory ?? "—"}</strong></div>
          </div>
        </div>
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
              {(payload?.inputs ?? []).map((item) => (
                <div key={item.pathname} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="font-medium text-slate-800">{item.pathname.split("/").pop()}</div>
                  <div className="text-xs text-slate-500">{formatBytes(item.size)} · {new Date(item.uploadedAt).toLocaleString("en-IN")}</div>
                </div>
              ))}
              {(payload?.artifacts ?? []).map((item) => {
                const inspection = artifactInspections[item.pathname];
                const status = inspection?.verification.status;
                return (
                  <div key={item.pathname} className="rounded-lg border border-slate-200 px-3 py-3">
                    <div className="font-medium text-slate-800">{item.pathname.split("/").pop()}</div>
                    <div className="text-xs text-slate-500">Artifact · {formatBytes(item.size)} · {item.contentEncoding ?? "identity"} · {new Date(item.uploadedAt).toLocaleString("en-IN")}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void verifyArtifact(item.pathname)} disabled={artifactAction !== null} className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 disabled:opacity-50">
                        {artifactAction === `verify:${item.pathname}` ? "Verifying…" : "Verify integrity"}
                      </button>
                      <button type="button" onClick={() => void downloadArtifact(item.pathname)} disabled={artifactAction !== null} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50">
                        {artifactAction === `download:${item.pathname}` ? "Preparing…" : "Download"}
                      </button>
                    </div>
                    {inspection && (
                      <div className={`mt-2 rounded-md px-2.5 py-2 text-xs ${status === "verified" ? "bg-emerald-50 text-emerald-800" : status === "mismatch" || status === "invalid-compression" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"}`}>
                        <div className="font-semibold">Integrity: {status}</div>
                        <div>Encoding: {inspection.artifact.contentEncoding ?? "identity"} · Decoded: {inspection.verification.decodedBytes != null ? formatBytes(inspection.verification.decodedBytes) : "—"}</div>
                        <div className="break-all font-mono">SHA: {inspection.verification.actualHash ?? "unavailable"}</div>
                        {inspection.snapshotSummary && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(inspection.snapshotSummary, null, 2)}</pre>}
                      </div>
                    )}
                  </div>
                );
              })}
              {!payload?.inputs?.length && !payload?.artifacts?.length && (
                <p className="text-slate-500">{loading ? "Loading persisted blobs…" : "No persisted inputs or artifacts found yet."}</p>
              )}
            </div>
          </section>

          <TraceabilitySection
            traceability={traceability}
            family={payload?.latestAnalysisSnapshot?.family}
            loading={loading}
          />

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
              <div className={`rounded-lg px-3 py-2 ${payload?.retentionHealth?.status === "warning" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
                Retention cleanup: <strong>{payload?.retentionHealth?.status ?? "unknown"}</strong>
                <div className="mt-1 text-xs">{payload?.retentionHealth?.summary ?? "No cleanup health report is available."}</div>
                {payload?.retentionHealth?.lastCheckedAt && (
                  <div className="mt-1 text-xs">Last checked: {new Date(payload.retentionHealth.lastCheckedAt).toLocaleString("en-IN")}</div>
                )}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

