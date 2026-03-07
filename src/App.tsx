import { useState, useCallback, useMemo, useEffect } from "react";
import { RawPeriodData, RecastPeriod, DEFAULT_CONFIG, EngineConfig, CompanyRegistry } from "./engine/types";
import { processCompanyData } from "./engine/pipeline";
import { CapitalineParseDebug } from "./engine/capitalineParser";
import { evaluateQualityGate } from "./engine/mappingAudit";
import { ErrorBoundary } from "./components/ErrorBoundary";
import DataEntry from "./components/DataEntry";
import RecastStatements from "./components/RecastStatements";
import RatioReport from "./components/RatioReport";
import ValuationReport from "./components/ValuationReport";
import QualityReport from "./components/QualityReport";
import ForecastReport from "./components/ForecastReport";
import AcademicReport from "./components/AcademicReport";
import RegressionReport from "./components/RegressionReport";
import ComparisonReport from "./components/ComparisonReport";
import DebugPanel from "./components/DebugPanel";
import V3AnalyticsPanel from "./components/V3AnalyticsPanel";

type TabId = "upload"|"statements"|"ratios"|"forecast"|"valuation"|"quality"|"comparison"|"report"|"regression"|"v3analytics"|"debug";

const TABS: {id:TabId;label:string;icon:string;needsData?:boolean}[] = [
  {id:"upload",     label:"Data",       icon:"📂"},
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
  const [rawData,    setRawData]    = useState<RawPeriodData[]|null>(null);
  const [debugInfo,  setDebugInfo]  = useState<CapitalineParseDebug|null>(null);
  const [activeTab,  setActiveTab]  = useState<TabId>("upload");
  const [config,     setConfig]     = useState<EngineConfig>(DEFAULT_CONFIG);
  const [darkMode, setDarkMode] = useState(false);
  const [registry, setRegistry] = useState<CompanyRegistry>({ companies: {} });

  // Derive recastData reactively from rawData + config so any config change (tax rate,
  // OCI treatment, hybrid-debt flag, etc.) immediately re-computes the analysis.
  const recastData = useMemo<RecastPeriod[] | null>(() => {
    if (!rawData || rawData.length === 0) return null;
    try {
      const processed = processCompanyData(rawData, config);
      return processed.length > 0 ? processed : null;
    } catch (err) {
      console.error("[App] engine error:", err);
      return null;
    }
  }, [rawData, config]);

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
          [id]: { ...existing, recastData },
        },
      };
    });
  }, [rawData, recastData]);

  // If rawData was submitted but recastData comes back null, navigate to debug tab.
  useEffect(() => {
    if (rawData && rawData.length > 0 && recastData === null) {
      setActiveTab("debug");
    }
  }, [rawData, recastData]);

  const qualityGate = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;
    return evaluateQualityGate(rawData);
  }, [rawData]);

  const handleDataSubmit = useCallback(
    (data:RawPeriodData[], debug?:CapitalineParseDebug) => {
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
          [id]: { id, label: id, rawData: data, recastData: [] },
        },
      }));
      setActiveTab("statements");
    },
    [config]
  );

  const hasRecast = (recastData?.length??0)>0;
  const hasDebug  = debugInfo!==null;

  const readyCompanyCount = Object.values(registry.companies).filter((c) => c.recastData.length > 0).length;

  const visibleTabs = TABS.filter(t=>{
    if (t.id==="debug") return hasDebug;
    if (t.id === "comparison") return readyCompanyCount >= 2;
    if (t.needsData) return hasRecast;
    return true;
  });

  const valuationBlocked = Boolean(qualityGate?.valuationBlocked);

  // Pass the full config — ForecastReport (and any engine calls it triggers) may
  // access fields like tax_rate_mode, oci_treated_as_unusual, etc. Passing a
  // partial object caused silent undefined accesses for those fields.
  const forecastConfig = config;

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
                  title={tab.id === "valuation" && valuationBlocked ? "Valuation blocked by quality gate. See Debug tab." : undefined}
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
            <div className={`mb-5 rounded-lg border p-3 text-sm ${
              qualityGate.tier === "Tier 1"
                ? "bg-green-50 border-green-200 text-green-800"
                : qualityGate.tier === "Tier 2"
                  ? "bg-amber-50 border-amber-200 text-amber-900"
                  : "bg-red-50 border-red-200 text-red-800"
            }`}>
              <strong>Quality Gate: {qualityGate.tier}</strong>
              <span className="ml-2">
                {qualityGate.valuationBlocked
                  ? "Valuation tab is blocked until critical mapping gaps are resolved."
                  : "Valuation is enabled."}
              </span>
            </div>
          )}
          {activeTab==="upload" && (
            <DataEntry onDataSubmit={handleDataSubmit} currentData={rawData} config={config} onConfigChange={setConfig}/>
          )}
          {activeTab==="statements" && hasRecast && <RecastStatements data={recastData!}/>}
          {activeTab==="ratios"     && hasRecast && <RatioReport data={recastData!}/>}
          {activeTab==="forecast"   && hasRecast && <ForecastReport data={recastData!} config={forecastConfig}/>}
          {activeTab==="valuation"  && hasRecast && !valuationBlocked && <ValuationReport data={recastData!} config={config}/>}
          {activeTab === "valuation" && hasRecast && valuationBlocked && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
              <h3 className="font-semibold text-lg">Valuation blocked by Fail-fast Quality Gate</h3>
              <p className="text-sm mt-1">Resolve critical mapping gaps first. Open the Debug tab to see unresolved critical keys by statement.</p>
              {qualityGate?.blockingReasons?.length ? (
                <ul className="list-disc pl-5 mt-3 text-sm space-y-1">
                  {qualityGate.blockingReasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              ) : null}
            </div>
          )}
          {activeTab==="quality"    && hasRecast && <QualityReport data={recastData!}/>}
          {activeTab==="comparison" && <ComparisonReport registry={registry} config={config} />}
          {activeTab==="report"     && hasRecast && <AcademicReport data={recastData!} config={config} rawData={rawData} />}
          {activeTab==="regression" && hasRecast && <RegressionReport rawData={rawData} recastData={recastData} config={config} />}
          {activeTab==="v3analytics" && hasRecast && <V3AnalyticsPanel data={recastData!} config={config}/>}
          {activeTab==="debug" && <DebugPanel debugInfo={debugInfo} recastData={recastData} rawData={rawData} qualityGate={qualityGate}/>}
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
        </main>
      </div>
    </ErrorBoundary>
  );
}
