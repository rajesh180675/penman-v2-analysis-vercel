import { useState, useCallback, useEffect, useRef } from "react";
import { useServerStatus } from "../hooks/useServerStatus";
import { useBankSidecars } from "../hooks/useBankSidecars";
import { useAuditPersistence } from "../hooks/useAuditPersistence";
import { useLiveMarketData } from "../hooks/useLiveMarketData";
import { RawPeriodData, CompanyRegistry } from "../engine/types";
import { CroreShares } from "../engine/types/units";
import { analysisFamilyFromScope, assessAnalysisScope } from "../engine/scopePolicy";
import { trace } from "../lib/traceLogger";
import { CapitalineParseDebug } from "../engine/capitalineParser";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { AnalysisStatusBadge } from "../components/AnalysisStatusBadge";
import GlossaryModal from "../components/GlossaryModal";
import KeyboardShortcutsModal from "../components/KeyboardShortcutsModal";
import CommandPalette from "../components/CommandPalette";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useCommandPaletteShortcut } from "../hooks/useCommandPaletteShortcut";
import { useRegistryPersistence } from "../hooks/useRegistryPersistence";
import { useResidualsSync } from "../hooks/useResidualsSync";
import { useUrlSync } from "../hooks/useUrlSync";
import { mergeCompanyRegistries } from "../lib/companyRegistrySnapshot";
import {
  AuditSubmissionMeta,
  createAuditAccessToken,
  createAuditRunId,
  getAuditClientGovernance,
  rememberAuditRun,
} from "../lib/audit";
import { readPersistedCompanyRegistry } from "../lib/companyRegistryStore";
import { resolveNseSymbol, resolveFolderFromSymbol } from "../engine/nseSymbolRegistry";
import { SourceParserDiagnostics } from "../engine/parserDiagnostics";
import type { CanonicalFactIngestionBundle } from "../engine/facts";
import { TABS, type TabId } from "./tabs";
import { useRunBackedAuditAnalysis } from "./useRunBackedAuditAnalysis";
import { usePlatformGovernanceEvidence } from "./platformGovernance";
import { useConfigManager } from "./useConfigManager";
import { useWorkspaceSync } from "./useWorkspaceSync";
import { useTabVisibility } from "./useTabVisibility";
import { AppHeader } from "./components/AppHeader";
import { SidebarNav } from "./components/SidebarNav";
import { CompanyContextStrip } from "./components/CompanyContextStrip";
import { AnalysisBanners } from "./components/AnalysisBanners";
import { TabRouter } from "./components/TabRouter";
import { AnalysisRunStatusBar } from "./components/AnalysisRunStatusBar";
import { resolvePostIngestionDeepLinkTab } from "./deepLinkRouting";

export function AppShell() {
  const auditGovernance = getAuditClientGovernance();
  const serverStatus = useServerStatus();
  const [rawData, setRawData] = useState<RawPeriodData[] | null>(null);
  // Phase A — standalone dataset (Indian companies file BOTH consolidated AND
  // standalone statements). When present, scopeAwareResult below carries the
  // gap analysis (cons − stan = subsidiary contribution). null when only
  // consolidated was loaded (manual upload or company without standalone ZIP).
  const [standaloneRawData, setStandaloneRawData] = useState<RawPeriodData[] | null>(null);
  const [debugInfo, setDebugInfo] = useState<CapitalineParseDebug | null>(null);
  const [parserDiagnostics, setParserDiagnostics] = useState<SourceParserDiagnostics | null>(null);
  const [canonicalFacts, setCanonicalFacts] = useState<CanonicalFactIngestionBundle | null>(null);
  const [segmentData, setSegmentData] = useState<import("../engine/segmentParser").AllSegmentData | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("upload");
  const requestedDeepLinkTabRef = useRef<TabId | null>((() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (!params.get("company")) return null;
    const requested = params.get("tab") as TabId | null;
    return requested && TABS.some((tab) => tab.id === requested) ? requested : null;
  })());
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Vim-style keyboard shortcuts (g+letter for tabs, ? for help, Shift+? for glossary)
  const keyboardSetActiveTab = useCallback((tab: string) => {
    setActiveTab(tab as TabId);
  }, []);
  useKeyboardShortcuts({
    setActiveTab: keyboardSetActiveTab,
    setGlossaryOpen,
    setShortcutsOpen,
    enabled: !glossaryOpen && !shortcutsOpen && !paletteOpen,
  });

  // Cmd+K / Ctrl+K opens the command palette (works even when typing)
  useCommandPaletteShortcut(setPaletteOpen);
  const [registry, setRegistry] = useState<CompanyRegistry>(() => readPersistedCompanyRegistry());
  const [auditMeta, setAuditMeta] = useState<AuditSubmissionMeta | null>(null);
  const [workspaceCompanyId, setWorkspaceCompanyId] = useState<string | null>(null);
  const { sharedRegistryStatus } = useRegistryPersistence(registry, setRegistry);

  // ── Config manager (extracted hook) ────────────────────────────────
  // Owns config state, URL hydration, dark mode.
  // configRef always holds the latest config — no more stale closures.
  const { config, setConfig, configRef, darkMode, setDarkMode } = useConfigManager(setActiveTab);

  // Live market data — fetched at App level so Dashboard + Valuation both have it
  const {
    snapshot: liveMarketData,
    loading: liveMarketDataLoading,
    error: liveMarketDataError,
    refresh: refreshLiveMarketData,
  } = useLiveMarketData({
    provider: config.market_data_provider as any ?? "nse",
    symbol: config.market_data_symbol ?? config.ticker ?? null,
    fallbackPrice: config.market_price ?? null,
    fallbackRiskFreeRate: config.risk_free_rate ?? null,
  });

  // Phase B5 — Bank/NBFC quality sidecars (extracted to useBankSidecars hook).
  const { bankQuality, nbfcSidecar } = useBankSidecars(config, rawData);
  const analysisAsOf = new Date().toISOString().slice(0, 10);
  const platformGovernance = usePlatformGovernanceEvidence(auditMeta?.companyId ?? rawData?.[0]?.company_id ?? null, analysisAsOf);

  // The reactive derivation chain (extracted to useAuditAnalysis hook).
  const {
    valuationDataSelection,
    qualityGate,
    scopeGate,
    mappingAudit,
    pipelineResult,
    scopeAwareResult,
    bankResult,
    structuralBreakPeriods,
    lossMakerResult,
    itServicesSignal,
    cyclicalitySignal,
    ratioSanity,
    recastData,
    engineError,
    qualityGateWithRecast,
    analysisStatus,
    traceability,
    publication,
    comparisonPublication,
    portfolioRunComparison,
    commandCenter,
    analysisWindow,
    sourcedAssumptionSet,
    forecastResults,
    scenarioOrdering,
    scenarioGovernance,
    analysisRun,
    analysisRunState,
  } = useRunBackedAuditAnalysis({
    rawData: platformGovernance.blocksAnalysis ? null : rawData,
    standaloneRawData,
    config,
    bankQuality,
    debugInfo,
    parserDiagnostics,
    auditMeta,
    registry,
    liveMarketData,
    segmentData,
    canonicalFacts,
    scenarioCalibration: platformGovernance.scenarioCalibration,
    sectorSidecar: platformGovernance.sectorSidecar,
    advancedModels: platformGovernance.advancedModels,
  });

  // Record dual-scope availability so QA can verify the second ZIP loaded.
  // Goes through the trace logger rather than the console: the Debug panel
  // reads traces, and useAuditAnalysis already reports its scope failures on
  // the same "scope" channel.
  useEffect(() => {
    if (scopeAwareResult) {
      trace("scope", "dualScopeAvailable", null, {
        alignedPeriods: scopeAwareResult.summary.alignedPeriods,
        medianPatContributionPct: scopeAwareResult.summary.medianPatContributionPct,
        patContributionTrend: scopeAwareResult.summary.patContributionTrend,
      });
    }
  }, [scopeAwareResult]);

  // True when breaks are detected and the user hasn't yet excluded any periods.
  const hasUnacknowledgedBreaks = structuralBreakPeriods.length > 0 &&
    (!config.excluded_periods || config.excluded_periods.length === 0);

  useUrlSync({
    riskFreeRate: config.risk_free_rate,
    equityRiskPremium: config.equity_risk_premium,
    ticker: config.ticker,
    activeTab,
    darkMode,
  });

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
          [id]: { ...existing, recastData, traceability, companyType: config.company_type ?? null },
        },
      };
    });
    // config.company_type included so the registry companyType field stays
    // current when the user changes type after loading data.
  }, [rawData, recastData, traceability, config.company_type]);

  // Auto-fill shares_outstanding from recast shareCountInput. This was
  // originally inside useConfigManager but recastData arrives after the
  // config hook initializes, so the effect lives here where both are available.
  useEffect(() => {
    if (!recastData || recastData.length === 0) return;
    if (config.shares_outstanding != null) return; // user already set it
    const latest = recastData[recastData.length - 1]!;
    const snap = latest.shareCountInput;
    if (!snap) return;
    const autoShares =
      snap.weightedAverageDilutedShares ??
      snap.weightedAverageBasicShares ??
      snap.endPeriodShares ??
      null;
    if (autoShares != null && autoShares > 0) {
      setConfig((prev) => {
        if (prev.shares_outstanding != null) return prev;
        // CroreShares branded import is used in the hook; inline here for clarity.
        return { ...prev, shares_outstanding: CroreShares(autoShares) };
      });
    }
  }, [recastData, config.shares_outstanding, setConfig]);

  // If rawData was submitted but recastData comes back null, navigate to an
  // appropriate fallback tab. Bank/NBFC datasets never produce industrial
  // recast — the bank-redirect effect below handles that case.
  useEffect(() => {
    const financialFallbackAvailable = Boolean(scopeGate?.scopeAssessment.blocked && rawData && rawData.length > 0 && recastData === null);
    if (rawData && rawData.length > 0 && recastData === null && !financialFallbackAvailable) {
      setActiveTab("debug");
    }
  }, [rawData, recastData, engineError, scopeGate]);

  const handleDataSubmit = useCallback(
    (
      data: RawPeriodData[],
      debug?: CapitalineParseDebug | undefined,
      meta?: AuditSubmissionMeta | undefined,
      nextParserDiagnostics?: SourceParserDiagnostics | null | undefined,
      nextSegmentData?: import("../engine/segmentParser").AllSegmentData | null | undefined,
      // Phase A — optional standalone dataset for dual-scope analysis.
      // Library cards with hasStandalone=true pass this in; manual uploads pass null.
      nextStandaloneData?: RawPeriodData[] | null | undefined,
      nextCanonicalFacts?: CanonicalFactIngestionBundle | null | undefined,
    ) => {
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
  setConfig((prev) => {
    const companyId = nextMeta.companyId || data[0]?.company_id || prev.ticker;
    const isDifferentCompany = companyId !== prev.ticker;
    // Resolve NSE symbol and quality-data folder if not already set.
    // This ensures manual uploads (which skip the library grid) also get
    // proper symbol/folder wiring so the sidecar fetch and live price work.
    const resolvedSymbol = (isDifferentCompany ? null : prev.market_data_symbol) ?? resolveNseSymbol(companyId) ?? null;
    const resolvedFolder = (isDifferentCompany ? null : prev.quality_data_folder) ?? resolveFolderFromSymbol(companyId) ?? companyId;
    return {
      ...prev,
      ticker: companyId,
      market_data_symbol: resolvedSymbol ?? undefined,
      quality_data_folder: resolvedFolder,
    };
  });
      setWorkspaceCompanyId(nextMeta.companyId || data[0]?.company_id || null);
      setRawData(data);
      // Phase A — store standalone (or clear it). Always set so a fresh upload
      // doesn't carry stale standalone from a previous company.
      setStandaloneRawData(nextStandaloneData ?? null);
      setParserDiagnostics(nextParserDiagnostics ?? null);
      setSegmentData(nextSegmentData ?? null);
      setCanonicalFacts(nextCanonicalFacts ?? null);
      if (debug) setDebugInfo(debug);
      else setDebugInfo(null);
  if (data.length === 0) { setActiveTab("debug"); return; }
  // We just store rawData; the memo takes care of processing.
  const id = data[0]?.company_id || `CO-${Date.now()}`;
  setRegistry((prev) => ({
    companies: {
      ...prev.companies,
      // recastData placeholder — ComparisonReport reads from registry, so we
      // also update registry when recastData memo resolves (see useEffect below).
      [id]: { id, label: id, rawData: data, recastData: [], traceability: null, companyType: config.company_type ?? null },
    },
  }));
  // Note: Bank/NBFC datasets will auto-redirect to "bank" tab via the
  // useEffect below (which detects bankResult && !hasRecast).
  // Industrial datasets land on "statements" which is the primary analysis view.
  // M2 fix: use configRef.current for the latest config, replacing the old
  // stale-closure workaround `let latestConfig; setConfig(prev => { latestConfig = prev; return prev; })`.
  const latestConfig = configRef.current;
  trace("ui", "dataLoaded", {
    periods: data.length,
    companyId: data[0]?.company_id ?? null,
    family: analysisFamilyFromScope(assessAnalysisScope(data, latestConfig)),
  });
  const quickScope = assessAnalysisScope(data, latestConfig);
  const quickFamily = analysisFamilyFromScope(quickScope);
  const requestedDeepLinkTab = requestedDeepLinkTabRef.current;
  requestedDeepLinkTabRef.current = null;
  setActiveTab(resolvePostIngestionDeepLinkTab({
    requestedTab: requestedDeepLinkTab,
    family: quickFamily,
    scope: quickScope,
    hasStandaloneData: Boolean(nextStandaloneData?.length),
  }));
    },
    [auditGovernance.contentClass, auditGovernance.retentionDays, config, configRef, setConfig]
  );

  const handleBatchSubmit = useCallback((incomingRegistry: CompanyRegistry) => {
    trace("ui", "AppShell:batchRegistryReceived", { count: Object.keys(incomingRegistry.companies).length });
    setRegistry((prev) => mergeCompanyRegistries(prev, incomingRegistry));
    setActiveTab("watchlist");
  }, []);

  // Audit persistence (extracted to useAuditPersistence hook)
  useAuditPersistence({
    auditMeta,
    rawData,
    recastData,
    config,
    debugInfo,
    parserDiagnostics,
    qualityGate: qualityGateWithRecast,
    mappingAudit,
    engineError,
    analysisStatus,
    activeTab,
  });

  // Per-user residuals KV sync (Plan 4 PR-4.5). The engine appends the
  // residual summary to localStorage inside the analysis derivation; this
  // hook mirrors that history to KV (push on run completion) and pulls it
  // back on company change when local is empty. Fail-open: a no-creds build
  // stays local-only. runStamp = the envelope's generatedAt, which changes
  // once per completed run.
  useResidualsSync({
    companyId: auditMeta?.companyId ?? rawData?.[0]?.company_id ?? null,
    runStamp: traceability?.generatedAt ?? null,
  });

  // ── Tab visibility (extracted hook) ────────────────────────────────
  const {
    visibleTabs, hasRecast, valuationBlocked,
    scopeBlocked, financialFallbackAvailable, readyCompanyCount,
    workspaceCompanies,
  } = useTabVisibility({
    rawData, recastData, debugInfo, qualityGate, bankResult,
    scopeAwareResult, auditMeta, registry, activeTab, setActiveTab,
  });

  // Pass the full config — ForecastReport (and any engine calls it triggers) may
  // access fields like tax_rate_mode, oci_treated_as_unusual, etc. Passing a
  // partial object caused silent undefined accesses for those fields.
  const forecastConfig = config;

  // ── Workspace sync (extracted hook with 800ms debounce) ────────────
  useWorkspaceSync({
    rawData,
    recastData,
    config,
    analysisStatus,
    auditMeta,
  });

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <AppHeader
          visibleTabs={visibleTabs}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          valuationBlocked={valuationBlocked}
          financialFallbackAvailable={financialFallbackAvailable}
          scopeBlocked={scopeBlocked}
          auditMeta={auditMeta}
          rawData={rawData}
          analysisStatus={analysisStatus}
          registry={registry}
          activeCompanyId={config.ticker ?? null}
          onSwitchCompany={(companyId) => {
            setWorkspaceCompanyId(companyId);
            setActiveTab("workspace");
          }}
          serverMode={serverStatus.mode}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          setPaletteOpen={setPaletteOpen}
          setShortcutsOpen={setShortcutsOpen}
          setGlossaryOpen={setGlossaryOpen}
        />

        {/* Company context strip — always visible when data is loaded */}
        {rawData && rawData.length > 0 && (
          <CompanyContextStrip
            config={config}
            recastData={recastData}
            auditMeta={auditMeta}
            qualityGate={qualityGate}
          />
        )}

        <div className="flex">
          <SidebarNav
            visibleTabs={visibleTabs}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            valuationBlocked={valuationBlocked}
            financialFallbackAvailable={financialFallbackAvailable}
            scopeBlocked={scopeBlocked}
          />
          <main className="flex-1 max-w-[1400px] mx-auto px-4 sm:px-6 py-8 min-w-0">
            {rawData?.length && ["queued", "running", "cancellation-requested"].includes(analysisRunState) ? (
              <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                Building immutable analysis run{analysisRun ? ` ${analysisRun.runId}` : ""}…
              </div>
            ) : null}
            {qualityGate && (
              <div className="mb-5">
                <AnalysisStatusBadge status={analysisStatus} />
              </div>
            )}
            {platformGovernance.advancedModelResolutionRequired && (platformGovernance.advancedModelsLoading || platformGovernance.error) && (
              <section
                role={platformGovernance.error ? "alert" : "status"}
                className={`mb-5 rounded-xl border px-4 py-3 text-sm ${platformGovernance.error
                  ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
                  : "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200"}`}
              >
                {platformGovernance.error
                  ? `Advanced-model governance could not be verified. Analysis is paused: ${platformGovernance.error}`
                  : "Resolving authenticated advanced-model promotion and composition evidence…"}
              </section>
            )}
            <AnalysisRunStatusBar run={analysisRun} executionState={analysisRunState} />
            <AnalysisBanners
              setConfig={setConfig}
              config={config}
              rawData={rawData}
              sharedRegistryStatus={sharedRegistryStatus}
              engineError={engineError}
              hasUnacknowledgedBreaks={hasUnacknowledgedBreaks}
              structuralBreakPeriods={structuralBreakPeriods}
              valuationDataSelection={valuationDataSelection}
              qualityGate={qualityGate}
              itServicesSignal={itServicesSignal}
              cyclicalitySignal={cyclicalitySignal}
            />
            <TabRouter
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              config={config}
              setConfig={setConfig}
              forecastConfig={forecastConfig}
              rawData={rawData}
              recastData={recastData}
              hasRecast={hasRecast}
              handleDataSubmit={handleDataSubmit}
              onBatchSubmit={handleBatchSubmit}
              auditMeta={auditMeta}
              analysisStatus={analysisStatus}
              traceability={traceability}
              publication={publication}
              ratioSanity={ratioSanity}
              segmentData={segmentData}
              liveMarketData={liveMarketData}
              liveMarketDataLoading={liveMarketDataLoading}
              liveMarketDataError={liveMarketDataError}
              refreshLiveMarketData={refreshLiveMarketData}
              commandCenter={commandCenter}
              analysisWindow={analysisWindow}
              sourcedAssumptionSet={sourcedAssumptionSet}
              forecastResults={forecastResults}
              scenarioOrdering={scenarioOrdering}
              scenarioGovernance={scenarioGovernance}
              readyCompanyCount={readyCompanyCount}
              bankResult={bankResult}
              nbfcSidecar={nbfcSidecar}
              lossMakerResult={lossMakerResult}
              registry={registry}
              comparisonPublication={comparisonPublication}
              portfolioRunComparison={portfolioRunComparison}
              workspaceCompanies={workspaceCompanies}
              workspaceCompanyId={workspaceCompanyId}
              setWorkspaceCompanyId={setWorkspaceCompanyId}
              valuationBlocked={valuationBlocked}
              scopeBlocked={scopeBlocked}
              qualityGate={qualityGate}
              scopeAwareResult={scopeAwareResult}
              pipelineResult={pipelineResult}
              debugInfo={debugInfo}
              engineError={engineError}
            />
          </main>
        </div>
      </div>
      <GlossaryModal open={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        registry={registry}
        setActiveTab={(tab) => setActiveTab(tab as TabId)}
        setGlossaryOpen={setGlossaryOpen}
        setShortcutsOpen={setShortcutsOpen}
        setDarkMode={setDarkMode}
        onSwitchCompany={(companyId) => {
          setWorkspaceCompanyId(companyId);
          setActiveTab("workspace");
        }}
      />
    </ErrorBoundary>
  );
}
