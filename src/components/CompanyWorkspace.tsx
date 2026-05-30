import { useEffect, useMemo, useState } from "react";
import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { summarizeConceptCoverage } from "../engine/conceptOntology";
import { detectCorporateActions } from "../engine/corporateActions";
import { buildPeerValuationSnapshot } from "../engine/peerValuation";
import { buildStatementLineage } from "../engine/statementLineage";
import { buildStatementDiagnostics } from "../engine/statementDiagnostics";
import { CompanyRegistry, EngineConfig, RawPeriodData, RecastPeriod } from "../engine/types";
import { AuditSubmissionMeta, listRememberedAuditRuns } from "../lib/audit";
import {
  addWorkspaceJournalEntry,
  getWorkspaceCompany,
  listWorkspaceCompanies,
  ResearchNotebook,
  updateWorkspaceNotebook,
  updateWorkspacePortfolio,
  WorkspaceAnalysisSnapshot,
  WorkspaceCompanyRecord,
} from "../lib/researchWorkspace";
import {
  fetchSharedResearchBundleWithStatus,
  formatSharedApiStatus,
  SharedApiResult,
  SharedResearchBundle,
  syncWorkspaceFilingsWithStatus,
  syncWorkspaceJournalWithStatus,
  syncWorkspacePortfolioWithStatus,
  syncWorkspaceProfileWithStatus,
} from "../lib/sharedResearchApi";
import AssumptionManifestPanel from "./AssumptionManifestPanel";
import CalibrationDashboardPanel from "./CalibrationDashboardPanel";
import FilingHistoryPanel from "./FilingHistoryPanel";
import PeerComparisonPanel from "./PeerComparisonPanel";
import PortfolioAllocator from "./PortfolioAllocator";
import ResearchJournalPanel from "./ResearchJournalPanel";
import SignalHistoryTimeline from "./SignalHistoryTimeline";
import StatementLineagePanel from "./StatementLineagePanel";
import ValuationAssumptionDiff from "./ValuationAssumptionDiff";
import ValuationWorkbench from "./ValuationWorkbench";
import WatchlistDashboard from "./WatchlistDashboard";
import { MetricCard } from "./company-workspace/fields";
import {
  buildCompanyOptions,
  InspectorRunPayload,
  investorGuidance,
  pct,
  toneForState,
} from "./company-workspace/CompanyWorkspace.formatters";
import WorkspaceHero from "./company-workspace/WorkspaceHero";
import ResearchNotebookSection from "./company-workspace/ResearchNotebookSection";
import DiagnosticsSection from "./company-workspace/DiagnosticsSection";
import AuditedRunHistorySection from "./company-workspace/AuditedRunHistorySection";

interface Props {
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  config: EngineConfig;
  analysisStatus?: AnalysisStatusSummary | null | undefined;
  auditMeta?: AuditSubmissionMeta | null | undefined;
  registry: CompanyRegistry;
  selectedCompanyId?: string | null | undefined;
  onSelectCompanyId?: (companyId: string) => void;
}

export default function CompanyWorkspace({
  rawData,
  recastData,
  config,
  analysisStatus,
  auditMeta,
  registry,
  selectedCompanyId,
  onSelectCompanyId,
}: Props) {
  const companyOptions = useMemo(() => buildCompanyOptions({ registry, rawData }), [rawData, registry]);
  const [internalCompanyId, setInternalCompanyId] = useState<string>(rawData?.[0]?.company_id ?? companyOptions[0]?.companyId ?? "");
  const effectiveCompanyId = selectedCompanyId ?? internalCompanyId;
  const [workspaceRecord, setWorkspaceRecord] = useState<WorkspaceCompanyRecord | null>(effectiveCompanyId ? getWorkspaceCompany(effectiveCompanyId) : null);
  const [runHistory, setRunHistory] = useState<InspectorRunPayload[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [sharedBundle, setSharedBundle] = useState<SharedResearchBundle | null>(null);
  const [sharedLoadStatus, setSharedLoadStatus] = useState<SharedApiResult<SharedResearchBundle> | null>(null);
  const [sharedWriteStatus, setSharedWriteStatus] = useState<SharedApiResult<Record<string, unknown>> | null>(null);

  const setCompanyId = (companyId: string) => {
    setInternalCompanyId(companyId);
    onSelectCompanyId?.(companyId);
  };

  useEffect(() => {
    if (rawData?.[0]?.company_id) {
      setCompanyId(rawData[0].company_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawData]);

  useEffect(() => {
    if (!effectiveCompanyId && companyOptions[0]?.companyId) {
      setCompanyId(companyOptions[0].companyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyOptions, effectiveCompanyId]);

  useEffect(() => {
    setWorkspaceRecord(effectiveCompanyId ? getWorkspaceCompany(effectiveCompanyId) : null);
  }, [effectiveCompanyId, rawData, recastData, analysisStatus]);

  useEffect(() => {
    if (!effectiveCompanyId) {
      setRunHistory([]);
      return;
    }
    const relevantRuns = listRememberedAuditRuns().filter((item) => item.companyId === effectiveCompanyId);
    if (!relevantRuns.length) {
      setRunHistory([]);
      return;
    }

    let cancelled = false;
    const loadRuns = async () => {
      setLoadingRuns(true);
      try {
        const payloads = await Promise.all(
          relevantRuns.map(async (run) => {
            try {
              if (!run.runAccessToken) return null;
              const response = await fetch(`/api/audit/inspector?runId=${encodeURIComponent(run.runId)}`, {
                headers: { "x-audit-run-token": run.runAccessToken, "x-penman-local": "1" },
              });
              if (!response.ok) return null;
              return await response.json() as InspectorRunPayload;
            } catch {
              return null;
            }
          }),
        );
        if (!cancelled) {
          const nextRuns = payloads
            .filter((item): item is InspectorRunPayload => item != null)
            .sort((left, right) => (right.latestAt ?? "").localeCompare(left.latestAt ?? ""));
          setRunHistory(nextRuns);
        }
      } finally {
        if (!cancelled) setLoadingRuns(false);
      }
    };

    void loadRuns();
    return () => {
      cancelled = true;
    };
  }, [effectiveCompanyId]);

  useEffect(() => {
    if (!effectiveCompanyId) {
      setSharedBundle(null);
      return;
    }
    let cancelled = false;
    const loadSharedBundle = async () => {
      const result = await fetchSharedResearchBundleWithStatus(effectiveCompanyId);
      if (!cancelled) {
        setSharedLoadStatus(result as SharedApiResult<SharedResearchBundle>);
        setSharedBundle(result.data as SharedResearchBundle | null);
      }
    };
    if (!cancelled) {
      setSharedLoadStatus(null);
    }
    void loadSharedBundle();
    return () => {
      cancelled = true;
    };
  }, [effectiveCompanyId, workspaceRecord?.journal?.length, workspaceRecord?.valuations?.length, workspaceRecord?.analysisHistory?.length]);

  const currentNotebook = workspaceRecord?.notes ?? {
    businessSummary: "",
    thesis: "",
    variantView: "",
    keyDrivers: "",
    catalysts: "",
    risks: "",
    whatMustGoRight: "",
    whatBreaksThesis: "",
    watchLevel: "watch",
    positionPlan: "",
    nextCheck: "",
    updatedAt: null,
  } satisfies ResearchNotebook;

  const latestRun = runHistory[0] ?? null;
  const latestLocalSnapshot = workspaceRecord?.analysisHistory?.[0] ?? null;
  const latestValuation = workspaceRecord?.valuations?.[0] ?? null;
  const previousValuation = workspaceRecord?.valuations?.[1] ?? null;
  const latestSignal = workspaceRecord?.signalHistory?.[0] ?? null;
  const conceptCoverage = useMemo(() => summarizeConceptCoverage(rawData), [rawData]);
  const statementDiagnostics = useMemo(() => buildStatementDiagnostics(rawData), [rawData]);
  const corporateActions = useMemo(() => detectCorporateActions(rawData), [rawData]);
  const statementLineage = useMemo(() => buildStatementLineage(rawData), [rawData]);
  const peerSnapshot = useMemo(
    () => buildPeerValuationSnapshot({ registry, workspaceCompanies: listWorkspaceCompanies(), sector: workspaceRecord?.issuer?.sector ?? config.sector_template ?? null }),
    [config.sector_template, registry, workspaceRecord?.issuer?.sector],
  );
  const sharedAlerts = sharedBundle?.alerts ?? [];
  const sharedCounts = {
    filings: sharedBundle?.filings?.length ?? 0,
    valuations: sharedBundle?.valuations?.length ?? 0,
    journal: sharedBundle?.journal?.length ?? 0,
    alerts: sharedAlerts.length,
    analysis: sharedBundle?.analysis?.length ?? 0,
  };
  const guidance = investorGuidance({
    status: latestLocalSnapshot?.analysisStatus ?? analysisStatus?.status ?? "unknown",
    signalState: latestRun?.latestValuationSignal?.state ?? latestSignal?.state ?? null,
    convictionBucket: latestRun?.latestValuationManifest?.opportunity?.convictionBucket ?? latestValuation?.convictionBucket ?? null,
  });

  const researchWorkflow = [
    {
      title: "Understand the business",
      detail: currentNotebook.businessSummary || "Write what the company actually sells, how it earns money, and what makes the economics durable or fragile.",
      complete: Boolean(currentNotebook.businessSummary.trim()),
    },
    {
      title: "Write the thesis and variant view",
      detail: currentNotebook.thesis || "State the reason this could be mispriced and what the market might be missing.",
      complete: Boolean(currentNotebook.thesis.trim() && currentNotebook.variantView.trim()),
    },
    {
      title: "Check accounting confidence",
      detail: latestLocalSnapshot
        ? `${latestLocalSnapshot.analysisLabel} · ${latestLocalSnapshot.qualityTier} · valuation ${latestLocalSnapshot.valuationStatus}`
        : "Load a company and let the engine tell you whether the analysis is blocked, guarded, or production-ready.",
      complete: Boolean(latestLocalSnapshot),
    },
    {
      title: "Anchor on the stress case",
      detail: latestValuation
        ? `Stress upside ${pct(latestValuation.stressUpsidePct)} · bucket ${latestValuation.convictionBucket ?? "—"}`
        : "Open a fresh valuation run and review stressed value before thinking about upside.",
      complete: Boolean(latestValuation),
    },
  ];

  const onNotebookFieldChange = <K extends keyof ResearchNotebook>(key: K, value: ResearchNotebook[K]) => {
    if (!effectiveCompanyId) return;
    updateWorkspaceNotebook(effectiveCompanyId, { [key]: value } as Partial<ResearchNotebook>);
    const next = getWorkspaceCompany(effectiveCompanyId);
    setWorkspaceRecord(next);
    void syncWorkspaceProfileWithStatus(next).then((result) => setSharedWriteStatus(result as SharedApiResult<Record<string, unknown>>));
  };

  useEffect(() => {
    if (!workspaceRecord) return;
    void syncWorkspaceFilingsWithStatus(workspaceRecord.companyId, workspaceRecord.filings).then((result) => {
      if (!result.ok) setSharedWriteStatus(result as SharedApiResult<Record<string, unknown>>);
    });
  }, [workspaceRecord]);

  if (!companyOptions.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600 shadow-sm">
        <p className="text-lg font-semibold text-slate-800">No company workspace yet</p>
        <p className="mt-2 text-sm">
          Load a company first. The workspace will then keep your research notes, signal history, filing memory, and portfolio discipline together.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WorkspaceHero
        effectiveCompanyId={effectiveCompanyId}
        auditMeta={auditMeta}
        rawData={rawData}
        recastData={recastData}
        config={config}
        companyOptions={companyOptions}
        setCompanyId={setCompanyId}
      />

      <WatchlistDashboard
        companies={listWorkspaceCompanies()}
        activeCompanyId={effectiveCompanyId}
        onSelectCompany={setCompanyId}
      />

      <section className={`rounded-2xl border p-5 shadow-sm ${toneForState(latestRun?.latestValuationSignal?.state ?? latestSignal?.state ?? latestLocalSnapshot?.analysisStatus ?? null)}`}>
        <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Investor Guidance</div>
        <div className="mt-2 text-lg font-bold">{guidance.title}</div>
        <div className="mt-2 text-sm">{guidance.detail}</div>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <MetricCard label="Saved runs" value={String(workspaceRecord?.runs.length ?? 0)} />
        <MetricCard label="Filing memory" value={String(workspaceRecord?.filings.length ?? 0)} />
        <MetricCard label="Signal history" value={String(workspaceRecord?.signalHistory.length ?? 0)} />
        <MetricCard label="Latest signal" value={latestValuation?.signalLabel ?? latestRun?.latestValuationSignal?.label ?? latestSignal?.label ?? "—"} />
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <MetricCard label="Shared filings" value={String(sharedCounts.filings)} />
        <MetricCard label="Shared valuations" value={String(sharedCounts.valuations)} />
        <MetricCard label="Shared analysis" value={String(sharedCounts.analysis)} />
        <MetricCard label="Shared notes" value={String(sharedCounts.journal)} />
        <MetricCard label="Alerts" value={String(sharedCounts.alerts)} />
      </section>

      {(sharedLoadStatus || sharedWriteStatus) && (
        <section className={`rounded-2xl border p-4 shadow-sm ${sharedWriteStatus?.ok || sharedLoadStatus?.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          <div className="text-xs font-semibold uppercase tracking-wide opacity-75">Shared Research Sync</div>
          <div className="mt-2 text-sm">
            {sharedWriteStatus
              ? formatSharedApiStatus(sharedWriteStatus, "Latest shared write succeeded.")
              : formatSharedApiStatus(sharedLoadStatus, "Shared research loaded successfully.")}
          </div>
        </section>
      )}

      <ValuationWorkbench
        analysisStatus={analysisStatus ?? null}
        latestSignal={latestSignal}
        latestValuation={latestValuation}
      />

      <section className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-800">Research Workflow</h3>
              <p className="mt-1 text-sm text-slate-500">
                Use this checklist before trusting the valuation conclusion. The app should tell the investor what still needs to be understood.
              </p>
            </div>
            <div className="text-xs text-slate-500">Current watch level: <strong>{currentNotebook.watchLevel}</strong></div>
          </div>
          <div className="mt-4 space-y-3">
            {researchWorkflow.map((item) => (
              <div key={item.title} className={`rounded-xl border px-4 py-3 ${item.complete ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-slate-800">{item.title}</div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.complete ? "done" : "pending"}</div>
                </div>
                <div className="mt-1 text-sm text-slate-600">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Latest Valuation Memory</h3>
          {latestRun || latestValuation ? (
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <div>Signal: <strong>{latestValuation?.signalLabel ?? latestRun?.latestValuationSignal?.label ?? latestRun?.latestValuationSignal?.state ?? "—"}</strong></div>
              <div>Stress upside: <strong>{pct(latestValuation?.stressUpsidePct ?? latestRun?.latestValuationSignal?.stressUpsidePct)}</strong></div>
              <div>Base upside: <strong>{pct(latestValuation?.baseUpsidePct ?? latestRun?.latestValuationSignal?.baseUpsidePct)}</strong></div>
              <div>Opportunity score: <strong>{latestValuation?.opportunityScore != null ? `${latestValuation.opportunityScore.toFixed(0)}/100` : latestRun?.latestValuationSignal?.opportunityScore != null ? `${latestRun.latestValuationSignal.opportunityScore.toFixed(0)}/100` : "—"}</strong></div>
              <div>Stress CAGR: <strong>{pct(latestValuation?.expectedCagrStress ?? latestRun?.latestValuationSignal?.expectedCagrStress)}</strong></div>
              <div>Quality score: <strong>{latestValuation?.qualityScore != null ? `${latestValuation.qualityScore.toFixed(0)}/100` : latestRun?.latestValuationManifest?.opportunity?.qualityScore != null ? `${latestRun.latestValuationManifest.opportunity.qualityScore.toFixed(0)}/100` : "—"}</strong></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-800">
                {latestValuation?.thesis ?? latestRun?.latestValuationManifest?.opportunity?.thesis ?? "No persisted thesis commentary yet."}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{loadingRuns ? "Loading run history..." : "No audited valuation memory exists for this company yet."}</p>
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <ResearchNotebookSection
          currentNotebook={currentNotebook}
          onNotebookFieldChange={onNotebookFieldChange}
        />

        <AssumptionManifestPanel valuation={latestValuation} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
        <SignalHistoryTimeline signals={workspaceRecord?.signalHistory ?? []} />
        <PortfolioAllocator
          plan={workspaceRecord?.portfolio ?? {
            sizingBucket: "research-only",
            targetWeightPct: null,
            maxWeightPct: null,
            currentWeightPct: null,
            riskBudgetNote: "",
            thesisOverlap: "",
            exitRule: "",
            updatedAt: null,
          }}
          latestValuation={latestValuation}
          onChange={(patch) => {
            if (!effectiveCompanyId) return;
            updateWorkspacePortfolio(effectiveCompanyId, patch);
            const next = getWorkspaceCompany(effectiveCompanyId);
            setWorkspaceRecord(next);
            if (next) void syncWorkspacePortfolioWithStatus(effectiveCompanyId, next.portfolio).then((result) => setSharedWriteStatus(result as SharedApiResult<Record<string, unknown>>));
          }}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
        <PeerComparisonPanel snapshot={peerSnapshot} />
        <ValuationAssumptionDiff current={latestValuation} previous={previousValuation} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
        <StatementLineagePanel lineage={statementLineage} />
        <CalibrationDashboardPanel
          calibration={{
            stateRankings: Object.entries(
              runHistory.reduce<Record<string, number>>((acc, run) => {
                const key = run.latestValuationSignal?.state ?? "unknown";
                acc[key] = (acc[key] ?? 0) + 1;
                return acc;
              }, {}),
            ).map(([state, count]) => ({ state, count })),
            strongestState: latestRun?.latestValuationSignal?.state ?? latestSignal?.state ?? null,
            weakestState: null,
            calibrationBand: runHistory.length >= 5 ? "robust" : runHistory.length >= 2 ? "usable" : "thin",
            hitRateSummary: latestRun?.latestValuationManifest?.backtest?.available
              ? `1Y win rate ${pct(latestRun.latestValuationManifest.backtest.forwardWinRate1Y)} · 3Y win rate ${pct(latestRun.latestValuationManifest.backtest.forwardWinRate3Y)}`
              : "No run-level replay statistics are stored for this company yet.",
            alertDiscipline: sharedAlerts.length > 2
              ? "Multiple persisted alerts exist. Review whether the strongest state is too frequent."
              : "Alert history is still sparse, which is good if strong states are meant to stay rare.",
            recommendation: latestRun?.latestValuationManifest?.backtest?.latestComparedToHistory ?? "Run more audited cycles to make the calibration layer statistically stronger.",
          }}
          alerts={sharedAlerts}
        />
      </section>

      <DiagnosticsSection
        rawData={rawData}
        conceptCoverage={conceptCoverage}
        statementDiagnostics={statementDiagnostics}
        corporateActions={corporateActions}
      />

      <section className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
        <FilingHistoryPanel filings={workspaceRecord?.filings ?? []} />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Internal Analysis Memory</h3>
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            {(workspaceRecord?.analysisHistory ?? []).map((item: WorkspaceAnalysisSnapshot) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-slate-800">{item.analysisLabel}</div>
                  <div className="text-xs text-slate-500">{new Date(item.recordedAt).toLocaleString("en-IN")}</div>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  period {item.latestPeriod?.slice(0, 10) ?? "—"} · {item.qualityTier} · valuation {item.valuationStatus} · {item.marketSymbol ?? "no symbol"}
                </div>
              </div>
            ))}
            {!workspaceRecord?.analysisHistory?.length && <p className="text-slate-500">No local analysis memory for this company yet.</p>}
          </div>
        </div>
      </section>

      <ResearchJournalPanel
        entries={workspaceRecord?.journal ?? []}
        onAdd={(entry) => {
          if (!effectiveCompanyId) return;
          addWorkspaceJournalEntry(effectiveCompanyId, entry);
          const next = getWorkspaceCompany(effectiveCompanyId);
          setWorkspaceRecord(next);
          if (next?.journal?.[0]) void syncWorkspaceJournalWithStatus(effectiveCompanyId, next.journal[0]).then((result) => setSharedWriteStatus(result as SharedApiResult<Record<string, unknown>>));
        }}
      />

      <AuditedRunHistorySection runHistory={runHistory} loadingRuns={loadingRuns} />
    </div>
  );
}
