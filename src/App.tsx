import { useState, useCallback, useMemo } from "react";
import { RawPeriodData, RecastPeriod, DEFAULT_CONFIG, EngineConfig } from "./engine/types";
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
import DebugPanel from "./components/DebugPanel";

type TabId = "upload"|"statements"|"ratios"|"forecast"|"valuation"|"quality"|"report"|"debug";

const TABS: {id:TabId;label:string;icon:string;needsData?:boolean}[] = [
  {id:"upload",     label:"Data",       icon:"📂"},
  {id:"statements", label:"Statements", icon:"📊", needsData:true},
  {id:"ratios",     label:"Ratios",     icon:"📐", needsData:true},
  {id:"forecast",   label:"Forecast",   icon:"📈", needsData:true},
  {id:"valuation",  label:"Valuation",  icon:"💰", needsData:true},
  {id:"quality",    label:"Quality",    icon:"🔍", needsData:true},
  {id:"report",     label:"Report",     icon:"📚", needsData:true},
  {id:"debug",      label:"Debug",      icon:"🛠"},
];

export function App() {
  const [rawData,    setRawData]    = useState<RawPeriodData[]|null>(null);
  const [recastData, setRecastData] = useState<RecastPeriod[]|null>(null);
  const [debugInfo,  setDebugInfo]  = useState<CapitalineParseDebug|null>(null);
  const [activeTab,  setActiveTab]  = useState<TabId>("upload");
  const [config,     setConfig]     = useState<EngineConfig>(DEFAULT_CONFIG);

  const qualityGate = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;
    return evaluateQualityGate(rawData);
  }, [rawData]);

  const handleDataSubmit = useCallback(
    (data:RawPeriodData[], debug?:CapitalineParseDebug) => {
      setRawData(data);
      if (debug) setDebugInfo(debug);
      if (data.length===0) { setRecastData(null); setActiveTab("debug"); return; }
      try {
        const processed = processCompanyData(data,config);
        setRecastData(processed.length>0 ? processed : null);
        setActiveTab(processed.length>0 ? "statements" : "debug");
      } catch(err) {
        console.error("[App] engine error:",err);
        setRecastData(null);
        setActiveTab("debug");
      }
    },
    [config]
  );

  const hasRecast = (recastData?.length??0)>0;
  const hasDebug  = debugInfo!==null;

  const visibleTabs = TABS.filter(t=>{
    if (t.id==="debug") return hasDebug;
    if (t.needsData) return hasRecast;
    return true;
  });

  const valuationBlocked = Boolean(qualityGate?.valuationBlocked);

  const forecastConfig = {
    risk_free_rate: config.risk_free_rate,
    equity_risk_premium: config.equity_risk_premium,
    statutory_tax_rate: config.statutory_tax_rate,
    separation_confidence_threshold: config.separation_confidence_threshold,
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-0 flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">PN</div>
              <div>
                <span className="font-bold text-slate-800 text-sm">Penman–Nissim V2</span>
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
                  : "All critical mappings resolved; valuation is enabled."}
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
          {activeTab==="report"     && hasRecast && <AcademicReport data={recastData!} config={config} />}
          {activeTab==="debug" && <DebugPanel debugInfo={debugInfo} recastData={recastData} rawData={rawData} qualityGate={qualityGate}/>}
          {(["statements","ratios","forecast","valuation","quality","report"] as TabId[]).includes(activeTab) && !hasRecast && (
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
