import { useEffect, useMemo, useState } from "react";
import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { summarizeConceptCoverage, rankUnmappedLabels } from "../engine/conceptOntology";
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

interface Props {
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  config: EngineConfig;
  analysisStatus?: AnalysisStatusSummary | null;
  auditMeta?: AuditSubmissionMeta | null;
  registry: CompanyRegistry;
  selectedCompanyId?: string | null;
  onSelectCompanyId?: (companyId: string) => void;
}

interface InspectorRunPayload {
  runId: string;
  latestAt: string | null;
  latestAnalysisSnapshot?: {
    latestPeriod?: string | null;
  } | null;
  latestValuationSignal?: {
    label?: string | null;
    state?: string | null;
    summary?: string | null;
    baseUpsidePct?: number | null;
    stressUpsidePct?: number | null;
    opportunityScore?: number | null;
    convictionBucket?: string | null;
    expectedCagrStress?: number | null;
  } | null;
  latestValuationManifest?: {
    sectorTemplate?: { label?: string | null } | null;
    opportunity?: {
      thesis?: string | null;
      requiredMarginOfSafetyPct?: number | null;
      qualityScore?: number | null;
      opportunityScore?: number | null;
      convictionBucket?: string | null;
      expectedCagrStress?: number | null;
    } | null;
    marketContext?: {
      expectedReturnSpreadVsRf?: number | null;
      priceToStressValueRatio?: number | null;
    } | null;
    checklist?: {
      whatMustGoRight?: string[];
      thesisBreakers?: string[];
    } | null;
    backtest?: {
      available?: boolean;
      forwardWinRate1Y?: number | null;
      forwardWinRate3Y?: number | null;
      median3Y?: number | null;
      latestComparedToHistory?: string | null;
    } | null;
  } | null;
  health?: {
    severity?: "ok" | "warning" | "critical";
    findings?: string[];
  } | null;
}

function pct(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function toneForState(state: string | null | undefined) {
  if (state === "blocked") return "border-red-200 bg-red-50 text-red-800";
  if (state === "guarded") return "border-amber-200 bg-amber-50 text-amber-800";
  if (state === "high-conviction" || state === "screaming-buy") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "interesting") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

function investorGuidance(args: {
  status?: AnalysisStatusSummary["status"] | "unknown";
  signalState?: string | null;
  convictionBucket?: string | null;
}) {
  const { status, signalState, convictionBucket } = args;
  if (status === "blocked" || signalState === "blocked") {
    return {
      title: "Do not treat this as investable output",
      detail: "The accounting or scope checks are blocking the valuation. Use this company only to diagnose data quality or unsupported business-model issues.",
    };
  }
  if (status === "guarded" || signalState === "guarded") {
    return {
      title: "Use this as research input, not a sizing anchor",
      detail: "The model is directionally useful, but the confidence is not strong enough to convert the output into a final investment decision.",
    };
  }
  if (signalState === "screaming-buy" || convictionBucket === "truck-load zone") {
    return {
      title: "Rare dislocation protocol",
      detail: "This is the only zone where aggressive buying is discussable. Re-check liquidity, balance-sheet safety, and thesis breakers before increasing size.",
    };
  }
  if (signalState === "high-conviction" || convictionBucket === "high-conviction") {
    return {
      title: "Strong setup, still thesis-dependent",
      detail: "The next step is not another valuation rerun. Validate catalysts, durability of economics, and downside conditions before committing more capital.",
    };
  }
  if (signalState === "interesting" || convictionBucket === "accumulate") {
    return {
      title: "Interesting, not yet rare",
      detail: "Track it, sharpen the thesis, and wait either for stronger evidence or a better price rather than forcing a decision.",
    };
  }
  return {
    title: "Build understanding before building exposure",
    detail: "Start with business summary, key drivers, accounting confidence, and the stress case. If those do not line up, valuation should not drive the decision.",
  };
}

function toTextAreaValue(value: string) {
  return value ?? "";
}

function buildCompanyOptions(params: {
  registry: CompanyRegistry;
  rawData: RawPeriodData[] | null;
}) {
  const options = new Map<string, { companyId: string; label: string }>();
  for (const record of listWorkspaceCompanies()) {
    options.set(record.companyId, { companyId: record.companyId, label: record.label || record.companyId });
  }
  for (const item of Object.values(params.registry.companies)) {
    options.set(item.id, { companyId: item.id, label: item.label || item.id });
  }
  const currentCompanyId = params.rawData?.[0]?.company_id;
  if (currentCompanyId) {
    options.set(currentCompanyId, { companyId: currentCompanyId, label: currentCompanyId });
  }
  return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label));
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
              const response = await fetch(`/api/audit/inspector?runId=${encodeURIComponent(run.runId)}`, {
                headers: { "x-audit-run-token": run.runAccessToken },
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
    void syncWorkspaceProfileWithStatus(workspaceRecord).then((result) => setSharedWriteStatus(result as SharedApiResult<Record<string, unknown>>));
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
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Company Workspace
            </div>
            <h2 className="mt-3 text-2xl font-bold text-slate-900">{effectiveCompanyId}</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              This is the investor operating system for the current codebase: filings, research notes, signal history, valuation memory, and portfolio actions in one place.
            </p>
            {(auditMeta || rawData?.length || recastData?.length) && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                {auditMeta && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">source {auditMeta.sourceMode}</span>}
                {config.market_data_symbol && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">symbol {config.market_data_symbol}</span>}
                {config.sector_template && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">template {config.sector_template}</span>}
                {recastData?.length ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{recastData.length} recast periods</span> : null}
              </div>
            )}
          </div>
          <div className="min-w-[240px]">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Selected company</label>
            <select
              value={effectiveCompanyId}
              onChange={(event) => setCompanyId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {companyOptions.map((option) => (
                <option key={option.companyId} value={option.companyId}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

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
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Research Notebook</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <NoteField label="Business Summary" value={toTextAreaValue(currentNotebook.businessSummary)} onChange={(value) => onNotebookFieldChange("businessSummary", value)} />
            <NoteField label="Investment Thesis" value={toTextAreaValue(currentNotebook.thesis)} onChange={(value) => onNotebookFieldChange("thesis", value)} />
            <NoteField label="Variant View" value={toTextAreaValue(currentNotebook.variantView)} onChange={(value) => onNotebookFieldChange("variantView", value)} />
            <NoteField label="Key Drivers" value={toTextAreaValue(currentNotebook.keyDrivers)} onChange={(value) => onNotebookFieldChange("keyDrivers", value)} />
            <NoteField label="Catalysts" value={toTextAreaValue(currentNotebook.catalysts)} onChange={(value) => onNotebookFieldChange("catalysts", value)} />
            <NoteField label="Risks" value={toTextAreaValue(currentNotebook.risks)} onChange={(value) => onNotebookFieldChange("risks", value)} />
            <NoteField label="What Must Go Right" value={toTextAreaValue(currentNotebook.whatMustGoRight)} onChange={(value) => onNotebookFieldChange("whatMustGoRight", value)} />
            <NoteField label="What Breaks The Thesis" value={toTextAreaValue(currentNotebook.whatBreaksThesis)} onChange={(value) => onNotebookFieldChange("whatBreaksThesis", value)} />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <SelectField
              label="Watch Level"
              value={currentNotebook.watchLevel}
              options={[
                { value: "watch", label: "Watch" },
                { value: "researching", label: "Researching" },
                { value: "accumulate", label: "Accumulate" },
                { value: "high-conviction", label: "High conviction" },
              ]}
              onChange={(value) => onNotebookFieldChange("watchLevel", value as ResearchNotebook["watchLevel"])}
            />
            <TextField label="Position Plan" value={currentNotebook.positionPlan} onChange={(value) => onNotebookFieldChange("positionPlan", value)} />
            <TextField label="Next Check" value={currentNotebook.nextCheck} onChange={(value) => onNotebookFieldChange("nextCheck", value)} />
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Notebook updated: {currentNotebook.updatedAt ? new Date(currentNotebook.updatedAt).toLocaleString("en-IN") : "not yet"}
          </div>
        </div>

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

      <section className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Concept Ontology Coverage</h3>
          <p className="mt-1 text-sm text-slate-500">This shows whether the loaded statements cover the analytical concepts the model cares about, not just raw line counts.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <MetricCard label="Coverage" value={`${(conceptCoverage.coveragePct * 100).toFixed(0)}%`} />
            <MetricCard label="Core matched" value={`${conceptCoverage.coreMatchedCount}/${conceptCoverage.coreTotalCount}`} />
            <MetricCard label="Top unmapped" value={String(rankUnmappedLabels(rawData, 8).length)} />
          </div>
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            {conceptCoverage.unresolvedCore.length ? (
              conceptCoverage.unresolvedCore.map((item) => (
                <div key={item} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">{item}</div>
              ))
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">All core ontology concepts have a live statement match.</div>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Statement Diagnostics And Corporate Actions</h3>
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            {statementDiagnostics.diagnostics.slice(0, 6).map((item) => (
              <div key={`${item.label}:${item.periodEnd ?? "na"}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="font-medium text-slate-800">{item.label}</div>
                <div className="text-xs text-slate-500">{item.periodEnd?.slice(0, 10) ?? "—"}</div>
                <div className="mt-1">{item.detail}</div>
              </div>
            ))}
            {!statementDiagnostics.diagnostics.length && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">No major presentation or scale discontinuities were detected in the loaded history.</div>
            )}
            {corporateActions.slice(0, 4).map((item) => (
              <div key={`${item.kind}:${item.periodEnd}`} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900">
                <div className="font-medium">{item.kind}</div>
                <div className="text-xs opacity-70">{item.periodEnd.slice(0, 10)} · confidence {item.confidence}</div>
                <div className="mt-1">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

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

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-bold text-slate-800">Audited Run History</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Run</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Latest period</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Signal</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Stress CAGR</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runHistory.map((run) => (
                <tr key={run.runId}>
                  <td className="px-3 py-2 text-slate-700">{run.runId.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-slate-700">{run.latestAnalysisSnapshot?.latestPeriod?.slice(0, 10) ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-700">{run.latestValuationSignal?.label ?? run.latestValuationSignal?.state ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{pct(run.latestValuationSignal?.expectedCagrStress)}</td>
                  <td className="px-3 py-2 text-right">{run.health?.severity?.toUpperCase() ?? "—"}</td>
                </tr>
              ))}
              {!runHistory.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    {loadingRuns ? "Loading run history..." : "No remembered audited runs for this company yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function NoteField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
      />
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}
