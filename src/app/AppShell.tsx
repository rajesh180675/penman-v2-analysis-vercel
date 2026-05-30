import { useState, useCallback, useEffect } from "react";
import { useServerStatus } from "../hooks/useServerStatus";
import { useBankSidecars } from "../hooks/useBankSidecars";
import { useAuditPersistence } from "../hooks/useAuditPersistence";
import { useLiveMarketData } from "../hooks/useLiveMarketData";
import { RawPeriodData, DEFAULT_CONFIG, EngineConfig, CompanyRegistry } from "../engine/types";
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
import { useUrlSync } from "../hooks/useUrlSync";
import {
  AuditSubmissionMeta,
  createAuditAccessToken,
  createAuditRunId,
  getAuditClientGovernance,
  isAuditEnabled,
  rememberAuditRun,
} from "../lib/audit";
import { listWorkspaceCompanies, rememberWorkspaceAnalysis } from "../lib/researchWorkspace";
import { syncWorkspaceAnalysis, syncWorkspaceProfile } from "../lib/sharedResearchApi";
import { readPersistedCompanyRegistry } from "../lib/companyRegistryStore";
import { resolveNseSymbol, resolveFolderFromSymbol } from "../engine/nseSymbolRegistry";
import { SourceParserDiagnostics } from "../engine/parserDiagnostics";
import type { TabId } from "./tabs";
import { TABS } from "./tabs";
import { useAuditAnalysis } from "./useAuditAnalysis";
import { AppHeader } from "./components/AppHeader";
import { CompanyContextStrip } from "./components/CompanyContextStrip";
import { AnalysisBanners } from "./components/AnalysisBanners";
import { TabRouter } from "./components/TabRouter";

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
  const [segmentData, setSegmentData] = useState<import("../engine/segmentParser").AllSegmentData | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("upload");
  const [config, setConfig] = useState<EngineConfig>(DEFAULT_CONFIG);
  const [darkMode, setDarkMode] = useState(false);
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

  // Live market data — fetched at App level so Dashboard + Valuation both have it
  const { snapshot: liveMarketData } = useLiveMarketData({
    provider: config.market_data_provider as any ?? "nse",
    symbol: config.market_data_symbol ?? config.ticker ?? null,
    fallbackPrice: config.market_price ?? null,
    fallbackRiskFreeRate: config.risk_free_rate ?? null,
  });

  // Phase B5 — Bank/NBFC quality sidecars (extracted to useBankSidecars hook).
  const { bankQuality, nbfcSidecar } = useBankSidecars(config, rawData);

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
  } = useAuditAnalysis({
    rawData,
    standaloneRawData,
    config,
    bankQuality,
    debugInfo,
    parserDiagnostics,
    auditMeta,
    registry,
  });

  // Log dual-scope availability so QA can verify the second ZIP loaded.
  useEffect(() => {
    if (scopeAwareResult) {
      console.log("[App] dual-scope analysis available:", {
        alignedPeriods: scopeAwareResult.summary.alignedPeriods,
        medianPatContributionPct: scopeAwareResult.summary.medianPatContributionPct,
        patContributionTrend: scopeAwareResult.summary.patContributionTrend,
      });
    }
  }, [scopeAwareResult]);

  // True when breaks are detected and the user hasn't yet excluded any periods.
  const hasUnacknowledgedBreaks = structuralBreakPeriods.length > 0 &&
    (!config.excluded_periods || config.excluded_periods.length === 0);

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
  }, [rawData, recastData, traceability]);

  // Fix 6: Auto-fill shares_outstanding from the latest period's shareCountInput
  // when the user hasn't manually entered a value. Uses diluted shares when
  // available, falls back to end-period shares, then capital-derived shares.
  // Only fires when recastData arrives and config.shares_outstanding is unset.
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
        return { ...prev, shares_outstanding: CroreShares(autoShares) };
      });
    }
  }, [recastData, config.shares_outstanding]);

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
    // Resolve NSE symbol and quality-data folder if not already set.
    // This ensures manual uploads (which skip the library grid) also get
    // proper symbol/folder wiring so the sidecar fetch and live price work.
    const resolvedSymbol = prev.market_data_symbol ?? resolveNseSymbol(companyId) ?? null;
    const resolvedFolder = prev.quality_data_folder ?? resolveFolderFromSymbol(companyId) ?? companyId;
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
  // M1 fix: detect financial-institution scope synchronously here to avoid
  // the "No data loaded" flash that occurs when statements tab renders before
  // the bank-redirect useEffect fires on the next render cycle.
  // M2 fix: use the LATEST config (post-setConfig above) for scope assessment.
  // The `config` closure variable is stale when called from the library grid
  // (onConfigChange fires before onDataSubmit but React hasn't re-rendered).
  // Reading from the updater's return value isn't possible, so we reconstruct
  // the relevant field: company_type is already set by onConfigChange in
  // DataEntry before this callback fires.
  let latestConfig = config;
  setConfig((prev) => { latestConfig = prev; return prev; });
  trace("ui", "dataLoaded", {
    periods: data.length,
    companyId: data[0]?.company_id ?? null,
    family: analysisFamilyFromScope(assessAnalysisScope(data, latestConfig)),
  });
  const quickScope = assessAnalysisScope(data, latestConfig);
  const quickFamily = analysisFamilyFromScope(quickScope);
  if (quickFamily === "financial-institution" && !quickScope.blocked) {
    setActiveTab("bank");
  } else if (quickScope.blocked) {
    setActiveTab("debug");
  } else {
    setActiveTab("statements");
  }
    },
    [auditGovernance.contentClass, auditGovernance.retentionDays, config]
  );

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

  const hasRecast = (recastData?.length ?? 0) > 0;
  const hasDebug = debugInfo !== null;
  const workspaceCompanies = listWorkspaceCompanies();
  const hasWorkspace = hasRecast || Boolean(rawData?.length) || workspaceCompanies.length > 0;
  const valuationBlocked = Boolean(qualityGate?.valuationBlocked);
  const scopeBlocked = Boolean(qualityGate?.scopeAssessment.blocked);
  const financialFallbackAvailable = Boolean(scopeBlocked && rawData && rawData.length > 0 && !hasRecast);
  const valuationTabEnabled = hasRecast || financialFallbackAvailable;

// Financial-institution auto-redirect: when the pipeline produced a
// bankResult or identified an unsupported scope (insurance), steer
// the user away from the blank "statements" tab.
useEffect(() => {
if (!hasRecast && rawData && rawData.length > 0) {
 if (bankResult && activeTab === "statements") {
  setActiveTab("bank");
 } else if (scopeBlocked && !bankResult && activeTab === "statements") {
  // Insurance / unsupported financial — redirect to debug with context
  setActiveTab("debug");
 }
}
}, [bankResult, hasRecast, activeTab, scopeBlocked, rawData]);

  const readyCompanyCount = Object.values(registry.companies).filter((c) => c.recastData.length > 0).length;

  const visibleTabs = TABS.filter(t => {
    if (t.id === "debug") return hasDebug;
    if (t.id === "comparison") return readyCompanyCount >= 2;
    if (t.id === "inspector") return isAuditEnabled() && Boolean(auditMeta);
    if (t.id === "watchlist") return hasWorkspace;
    if (t.id === "workspace") return hasWorkspace;
    if (t.id === "valuation") return valuationTabEnabled;
    // Bank/NBFC tab: show when bankResult exists, even without industrial recast
    if (t.id === "bank") return hasRecast || bankResult !== null;
    // Dashboard: show for banks/NBFCs too (bankResult carries the analysis)
    if (t.id === "dashboard") return hasRecast || bankResult !== null;
    // Ratios + Quality: show for banks — FinancialInstitutionReport renders NIM/ROA/ROE trends
    if (t.id === "ratios") return hasRecast || bankResult !== null;
    if (t.id === "quality") return hasRecast || bankResult !== null;
    // Scope tab — visible only when both consolidated AND standalone are loaded
    // and the gap analysis succeeded. Phase A.
    if (t.id === "scope") return scopeAwareResult !== null;
    // Report tab: show for banks too — FinancialInstitutionReport renders from bankResult
    if (t.id === "report") return hasRecast || bankResult !== null;
    if (t.needsData) return hasRecast;
    return true;
  });

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

        <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
          {qualityGate && (
            <div className="mb-5">
              <AnalysisStatusBadge status={analysisStatus} />
            </div>
          )}
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
            auditMeta={auditMeta}
            analysisStatus={analysisStatus}
            traceability={traceability}
            publication={publication}
            ratioSanity={ratioSanity}
            segmentData={segmentData}
            liveMarketData={liveMarketData}
            readyCompanyCount={readyCompanyCount}
            bankResult={bankResult}
            nbfcSidecar={nbfcSidecar}
            lossMakerResult={lossMakerResult}
            registry={registry}
            comparisonPublication={comparisonPublication}
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
