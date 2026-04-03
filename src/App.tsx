import { Suspense, lazy, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { RawPeriodData, RecastPeriod, DEFAULT_CONFIG, EngineConfig, CompanyRegistry } from "./engine/types";
import { processCompanyData } from "./engine/pipeline";
import { deriveAnalysisStatus } from "./engine/analysisStatus";
import { CapitalineParseDebug } from "./engine/capitalineParser";
import { auditMappingCoverage, evaluateQualityGate } from "./engine/mappingAudit";
import { resolveValuationReadiness } from "./engine/valuationPolicy";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AnalysisStatusBadge } from "./components/AnalysisStatusBadge";
import DataEntry from "./components/DataEntry";
import RecastStatements from "./components/RecastStatements";
import RatioReport from "./components/RatioReport";
import QualityReport from "./components/QualityReport";
import {
  AuditSubmissionMeta,
  createAuditAccessToken,
  createAuditRunId,
  getAuditClientGovernance,
  isAuditEnabled,
  persistAuditEvent,
  rememberAuditRun,
} from "./lib/audit";
import { buildAnalysisSnapshot } from "./lib/auditSnapshot";
import { listWorkspaceCompanies, rememberWorkspaceAnalysis } from "./lib/researchWorkspace";
import { syncWorkspaceAnalysis, syncWorkspaceProfile } from "./lib/sharedResearchApi";
import { buildAnalysisTraceability } from "./engine/analysisTraceability";
import { getAnalysisPolicyVersions } from "./engine/policyVersions";

const ValuationReport = lazy(() => import("./components/ValuationReport"));
const ForecastReport = lazy(() => import("./components/ForecastReport"));
const AcademicReport = lazy(() => import("./components/AcademicReport"));
const RegressionReport = lazy(() => import("./components/RegressionReport"));
const ComparisonReport = lazy(() => import("./components/ComparisonReport"));
const DebugPanel = lazy(() => import("./components/DebugPanel"));
const V3AnalyticsPanel = lazy(() => import("./components/V3AnalyticsPanel"));
const RunInspector = lazy(() => import("./components/RunInspector"));
const CompanyWorkspace = lazy(() => import("./components/CompanyWorkspace"));
const WatchlistDashboard = lazy(() => import("./components/WatchlistDashboard"));
const FinancialInstitutionReport = lazy(() => import("./components/FinancialInstitutionReport"));

type TabId = "upload"|"watchlist"|"workspace"|"inspector"|"statements"|"ratios"|"forecast"|"valuation"|"quality"|"comparison"|"report"|"regression"|"v3analytics"|"debug";

const TABS: {id:TabId;label:string;icon:string;needsData?:boolean}[] = [
  {id:"upload",     label:"Data",       icon:"📂"},
  {id:"watchlist",  label:"Watchlist",  icon:"🗂"},
  {id:"workspace",  label:"Workspace",  icon:"🧭"},
  {id:"inspector",  label:"Runs",       icon:"🛰️"},
  {id:"statements", label:"Statements", icon:"📊", needsData:true},
  {id:"ratios",     label:"Ratios",     icon:"📐", needsData:true},
  {id:"forecast",   label:"Forecast",   icon:"📈", needsData:true},
  {id:"valuation",  label:"Valuation",  icon:"💰", needsData:true},
  {id:"quality",    label:"Quality",    icon:"🔍", needsData:true},
  {id:"comparison", label:"Comparison", icon:"👥", needsData:true},
  {id:"report",     label:"Report",     icon:"📚", needsData:true},
  {id:"regression", label:"Regression", icon:"🧪", needsData:true},
  {id:"v3analytics",label:"V3 Analytics",icon:"🔬", needsData:true},
  {id:"debug",      label:"Debug",      icon:"🛠"},
];

export function App() {
  const auditGovernance = getAuditClientGovernance();
  const [rawData,    setRawData]    = useState<RawPeriodData[]|null>(null);
  const [debugInfo,  setDebugInfo]  = useState<CapitalineParseDebug|null>(null);
  const [activeTab,  setActiveTab]  = useState<TabId>("upload");
  const [config,     setConfig]     = useState<EngineConfig>(DEFAULT_CONFIG);
  const [darkMode, setDarkMode] = useState(false);
  const [registry, setRegistry] = useState<CompanyRegistry>({ companies: {} });
  const [auditMeta, setAuditMeta] = useState<AuditSubmissionMeta | null>(null);
  const [workspaceCompanyId, setWorkspaceCompanyId] = useState<string | null>(null);
  const lastAuditSignatureRef = useRef<string | null>(null);
  const lastAuditStatusRef = useRef<string | null>(null);
  const lastTabAuditRef = useRef<string | null>(null);

  const qualityGate = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;
    return evaluateQualityGate(rawData, config);
  }, [config, rawData]);

  const mappingAudit = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;
    return auditMappingCoverage(rawData);
  }, [rawData]);

  // Derive recastData reactively from rawData + config so any config change (tax rate,
  // OCI treatment, hybrid-debt flag, etc.) immediately re-computes the analysis.
  const recastOutcome = useMemo<{ data: RecastPeriod[] | null; error: string | null }>(() => {
    if (!rawData || rawData.length === 0) return { data: null, error: null };
    if (qualityGate?.scopeAssessment.blocked) {
      return {
        data: null,
        error: qualityGate.scopeAssessment.reasons[0] ?? "Unsupported dataset scope for the industrial Penman-Nissim engine.",
      };
    }
    try {
      const processed = processCompanyData(rawData, config);
      return { data: processed.length > 0 ? processed : null, error: null };
    } catch (err) {
      console.error("[App] engine error:", err);
      return {
        data: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [config, qualityGate, rawData]);
  const recastData = recastOutcome.data;
  const engineError = recastOutcome.error;
  const valuationReadiness = useMemo(() => (recastData?.length ? resolveValuationReadiness(recastData) : null), [recastData]);
  const analysisStatus = useMemo(
    () => deriveAnalysisStatus(qualityGate, valuationReadiness, mappingAudit),
    [mappingAudit, qualityGate, valuationReadiness],
  );
  const policyVersions = useMemo(() => getAnalysisPolicyVersions(), []);
  const latestPeriod = rawData && rawData.length > 0 ? rawData[rawData.length - 1].period_end : null;
  const traceability = useMemo(
    () => buildAnalysisTraceability({
      runId: auditMeta?.runId ?? null,
      companyId: rawData?.[0]?.company_id ?? null,
      sourceMode: auditMeta?.sourceMode ?? null,
      rawData,
      recastData,
      config,
      periodCount: rawData?.length ?? 0,
      recastPeriodCount: recastData?.length ?? 0,
      latestPeriod,
      qualityGate,
      mappingAudit,
      policyVersions,
      analysisStatus,
      hasDebugInfo: Boolean(debugInfo),
      debugFiles: debugInfo?.files?.length ?? 0,
      rawMetricKeyCount: debugInfo?.rawMetricKeys?.length ?? 0,
      engineError,
      debugInfo,
      contentClass: auditMeta?.contentClass ?? null,
      retentionDays: auditMeta?.retentionDays ?? null,
      runInspectorEnabled: Boolean(auditMeta?.runAccessToken),
    }),
    [analysisStatus, auditMeta, config, debugInfo, engineError, latestPeriod, mappingAudit, policyVersions, qualityGate, rawData, recastData],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rf = Number(params.get("rf"));
    const erp = Number(params.get("erp"));
    const company = params.get("company");
    const tab = params.get("tab") as TabId | null;
    const dark = params.get("dark");
    setConfig((prev) => ({
      ...prev,
      risk_free_rate: Number.isFinite(rf) && rf > 0 ? rf / 100 : prev.risk_free_rate,
      equity_risk_premium: Number.isFinite(erp) && erp > 0 ? erp / 100 : prev.equity_risk_premium,
      ticker: company || prev.ticker,
    }));
    if (tab && TABS.some((t) => t.id === tab)) setActiveTab(tab);
    if (dark === "1") setDarkMode(true);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("rf", (config.risk_free_rate * 100).toFixed(2));
    params.set("erp", (config.equity_risk_premium * 100).toFixed(2));
    if (config.ticker) params.set("company", config.ticker);
    params.set("tab", activeTab);
    params.set("dark", darkMode ? "1" : "0");
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", next);
  }, [config.risk_free_rate, config.equity_risk_premium, config.ticker, activeTab, darkMode]);

  // Keep the registry entry's recastData in sync whenever the memo re-derives it
  // (i.e. when config changes or new data is uploaded).
  useEffect(() => {
    if (!rawData || !recastData) return;
    const id = rawData[0]?.company_id || "";
    if (!id) return;
    setRegistry((prev) => {
      const existing = prev.companies[id];
      if (!existing) return prev;
      return {
        companies: {
          ...prev.companies,
          [id]: { ...existing, recastData, traceability },
        },
      };
    });
  }, [rawData, recastData, traceability]);

  // If rawData was submitted but recastData comes back null, navigate to debug tab.
  useEffect(() => {
    if (rawData && rawData.length > 0 && recastData === null) {
      setActiveTab("debug");
    }
  }, [rawData, recastData, engineError]);

  const handleDataSubmit = useCallback(
    (data:RawPeriodData[], debug?:CapitalineParseDebug, meta?: AuditSubmissionMeta) => {
      const nextMeta = meta ?? {
        runId: createAuditRunId(),
        sourceMode: "manual",
        companyId: data[0]?.company_id || `CO-${Date.now()}`,
        fileName: null,
        runAccessToken: createAuditAccessToken(),
        contentClass: auditGovernance.contentClass,
        retentionDays: auditGovernance.retentionDays,
      };
      rememberAuditRun(nextMeta);
      setAuditMeta(nextMeta);
      lastAuditSignatureRef.current = null;
      lastAuditStatusRef.current = null;
      lastTabAuditRef.current = null;
      setConfig((prev) => ({
        ...prev,
        ticker: nextMeta.companyId || data[0]?.company_id || prev.ticker,
      }));
      setWorkspaceCompanyId(nextMeta.companyId || data[0]?.company_id || null);
      setRawData(data);
      if (debug) setDebugInfo(debug);
      if (data.length === 0) { setActiveTab("debug"); return; }
      // recastData is now derived reactively via useMemo(rawData, config).
      // We just store rawData; the memo takes care of processing.
      const id = data[0]?.company_id || `CO-${Date.now()}`;
      setRegistry((prev) => ({
        companies: {
          ...prev.companies,
          // recastData placeholder — ComparisonReport reads from registry, so we
          // also update registry when recastData memo resolves (see useEffect below).
          [id]: { id, label: id, rawData: data, recastData: [], traceability: null },
        },
      }));
      setActiveTab("statements");
    },
    [auditGovernance.contentClass, auditGovernance.retentionDays]
  );

  useEffect(() => {
    if (!auditMeta || !rawData) return;

    const snapshot = buildAnalysisSnapshot({
      rawData,
      recastData,
      config,
      debugInfo,
      qualityGate,
      mappingAudit,
      engineError,
      analysisStatus,
      auditMeta,
    });
    const signature = JSON.stringify(snapshot);
    if (signature === lastAuditSignatureRef.current) return;
    lastAuditSignatureRef.current = signature;

    void persistAuditEvent({
      runId: auditMeta.runId,
      eventType: "analysis-snapshot",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: snapshot,
    });
  }, [analysisStatus, auditMeta, config, debugInfo, engineError, mappingAudit, qualityGate, rawData, recastData]);

  useEffect(() => {
    if (!auditMeta || !engineError) return;

    void persistAuditEvent({
      runId: auditMeta.runId,
      eventType: "engine-error",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: {
        error: engineError,
      },
    });
  }, [auditMeta, engineError]);

  useEffect(() => {
    if (!auditMeta || !rawData) return;

    const nextStatus = engineError
      ? `analysis-error:${engineError}`
      : recastData && recastData.length > 0
        ? `analysis-ready:${recastData.length}`
        : "data-loaded";

    if (lastAuditStatusRef.current === nextStatus) return;
    lastAuditStatusRef.current = nextStatus;

    void persistAuditEvent({
      runId: auditMeta.runId,
      eventType: engineError ? "run-status-error" : recastData && recastData.length > 0 ? "run-status-analysis-ready" : "run-status-data-loaded",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: {
        activeTab,
        periodCount: rawData.length,
        recastPeriodCount: recastData?.length ?? 0,
        error: engineError ?? null,
      },
    });
  }, [activeTab, auditMeta, engineError, rawData, recastData]);

  useEffect(() => {
    if (!auditMeta) return;

    const tabKey = `${auditMeta.runId}:${activeTab}`;
    if (lastTabAuditRef.current === tabKey) return;
    lastTabAuditRef.current = tabKey;

    void persistAuditEvent({
      runId: auditMeta.runId,
      eventType: "ui-tab-changed",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: {
        activeTab,
      },
    });
  }, [activeTab, auditMeta]);

  const hasRecast = (recastData?.length??0)>0;
  const hasDebug  = debugInfo!==null;
  const workspaceCompanies = listWorkspaceCompanies();
  const hasWorkspace = hasRecast || Boolean(rawData?.length) || workspaceCompanies.length > 0;

  const readyCompanyCount = Object.values(registry.companies).filter((c) => c.recastData.length > 0).length;

  const visibleTabs = TABS.filter(t=>{
    if (t.id==="debug") return hasDebug;
    if (t.id === "comparison") return readyCompanyCount >= 2;
    if (t.id === "inspector") return isAuditEnabled() && Boolean(auditMeta);
    if (t.id === "watchlist") return hasWorkspace;
    if (t.id === "workspace") return hasWorkspace;
    if (t.needsData) return hasRecast;
    return true;
  });

  const valuationBlocked = Boolean(qualityGate?.valuationBlocked);
  const scopeBlocked = Boolean(qualityGate?.scopeAssessment.blocked);

  // Pass the full config — ForecastReport (and any engine calls it triggers) may
  // access fields like tax_rate_mode, oci_treated_as_unusual, etc. Passing a
  // partial object caused silent undefined accesses for those fields.
  const forecastConfig = config;

  useEffect(() => {
    if (!rawData && !recastData) return;
    rememberWorkspaceAnalysis({
      rawData,
      recastData,
      config,
      analysisStatus,
      auditMeta,
    });
  }, [analysisStatus, auditMeta, config, rawData, recastData]);

  useEffect(() => {
    const companyId = auditMeta?.companyId ?? rawData?.[0]?.company_id ?? null;
    if (!companyId) return;
    const workspaceCompanies = listWorkspaceCompanies();
    const record = workspaceCompanies.find((item) => item.companyId === companyId) ?? null;
    if (!record) return;
    void syncWorkspaceProfile(record);
    if (record.analysisHistory[0]) void syncWorkspaceAnalysis(companyId, record.analysisHistory[0]);
  }, [analysisStatus, auditMeta?.companyId, rawData]);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 shadow-sm">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-0 flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">PN</div>
              <div>
                <span className="font-bold text-slate-800 text-sm">Penman–Nissim V3</span>
                <span className="hidden sm:inline text-xs text-slate-400 ml-2">Residual-Income Valuation · Capitaline Ind AS</span>
              </div>
            </div>
            <nav className="flex h-full overflow-x-auto">
              {visibleTabs.map(tab=>(
                <button
                  key={tab.id}
                  onClick={() => {
                    if (tab.id === "valuation" && valuationBlocked) return;
                    setActiveTab(tab.id);
                  }}
                  title={
                    tab.id === "valuation" && valuationBlocked
                      ? scopeBlocked
                        ? "Unsupported financial-company scope. See Debug tab."
                        : "Valuation blocked by quality gate. See Debug tab."
                      : undefined
                  }
                  disabled={tab.id === "valuation" && valuationBlocked}
                  className={`px-3 h-full text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                    activeTab===tab.id
                      ? "border-indigo-600 text-indigo-600"
                      : tab.id === "valuation" && valuationBlocked
                        ? "border-transparent text-slate-300 cursor-not-allowed"
                        : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                  }`}>
                  <span>{tab.icon}</span>
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </nav>
            <div className="ml-3 flex items-center gap-2">
              {isAuditEnabled() && auditMeta && (
                <span className="hidden lg:inline-flex px-2 py-1 text-[11px] rounded border border-emerald-200 bg-emerald-50 text-emerald-700">
                  Audit run {auditMeta.runId.slice(0, 8)}
                </span>
              )}
              {rawData && <AnalysisStatusBadge status={analysisStatus} compact />}
              <button
                onClick={() => setDarkMode((v) => !v)}
                className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                title="Toggle dark mode"
              >
                {darkMode ? "☀️" : "🌙"}
              </button>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(window.location.href);
                }}
                className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                title="Copy shareable link"
              >
                🔗
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
          {qualityGate && (
            <div className="mb-5">
              <AnalysisStatusBadge status={analysisStatus} />
            </div>
          )}
          {engineError && (
            <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <strong>Engine Error:</strong> {engineError}
            </div>
          )}
          <Suspense fallback={<TabSkeleton />}>
            {activeTab==="inspector" && <RunInspector auditMeta={auditMeta} analysisStatus={analysisStatus} />}
            {activeTab==="upload" && (
              <DataEntry onDataSubmit={handleDataSubmit} currentData={rawData} config={config} onConfigChange={setConfig}/>
            )}
            {activeTab==="watchlist" && (
              <WatchlistDashboard
                companies={workspaceCompanies}
                activeCompanyId={workspaceCompanyId}
                onSelectCompany={(companyId) => {
                  setWorkspaceCompanyId(companyId);
                  setActiveTab("workspace");
                }}
              />
            )}
            {activeTab==="workspace" && (
              <CompanyWorkspace
                rawData={rawData}
                recastData={recastData}
                config={config}
                analysisStatus={analysisStatus}
                auditMeta={auditMeta}
                registry={registry}
                selectedCompanyId={workspaceCompanyId}
                onSelectCompanyId={setWorkspaceCompanyId}
              />
            )}
            {activeTab==="statements" && hasRecast && <RecastStatements data={recastData!}/>}
            {activeTab==="ratios"     && hasRecast && <RatioReport data={recastData!} traceability={traceability} />}
            {activeTab==="forecast"   && hasRecast && <ForecastReport data={recastData!} rawData={rawData} config={forecastConfig} traceability={traceability} />}
            {activeTab==="valuation"  && hasRecast && !valuationBlocked && (
              <ValuationReport data={recastData!} config={config} analysisStatus={analysisStatus} auditMeta={auditMeta} traceability={traceability} />
            )}
            {activeTab === "valuation" && !hasRecast && scopeBlocked && rawData && rawData.length > 0 && (
              <FinancialInstitutionReport rawData={rawData} config={config} />
            )}
            {activeTab === "valuation" && hasRecast && valuationBlocked && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
                <h3 className="font-semibold text-lg">
                  {scopeBlocked ? "Industrial analysis blocked for unsupported scope" : "Valuation blocked by Fail-fast Quality Gate"}
                </h3>
                <p className="text-sm mt-1">
                  {scopeBlocked
                    ? "This dataset looks like a bank, NBFC, or insurance company. Use the Debug tab to inspect scope signals and route it to a sector-specific framework."
                    : "Resolve critical mapping gaps first. Open the Debug tab to see unresolved critical keys by statement."}
                </p>
                {qualityGate?.blockingReasons?.length ? (
                  <ul className="list-disc pl-5 mt-3 text-sm space-y-1">
                    {qualityGate.blockingReasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                ) : null}
              </div>
            )}
            {activeTab==="quality"    && hasRecast && <QualityReport data={recastData!} traceability={traceability} />}
            {activeTab==="comparison" && <ComparisonReport registry={registry} config={config} />}
            {activeTab==="report"     && hasRecast && <AcademicReport data={recastData!} config={config} rawData={rawData} auditMeta={auditMeta} />}
            {activeTab==="regression" && hasRecast && (
              <RegressionReport
                rawData={rawData}
                recastData={recastData}
                config={config}
                registry={registry}
                traceability={traceability}
              />
            )}
            {activeTab==="v3analytics" && hasRecast && <V3AnalyticsPanel data={recastData!} config={config}/>}
            {activeTab==="debug" && <DebugPanel debugInfo={debugInfo} recastData={recastData} rawData={rawData} qualityGate={qualityGate} engineError={engineError}/>}
            {(["statements","ratios","forecast","valuation","quality","report","regression","v3analytics"] as TabId[]).includes(activeTab) && !hasRecast && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="text-6xl mb-4">📂</div>
                <p className="text-xl font-semibold text-slate-600">No data loaded</p>
                <button onClick={()=>setActiveTab("upload")}
                  className="mt-6 px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700">
                  Go to Upload
                </button>
              </div>
            )}
          </Suspense>
        </main>
      </div>
    </ErrorBoundary>
  );
}

function TabSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
      <div className="mt-4 h-3 w-72 animate-pulse rounded bg-slate-100" />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      </div>
    </div>
  );
}
