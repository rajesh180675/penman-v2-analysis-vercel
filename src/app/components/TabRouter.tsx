import { lazy, Suspense } from "react";
import { RawPeriodData, RecastPeriod, EngineConfig, CompanyRegistry } from "../../engine/types";
import { AnalysisStatusSummary } from "../../engine/analysisStatus";
import { AuditSubmissionMeta } from "../../lib/audit";
import { CapitalineParseDebug } from "../../engine/capitalineParser";
import type { FinancialInstitutionAnalysisResult } from "../../engine/analysisFamily";
import type { ScopeAwareResult } from "../../engine/scopeAwareLoader";
import type { LiveMarketDataSnapshot } from "../../engine/marketData";
import type { ValuationCommandCenterOutput } from "../../engine/valuationCommandCenter";
import type { SourcedAssumptionSet, UnifiedAnalysisWindow } from "../../engine/analysisCase";
import type { IndustrialForecastResult, ScenarioOrderingReport } from "../../engine/forecastState";
import type { ScenarioGovernanceReport } from "../../engine/valuationEvidence";
import type { ITServicesSignal } from "../../engine/itServicesDetector";
import { marketCapCroreFromPrice } from "../../engine/types/units";
import type { TabId } from "../tabs";
import DataEntry from "../../components/DataEntry";
import type { ReturnTypeOfPortfolioComparison } from "../../engine/portfolioRunComparison.types";

const RecastStatements = lazy(() => import("../../components/RecastStatements"));
const RatioReport = lazy(() => import("../../components/RatioReport"));
const QualityReport = lazy(() => import("../../components/QualityReport"));
const SubsidiaryContributionPanel = lazy(() => import("../../components/dashboard/SubsidiaryContributionPanel"));
const ValuationReport = lazy(() => import("../../components/ValuationReport"));
const FinancialInstitutionReport = lazy(() => import("../../components/FinancialInstitutionReport"));
const ForecastReport = lazy(() => import("../../components/ForecastReport"));
const AcademicReport = lazy(() => import("../../components/AcademicReport"));
const RegressionReport = lazy(() => import("../../components/RegressionReport"));
const ComparisonReport = lazy(() => import("../../components/ComparisonReport"));
const DebugPanel = lazy(() => import("../../components/DebugPanel"));
const V3AnalyticsPanel = lazy(() => import("../../components/V3AnalyticsPanel"));
const AtlasReport = lazy(() => import("../../components/atlas/AtlasReport"));
const BusinessModelReport = lazy(() => import("../../components/business-model/BusinessModelReport"));
const RunInspector = lazy(() => import("../../components/RunInspector"));
const CompanyWorkspace = lazy(() => import("../../components/CompanyWorkspace"));
const WatchlistDashboard = lazy(() => import("../../components/WatchlistDashboard"));
const InvestmentThesis = lazy(() => import("../../components/InvestmentThesis"));
const DashboardView = lazy(() => import("../../components/dashboard/DashboardView"));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = any;

interface TabRouterProps {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  config: EngineConfig;
  setConfig: (c: EngineConfig) => void;
  forecastConfig: EngineConfig;
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  hasRecast: boolean;
  handleDataSubmit: AnyResult;
  onBatchSubmit?: (registry: CompanyRegistry) => void;
  auditMeta: AuditSubmissionMeta | null;
  analysisStatus: AnalysisStatusSummary;
  traceability: AnyResult;
  publication: AnyResult;
  ratioSanity: AnyResult;
  segmentData: AnyResult;
  liveMarketData: AnyResult;
  liveMarketDataLoading: boolean;
  liveMarketDataError: string | null;
  refreshLiveMarketData: () => Promise<void>;
  commandCenter: ValuationCommandCenterOutput | null;
  analysisWindow: UnifiedAnalysisWindow | null;
  sourcedAssumptionSet: SourcedAssumptionSet | null;
  forecastResults: readonly IndustrialForecastResult[] | null;
  scenarioOrdering: ScenarioOrderingReport | null;
  scenarioGovernance: ScenarioGovernanceReport | null;
  readyCompanyCount: number;
  bankResult: FinancialInstitutionAnalysisResult | null;
  nbfcSidecar: AnyResult;
  lossMakerResult: AnyResult;
  /**
   * Phase E3 — IT-services fingerprint. Already surfaced as a banner by
   * `AnalysisBanners`; the moat scorer needs the same signal to mark its own
   * classification unreliable, and it can only reach it through here.
   */
  itServicesSignal: ITServicesSignal | null;
  registry: CompanyRegistry;
  comparisonPublication: AnyResult;
  portfolioRunComparison: ReturnTypeOfPortfolioComparison;
  workspaceCompanies: AnyResult;
  workspaceCompanyId: string | null;
  setWorkspaceCompanyId: (id: string | null) => void;
  valuationBlocked: boolean;
  scopeBlocked: boolean;
  qualityGate: AnyResult;
  scopeAwareResult: ScopeAwareResult | null;
  pipelineResult: AnyResult;
  debugInfo: CapitalineParseDebug | null;
  engineError: string | null;
}

export function TabRouter(props: TabRouterProps) {
  const {
    activeTab, setActiveTab, config, setConfig, forecastConfig, rawData, recastData, hasRecast,
    handleDataSubmit, onBatchSubmit, auditMeta, analysisStatus, traceability, publication, ratioSanity, segmentData,
    liveMarketData, liveMarketDataLoading, liveMarketDataError, refreshLiveMarketData, commandCenter,
    analysisWindow, sourcedAssumptionSet, forecastResults, scenarioOrdering, scenarioGovernance,
    readyCompanyCount, bankResult, nbfcSidecar, lossMakerResult, itServicesSignal, registry,
    comparisonPublication, portfolioRunComparison, workspaceCompanies, workspaceCompanyId, setWorkspaceCompanyId,
    valuationBlocked, scopeBlocked, qualityGate, scopeAwareResult, pipelineResult, debugInfo, engineError,
  } = props;

  const marketCapCr = config.market_price != null && config.shares_outstanding != null
    ? marketCapCroreFromPrice(config.market_price, config.shares_outstanding)
    : null;
  const companyId = auditMeta?.companyId ?? rawData?.[0]?.company_id ?? null;

  return (
    <Suspense fallback={<TabSkeleton />}>
      {activeTab === "inspector" && <RunInspector auditMeta={auditMeta} analysisStatus={analysisStatus} />}
      {activeTab === "upload" && (
        <DataEntry onDataSubmit={handleDataSubmit} onBatchSubmit={onBatchSubmit} currentData={rawData} config={config} onConfigChange={setConfig} />
      )}
      {activeTab === "dashboard" && hasRecast && (
        <DashboardView
          data={recastData!}
          config={config}
          traceability={traceability}
          ratioSanity={ratioSanity}
          segmentData={segmentData}
          marketData={liveMarketData}
          peerCount={readyCompanyCount}
          onNavigate={(tab) => setActiveTab(tab as TabId)}
          itServices={itServicesSignal}
        />
      )}
      {/* Bank/NBFC dashboard: show FinancialInstitutionReport when no industrial recast */}
      {activeTab === "dashboard" && !hasRecast && bankResult && (
        <FinancialInstitutionReport
          bankResult={bankResult}
          config={config}
          companyId={companyId}
          auditRunId={auditMeta?.runId ?? null}
          marketCapCr={marketCapCr}
          nbfcSidecar={nbfcSidecar}
        />
      )}
      {activeTab === "watchlist" && (
        <WatchlistDashboard
          companies={workspaceCompanies}
          activeCompanyId={workspaceCompanyId}
          onSelectCompany={(companyId) => {
            setWorkspaceCompanyId(companyId);
            setActiveTab("workspace");
          }}
        />
      )}
      {activeTab === "workspace" && (
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
      {activeTab === "statements" && hasRecast && <RecastStatements data={recastData!} traceability={traceability} traceabilitySummary={publication?.traceabilitySummary ?? null} />}
      {activeTab === "ratios" && hasRecast && <RatioReport data={recastData!} config={config} traceability={traceability} traceabilitySummary={publication?.traceabilitySummary ?? null} />}
      {activeTab === "ratios" && !hasRecast && bankResult && (
        <FinancialInstitutionReport
          bankResult={bankResult}
          config={config}
          companyId={companyId}
          auditRunId={auditMeta?.runId ?? null}
          marketCapCr={marketCapCr}
          nbfcSidecar={nbfcSidecar}
        />
      )}
      {activeTab === "forecast" && hasRecast && <ForecastReport
        data={recastData!}
        rawData={rawData}
        config={forecastConfig}
        traceability={traceability}
        traceabilitySummary={publication?.traceabilitySummary ?? null}
        runForecastResults={forecastResults}
        analysisWindow={analysisWindow}
        sourcedAssumptionSet={sourcedAssumptionSet}
        scenarioOrdering={scenarioOrdering}
        scenarioGovernance={scenarioGovernance}
      />}
      {activeTab === "valuation" && hasRecast && !valuationBlocked && (
        <ValuationReport
          data={recastData!}
          config={config}
          analysisStatus={analysisStatus}
          auditMeta={auditMeta}
          traceability={traceability}
          publication={publication}
          lossMaker={lossMakerResult}
          ratioSanity={ratioSanity}
          segmentData={segmentData}
          commandCenter={commandCenter}
          marketData={liveMarketData as LiveMarketDataSnapshot | null}
          marketDataLoading={liveMarketDataLoading}
          marketDataError={liveMarketDataError}
          onMarketRefresh={refreshLiveMarketData}
          itServices={itServicesSignal}
        />
      )}
      {activeTab === "valuation" && !hasRecast && bankResult && rawData && rawData.length > 0 && (
        <FinancialInstitutionReport
          bankResult={bankResult}
          config={config}
          companyId={companyId}
          auditRunId={auditMeta?.runId ?? null}
          marketCapCr={marketCapCr}
          nbfcSidecar={nbfcSidecar}
        />
      )}
      {activeTab === "bank" && bankResult && (
        <FinancialInstitutionReport
          bankResult={bankResult}
          config={config}
          companyId={companyId}
          auditRunId={auditMeta?.runId ?? null}
          marketCapCr={marketCapCr}
          nbfcSidecar={nbfcSidecar}
        />
      )}
      {activeTab === "bank" && !bankResult && rawData && rawData.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
          <h3 className="font-semibold text-lg mb-1">Bank pipeline not active</h3>
          <p>This dataset routed to the industrial Penman-Nissim pipeline, not the bank pipeline. Use the Valuation tab instead.</p>
        </div>
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
              {qualityGate.blockingReasons.map((r: string) => <li key={r}>{r}</li>)}
            </ul>
          ) : null}
        </div>
      )}
      {activeTab === "quality" && hasRecast && <QualityReport data={recastData!} traceability={traceability} traceabilitySummary={publication?.traceabilitySummary ?? null} />}
      {activeTab === "quality" && !hasRecast && bankResult && (
        <FinancialInstitutionReport
          bankResult={bankResult}
          config={config}
          companyId={companyId}
          auditRunId={auditMeta?.runId ?? null}
          marketCapCr={marketCapCr}
          nbfcSidecar={nbfcSidecar}
        />
      )}
      {/* Phase A — Scope tab: subsidiary contribution panel (cons − stan gap) */}
      {activeTab === "scope" && scopeAwareResult && <SubsidiaryContributionPanel result={scopeAwareResult} />}
      {activeTab === "atlas" && (
        <AtlasReport
          rawData={rawData}
          pipelineResult={pipelineResult && !("error" in pipelineResult) ? pipelineResult : null}
        />
      )}
      {activeTab === "business" && (
        <BusinessModelReport
          pipelineResult={pipelineResult && !("error" in pipelineResult) ? pipelineResult : null}
          recastData={recastData}
        />
      )}
      {activeTab === "comparison" && <ComparisonReport registry={registry} config={config} publication={comparisonPublication} runComparison={portfolioRunComparison} />}
      {activeTab === "thesis" && hasRecast && (
        <InvestmentThesis data={recastData!} config={config} itServices={itServicesSignal} />
      )}
      {activeTab === "report" && hasRecast && (
        <AcademicReport
          data={recastData!}
          config={config}
          rawData={rawData}
          auditMeta={auditMeta}
          traceability={traceability}
          publication={publication}
          ratioSanity={ratioSanity}
          itServices={itServicesSignal}
        />
      )}
      {activeTab === "report" && !hasRecast && bankResult && (
        <FinancialInstitutionReport
          bankResult={bankResult}
          config={config}
          companyId={companyId}
          auditRunId={auditMeta?.runId ?? null}
          marketCapCr={marketCapCr}
          nbfcSidecar={nbfcSidecar}
        />
      )}
      {activeTab === "regression" && hasRecast && (
        <RegressionReport
          rawData={rawData}
          recastData={recastData}
          config={config}
          registry={registry}
          traceability={traceability}
          traceabilitySummary={publication?.traceabilitySummary ?? null}
        />
      )}
      {activeTab === "v3analytics" && hasRecast && <V3AnalyticsPanel data={recastData!} config={config} traceability={traceability} traceabilitySummary={publication?.traceabilitySummary ?? null} itServices={itServicesSignal} />}
      {activeTab === "debug" && <DebugPanel debugInfo={debugInfo} recastData={recastData} rawData={rawData} qualityGate={qualityGate} engineError={engineError} greenfield={pipelineResult?.greenfield ?? null} />}
      {/* Insurance / unsupported financial scope: show clear message on valuation tab */}
      {activeTab === "valuation" && !hasRecast && scopeBlocked && !bankResult && rawData && rawData.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <h3 className="font-semibold text-lg">Unsupported financial scope</h3>
          <p className="text-sm mt-1">
            This dataset was identified as an insurance company or mixed-financial conglomerate.
            The analysis pipeline does not yet support insurance economics (actuarial reserves,
            embedded value, policyholder liabilities). Use the Debug tab to inspect the scope
            signals and see why routing was blocked.
          </p>
          {qualityGate?.scopeAssessment?.signals?.length ? (
            <ul className="list-disc pl-5 mt-3 text-sm space-y-1">
              {qualityGate.scopeAssessment.signals.map((s: {kind: string; key: string; periodsObserved: number}, i: number) => (
                <li key={i}><span className="font-mono">{s.key}</span> ({s.kind}, {s.periodsObserved} periods)</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {(["statements", "forecast", "regression", "v3analytics"] as TabId[]).includes(activeTab) && !hasRecast && !bankResult && !(scopeBlocked && rawData && rawData.length > 0) && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-6xl mb-4">📂</div>
          <p className="text-xl font-semibold text-slate-600">No data loaded</p>
          <button onClick={() => setActiveTab("upload")}
            className="mt-6 px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700">
            Go to Upload
          </button>
        </div>
      )}
    </Suspense>
  );
}

function TabSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-8 shadow-sm">
      <div className="h-4 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-4 h-3 w-72 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      </div>
    </div>
  );
}
