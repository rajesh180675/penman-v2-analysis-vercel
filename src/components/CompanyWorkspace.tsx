import { useEffect, useMemo, useState } from "react";
import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { CompanyRegistry, EngineConfig, RawPeriodData, RecastPeriod } from "../engine/types";
import { AuditSubmissionMeta, listRememberedAuditRuns } from "../lib/audit";
import {
  getWorkspaceCompany,
  listWorkspaceCompanies,
  ResearchNotebook,
  updateWorkspaceNotebook,
  WorkspaceAnalysisSnapshot,
  WorkspaceCompanyRecord,
} from "../lib/researchWorkspace";

interface Props {
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  config: EngineConfig;
  analysisStatus?: AnalysisStatusSummary | null;
  auditMeta?: AuditSubmissionMeta | null;
  registry: CompanyRegistry;
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
      detail: "The accounting or scope checks are blocking the valuation. Use this run only to diagnose data quality or unsupported business model issues.",
    };
  }
  if (status === "guarded" || signalState === "guarded") {
    return {
      title: "Use this as a research draft, not a position-sizing anchor",
      detail: "The model is telling you something useful, but the confidence is not high enough to treat the valuation as a final decision input.",
    };
  }
  if (signalState === "screaming-buy" || convictionBucket === "truck-load zone") {
    return {
      title: "Rare dislocation protocol",
      detail: "This is the only zone where aggressive buying is even discussable. Re-check quality, liquidity, thesis-breakers, and position sizing before acting.",
    };
  }
  if (signalState === "high-conviction" || convictionBucket === "high-conviction") {
    return {
      title: "High-conviction, but still thesis-dependent",
      detail: "The setup is strong across stress and base valuation. The next step is to verify operating momentum, catalysts, and downside conditions before sizing up.",
    };
  }
  if (signalState === "interesting" || convictionBucket === "accumulate") {
    return {
      title: "Interesting, not yet rare",
      detail: "The stock may be attractive, but the evidence is not yet overwhelming. Track it, refine the thesis, and wait for either better price or higher confidence.",
    };
  }
  return {
    title: "Build understanding before building exposure",
    detail: "Start with business summary, key drivers, accounting confidence, and the stress case. If those do not line up, valuation alone should not drive a decision.",
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
}: Props) {
  const companyOptions = useMemo(
    () => buildCompanyOptions({ registry, rawData }),
    [rawData, registry],
  );
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(rawData?.[0]?.company_id ?? companyOptions[0]?.companyId ?? "");
  const [workspaceRecord, setWorkspaceRecord] = useState<WorkspaceCompanyRecord | null>(selectedCompanyId ? getWorkspaceCompany(selectedCompanyId) : null);
  const [runHistory, setRunHistory] = useState<InspectorRunPayload[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  useEffect(() => {
    if (rawData?.[0]?.company_id) {
      setSelectedCompanyId(rawData[0].company_id);
    }
  }, [rawData]);

  useEffect(() => {
    if (!selectedCompanyId && companyOptions[0]?.companyId) {
      setSelectedCompanyId(companyOptions[0].companyId);
    }
  }, [companyOptions, selectedCompanyId]);

  useEffect(() => {
    setWorkspaceRecord(selectedCompanyId ? getWorkspaceCompany(selectedCompanyId) : null);
  }, [selectedCompanyId, rawData, recastData, analysisStatus]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setRunHistory([]);
      return;
    }
    const relevantRuns = listRememberedAuditRuns().filter((item) => item.companyId === selectedCompanyId);
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
          })
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
  }, [selectedCompanyId]);

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
  const guidance = investorGuidance({
    status: latestLocalSnapshot?.analysisStatus ?? analysisStatus?.status ?? "unknown",
    signalState: latestRun?.latestValuationSignal?.state ?? null,
    convictionBucket: latestRun?.latestValuationManifest?.opportunity?.convictionBucket ?? null,
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
      detail: latestRun?.latestValuationSignal
        ? `Stress upside ${pct(latestRun.latestValuationSignal.stressUpsidePct)} · bucket ${latestRun.latestValuationSignal.convictionBucket ?? "—"}`
        : "Open a fresh valuation run and review stressed value before thinking about upside.",
      complete: Boolean(latestRun?.latestValuationSignal),
    },
  ];

  const onNotebookFieldChange = <K extends keyof ResearchNotebook>(key: K, value: ResearchNotebook[K]) => {
    if (!selectedCompanyId) return;
    updateWorkspaceNotebook(selectedCompanyId, { [key]: value } as Partial<ResearchNotebook>);
    setWorkspaceRecord(getWorkspaceCompany(selectedCompanyId));
  };

  if (!companyOptions.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600 shadow-sm">
        <p className="text-lg font-semibold text-slate-800">No company workspace yet</p>
        <p className="mt-2 text-sm">
          Load a company first. The workspace will then keep your research notes, run history, and valuation memory together.
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
            <h2 className="mt-3 text-2xl font-bold text-slate-900">{selectedCompanyId}</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              This is the investor-facing operating surface for the current codebase: research notes, valuation memory, run history, and decision discipline in one place.
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
          <div className="min-w-[220px]">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Selected company</label>
            <select
              value={selectedCompanyId}
              onChange={(event) => setSelectedCompanyId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {companyOptions.map((option) => (
                <option key={option.companyId} value={option.companyId}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${toneForState(latestRun?.latestValuationSignal?.state ?? latestLocalSnapshot?.analysisStatus ?? null)}`}>
        <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Investor Guidance</div>
        <div className="mt-2 text-lg font-bold">{guidance.title}</div>
        <div className="mt-2 text-sm">{guidance.detail}</div>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <MetricCard label="Saved runs" value={String(workspaceRecord?.runs.length ?? 0)} />
        <MetricCard label="Analysis history" value={String(workspaceRecord?.analysisHistory.length ?? 0)} />
        <MetricCard
          label="Latest status"
          value={latestLocalSnapshot?.analysisLabel ?? analysisStatus?.label ?? "—"}
        />
        <MetricCard
          label="Latest signal"
          value={latestRun?.latestValuationSignal?.label ?? latestRun?.latestValuationSignal?.state ?? "—"}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-800">Research Workflow</h3>
              <p className="mt-1 text-sm text-slate-500">User-friendly discipline layer so the investor knows what they are doing before they reach for the valuation conclusion.</p>
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
          {latestRun ? (
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <div>Signal: <strong>{latestRun.latestValuationSignal?.label ?? latestRun.latestValuationSignal?.state ?? "—"}</strong></div>
              <div>Summary: <strong>{latestRun.latestValuationSignal?.summary ?? "—"}</strong></div>
              <div>Stress upside: <strong>{pct(latestRun.latestValuationSignal?.stressUpsidePct)}</strong></div>
              <div>Base upside: <strong>{pct(latestRun.latestValuationSignal?.baseUpsidePct)}</strong></div>
              <div>Opportunity score: <strong>{latestRun.latestValuationSignal?.opportunityScore != null ? `${latestRun.latestValuationSignal.opportunityScore.toFixed(0)}/100` : "—"}</strong></div>
              <div>Stress CAGR: <strong>{pct(latestRun.latestValuationSignal?.expectedCagrStress)}</strong></div>
              <div>Margin of safety hurdle: <strong>{pct(latestRun.latestValuationManifest?.opportunity?.requiredMarginOfSafetyPct)}</strong></div>
              <div>Expected return spread vs RF: <strong>{pct(latestRun.latestValuationManifest?.marketContext?.expectedReturnSpreadVsRf)}</strong></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-800">
                {latestRun.latestValuationManifest?.opportunity?.thesis ?? "No persisted thesis commentary yet."}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{loadingRuns ? "Loading run history…" : "No audited valuation memory exists for this company yet."}</p>
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

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-slate-800">Manifest Checklist</h3>
            {latestRun?.latestValuationManifest?.checklist ? (
              <div className="mt-4 space-y-4 text-sm text-slate-700">
                <div>
                  <div className="mb-2 font-semibold text-slate-800">What must go right</div>
                  <ul className="space-y-2">
                    {latestRun.latestValuationManifest.checklist.whatMustGoRight?.map((item) => (
                      <li key={item} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mb-2 font-semibold text-slate-800">Thesis breakers</div>
                  <ul className="space-y-2">
                    {latestRun.latestValuationManifest.checklist.thesisBreakers?.map((item) => (
                      <li key={item} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">Run a fresh valuation to persist a full manifest checklist for this company.</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-slate-800">Historical Replay Memory</h3>
            {latestRun?.latestValuationManifest?.backtest?.available ? (
              <div className="mt-4 space-y-2 text-sm text-slate-700">
                <div>1Y win rate: <strong>{pct(latestRun.latestValuationManifest.backtest.forwardWinRate1Y, 0)}</strong></div>
                <div>3Y win rate: <strong>{pct(latestRun.latestValuationManifest.backtest.forwardWinRate3Y, 0)}</strong></div>
                <div>Median 3Y CAGR: <strong>{pct(latestRun.latestValuationManifest.backtest.median3Y)}</strong></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800">
                  {latestRun.latestValuationManifest.backtest.latestComparedToHistory ?? "—"}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">Historical replay is not available for this company yet.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800">Run And Filing History</h3>
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
                      {loadingRuns ? "Loading run history…" : "No remembered audited runs for this company yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

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
            {!workspaceRecord?.analysisHistory?.length && (
              <p className="text-slate-500">No local analysis memory for this company yet.</p>
            )}
          </div>
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
