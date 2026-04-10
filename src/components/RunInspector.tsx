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
    family?: string | null;
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
      parserFidelity?: {
        status?: string;
        score?: number;
        summary?: string;
      } | null;
      reconciliation?: {
        status?: string;
        summary?: string;
        warningCount?: number;
        errorCount?: number;
        maxResidualRatio?: number;
      } | null;
      rigor?: {
        currentLevel?: string;
        currentLabel?: string;
        summary?: string;
        achievedLevels?: string[];
        pendingLevels?: string[];
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
  latestMarketSnapshot?: {
    symbol?: string | null;
    provider?: string | null;
    fetchedAt?: string | null;
    price?: number | null;
    riskFreeRate?: number | null;
    freshness?: string | null;
    sourceSummary?: string | null;
    warnings?: string[];
    history?: {
      currentPricePercentile?: number | null;
      low52Week?: number | null;
      high52Week?: number | null;
      distanceFrom52WeekLowPct?: number | null;
      drawdownFrom52WeekHighPct?: number | null;
    } | null;
  } | null;
  latestValuationSignal?: {
    state?: string | null;
    label?: string | null;
    summary?: string | null;
    confidenceState?: string | null;
    stressUpsidePct?: number | null;
    baseUpsidePct?: number | null;
    historicalPercentile?: number | null;
    reverseDcfImpliedGrowth?: number | null;
    requiredMarginOfSafetyPct?: number | null;
    qualityScore?: number | null;
    opportunityScore?: number | null;
    convictionBucket?: string | null;
    expectedCagrStress?: number | null;
    killSwitches?: string[];
    supportingFlags?: string[];
    scenarios?: Array<{
      key?: string;
      label?: string;
      intrinsicPerShare?: number | null;
      upsidePct?: number | null;
    }>;
    marketPrice?: number | null;
    asOf?: string | null;
  } | null;
  latestValuationManifest?: {
    asOf?: string | null;
    marketPrice?: number | null;
    riskFreeRate?: number | null;
    sectorTemplate?: { label?: string | null; source?: string | null } | null;
    diagnostics?: {
      ownerEarningsPerShare?: number | null;
      reinvestmentRate?: number | null;
      incrementalRoic?: number | null;
    } | null;
    reverseDcf?: {
      impliedOwnerEarningsGrowth?: number | null;
      expectationLabel?: string | null;
    } | null;
    opportunity?: {
      qualityScore?: number | null;
      requiredMarginOfSafetyPct?: number | null;
      expectedCagrStress?: number | null;
      opportunityScore?: number | null;
      convictionBucket?: string | null;
      thesis?: string | null;
    } | null;
    checklist?: {
      whatMustGoRight?: string[];
      thesisBreakers?: string[];
    } | null;
    marketContext?: {
      expectedReturnSpreadVsRf?: number | null;
      marketCapFromPrice?: number | null;
      enterpriseValueFromPrice?: number | null;
      priceToStressValueRatio?: number | null;
    } | null;
    backtest?: {
      available?: boolean;
      investableCount?: number;
      highConvictionCount?: number;
      screamingBuyCount?: number;
      forwardWinRate1Y?: number | null;
      forwardWinRate3Y?: number | null;
      median1Y?: number | null;
      median3Y?: number | null;
      latestComparedToHistory?: string | null;
      points?: Array<{
        periodEnd?: string;
        state?: string;
        realized1Y?: number | null;
        realized3Y?: number | null;
      }>;
    } | null;
  } | null;
  latestValuationAlert?: {
    state?: string | null;
    label?: string | null;
    summary?: string | null;
    opportunityScore?: number | null;
    convictionBucket?: string | null;
    expectedCagrStress?: number | null;
    marketPrice?: number | null;
    asOf?: string | null;
  } | null;
  governance?: {
    retentionDays?: number;
    contentClass?: string;
    adminTokenVersion?: string;
  } | null;
};

type WatchlistRow = {
  runId: string;
  companyId: string;
  sourceMode: string;
  signalLabel: string;
  convictionBucket: string;
  opportunityScore: number | null;
  expectedCagrStress: number | null;
  latestAt: string | null;
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
  const [watchlistRows, setWatchlistRows] = useState<WatchlistRow[]>([]);

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
  const marketSnapshot = payload?.latestMarketSnapshot ?? null;
  const valuationSignal = payload?.latestValuationSignal ?? null;
  const valuationManifest = payload?.latestValuationManifest ?? null;
  const valuationAlert = payload?.latestValuationAlert ?? null;

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
            headers: { "x-audit-run-token": run.runAccessToken },
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
                    Analysis family: <strong>{payload?.latestAnalysisSnapshot?.family ?? "—"}</strong>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Confidence: <strong>{traceability.confidence?.status ?? "—"}</strong>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Parser fidelity: <strong>{traceability.parserFidelity?.status ?? "—"}</strong>
                    {typeof traceability.parserFidelity?.score === "number" ? ` (${traceability.parserFidelity.score}/100)` : ""}
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Reconciliation: <strong>{traceability.reconciliation?.status ?? "—"}</strong>
                    {typeof traceability.reconciliation?.maxResidualRatio === "number"
                      ? ` (${(traceability.reconciliation.maxResidualRatio * 100).toFixed(2)}%)`
                      : ""}
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    Rigor level: <strong>{traceability.rigor?.currentLabel ?? "—"}</strong>
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
                  {traceability.rigor?.summary && (
                    <div className="mt-2 text-xs text-slate-600">
                      {traceability.rigor.summary}
                    </div>
                  )}
                  {traceability.parserFidelity?.summary && (
                    <div className="mt-2 text-xs text-slate-600">
                      {traceability.parserFidelity.summary}
                    </div>
                  )}
                  {traceability.reconciliation?.summary && (
                    <div className="mt-2 text-xs text-slate-600">
                      {traceability.reconciliation.summary}
                    </div>
                  )}
                  {traceability.analysisContext?.engineError && (
                    <div className="mt-2 text-xs text-red-700">Engine error: {traceability.analysisContext.engineError}</div>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 px-3 py-3">
                  <div className="font-medium text-slate-800">Rigor ladder</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Achieved {traceability.rigor?.achievedLevels?.join(" -> ") || "—"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Remaining {traceability.rigor?.pendingLevels?.join(" -> ") || "none"}
                  </div>
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
