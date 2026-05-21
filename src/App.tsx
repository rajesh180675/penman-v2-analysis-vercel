import { Suspense, lazy, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useServerStatus } from "./hooks/useServerStatus";
import { RawPeriodData, RecastPeriod, DEFAULT_CONFIG, EngineConfig, CompanyRegistry } from "./engine/types";
import { processCompanyDataFull } from "./engine/pipeline";
import { processScopeAwareData, type ScopeAwareResult } from "./engine/scopeAwareLoader";
import { assessAnalysisScope, analysisFamilyFromScope } from "./engine/scopePolicy";
import type { FinancialInstitutionAnalysisResult } from "./engine/analysisFamily";
import { fetchBankQualityIndicators, type BankQualityIndicators } from "./engine/bankQualityIndicators";
import { fetchNbfcSidecarData, type NbfcSidecarData } from "./engine/nbfcSidecarLoader";
import { trace } from "./lib/traceLogger";
import { deriveAnalysisStatus } from "./engine/analysisStatus";
import { CapitalineParseDebug } from "./engine/capitalineParser";
import { auditMappingCoverage, evaluateQualityGate } from "./engine/mappingAudit";
import { resolveValuationReadiness } from "./engine/valuationPolicy";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AnalysisStatusBadge } from "./components/AnalysisStatusBadge";
import CompanySwitcher from "./components/CompanySwitcher";
import GlossaryModal from "./components/GlossaryModal";
import KeyboardShortcutsModal from "./components/KeyboardShortcutsModal";
import CommandPalette from "./components/CommandPalette";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import DataEntry from "./components/DataEntry";
import RecastStatements from "./components/RecastStatements";
import RatioReport from "./components/RatioReport";
import QualityReport from "./components/QualityReport";
import SubsidiaryContributionPanel from "./components/dashboard/SubsidiaryContributionPanel";
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
import { fetchSharedComparisonRegistryWithStatus, formatSharedApiStatus, SharedApiResult, syncSharedComparisonRegistryWithStatus, syncWorkspaceAnalysis, syncWorkspaceProfile } from "./lib/sharedResearchApi";
import { persistCompanyRegistry, readPersistedCompanyRegistry } from "./lib/companyRegistryStore";
import { mergeCompanyRegistries } from "./lib/companyRegistrySnapshot";
import { buildAnalysisTraceability } from "./engine/analysisTraceability";
import { resolveNseSymbol, resolveFolderFromSymbol } from "./engine/nseSymbolRegistry";
import { buildAnalysisPublicationSnapshot } from "./lib/publication/analysisPublicationSnapshot";
import { buildComparisonPublicationSnapshot } from "./lib/publication/comparisonPublicationSnapshot";
import { getAnalysisPolicyVersions } from "./engine/policyVersions";
import { SourceParserDiagnostics } from "./engine/parserDiagnostics";

const ValuationReport = lazy(() => import("./components/ValuationReport"));
const FinancialInstitutionReport = lazy(() => import("./components/FinancialInstitutionReport"));
const ForecastReport = lazy(() => import("./components/ForecastReport"));
const AcademicReport = lazy(() => import("./components/AcademicReport"));
const RegressionReport = lazy(() => import("./components/RegressionReport"));
const ComparisonReport = lazy(() => import("./components/ComparisonReport"));
const DebugPanel = lazy(() => import("./components/DebugPanel"));
const V3AnalyticsPanel = lazy(() => import("./components/V3AnalyticsPanel"));
const RunInspector = lazy(() => import("./components/RunInspector"));
const CompanyWorkspace = lazy(() => import("./components/CompanyWorkspace"));
const WatchlistDashboard = lazy(() => import("./components/WatchlistDashboard"));
const DashboardView = lazy(() => import("./components/dashboard/DashboardView"));

type TabId = "upload" | "dashboard" | "watchlist" | "workspace" | "inspector" | "statements" | "ratios" | "forecast" | "valuation" | "bank" | "quality" | "scope" | "comparison" | "report" | "regression" | "v3analytics" | "debug";

const TABS: { id: TabId; label: string; icon: string; needsData?: boolean; group: string }[] = [
  { id: "upload", label: "Data", icon: "📂", group: "input" },
  { id: "dashboard", label: "Dashboard", icon: "📊", needsData: true, group: "input" },
  { id: "watchlist", label: "Watchlist", icon: "🗂", group: "input" },
  { id: "workspace", label: "Workspace", icon: "🧭", group: "input" },
  { id: "inspector", label: "Runs", icon: "🛰️", group: "input" },
  { id: "statements", label: "Statements", icon: "📋", needsData: true, group: "analysis" },
  { id: "ratios", label: "Ratios", icon: "📐", needsData: true, group: "analysis" },
  { id: "quality", label: "Quality", icon: "🔍", needsData: true, group: "analysis" },
  { id: "scope", label: "Scope", icon: "🪞", needsData: true, group: "analysis" },
  { id: "forecast", label: "Forecast", icon: "📈", needsData: true, group: "analysis" },
  { id: "valuation", label: "Valuation", icon: "💰", needsData: true, group: "valuation" },
  { id: "bank", label: "Bank", icon: "🏦", needsData: true, group: "valuation" },
  { id: "comparison", label: "Comparison", icon: "👥", needsData: true, group: "peers" },
  { id: "report", label: "Report", icon: "📚", needsData: true, group: "export" },
  { id: "regression", label: "Regression", icon: "🧪", needsData: true, group: "advanced" },
  { id: "v3analytics", label: "V3 Analytics", icon: "🔬", needsData: true, group: "advanced" },
  { id: "debug", label: "Debug", icon: "🛠", group: "advanced" },
];

const TAB_GROUPS: { key: string; label: string }[] = [
  { key: "input", label: "Data & Input" },
  { key: "analysis", label: "Analysis" },
  { key: "valuation", label: "Valuation" },
  { key: "peers", label: "Peers" },
  { key: "export", label: "Export" },
  { key: "advanced", label: "Advanced" },
];

export function App() {
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
  const [segmentData, setSegmentData] = useState<import("./engine/segmentParser").SegmentData | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("upload");
  const [config, setConfig] = useState<EngineConfig>(DEFAULT_CONFIG);
  const [darkMode, setDarkMode] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Vim-style keyboard shortcuts (g+letter for tabs, ? for help, Shift+? for glossary)
  useKeyboardShortcuts({
    setActiveTab: (tab) => { trace("ui", "tabSwitch", { tab }); setActiveTab(tab as TabId); },
    setGlossaryOpen,
    setShortcutsOpen,
    enabled: !glossaryOpen && !shortcutsOpen && !paletteOpen,
  });

  // Cmd+K / Ctrl+K opens the command palette (works even when typing)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const [registry, setRegistry] = useState<CompanyRegistry>(() => readPersistedCompanyRegistry());
  const [comparisonRegistryHydrated, setComparisonRegistryHydrated] = useState(false);
  const [auditMeta, setAuditMeta] = useState<AuditSubmissionMeta | null>(null);
  const [workspaceCompanyId, setWorkspaceCompanyId] = useState<string | null>(null);
  const [sharedRegistryStatus, setSharedRegistryStatus] = useState<SharedApiResult<CompanyRegistry> | null>(null);
  const lastAuditSignatureRef = useRef<string | null>(null);
  const lastAuditStatusRef = useRef<string | null>(null);
  const lastTabAuditRef = useRef<string | null>(null);

  const qualityGate = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;
    return evaluateQualityGate(rawData, config);
  }, [config, rawData]);

  const scopeGate = qualityGate;

  const mappingAudit = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;
    return auditMappingCoverage(rawData);
  }, [rawData]);

  // Phase B5 — Bank asset-quality sidecar. Fetched asynchronously when
  // (a) the dataset is bank/NBFC and (b) a folder name is resolvable.
  // The fetch is graceful: 404 / network errors yield null, the engine
  // still runs without quality data. Schema/parse errors throw loud.
  const [bankQuality, setBankQuality] = useState<BankQualityIndicators | null>(null);
  const [nbfcSidecar, setNbfcSidecar] = useState<NbfcSidecarData | null>(null);
  const qualityFolder = useMemo(() => {
    // Explicit override wins. Otherwise use the parser-supplied company_id
    // when present — it usually matches the folder under public/data/companies/.
    return config.quality_data_folder ?? rawData?.[0]?.company_id ?? null;
  }, [config.quality_data_folder, rawData]);

  useEffect(() => {
    let cancelled = false;
    if (!qualityFolder) {
      setBankQuality(null);
      return;
    }
    void fetchBankQualityIndicators(qualityFolder, undefined, config.quality_indicators_blob_url)
      .then((q) => {
        if (!cancelled) {
          setBankQuality(q);
          trace("quality", "sidecarLoaded", {
            folder: qualityFolder,
            periods: q?.periods?.length ?? 0,
            hasData: q != null,
          });
        }
      })
      .catch((err) => {
        // Schema-level failures are loud; surface to console but keep the
        // bank pipeline running with null quality so the rest of the
        // analysis is unaffected.
        console.error("[App] bank quality sidecar load failed:", err);
        if (!cancelled) setBankQuality(null);
      });
    return () => {
      cancelled = true;
    };
  }, [qualityFolder, config.quality_indicators_blob_url]);

  // Phase D4 — Fetch NBFC sidecar data (LGD + RBI NHB) when company folder is known
  useEffect(() => {
    let cancelled = false;
    if (!qualityFolder) {
      setNbfcSidecar(null);
      return;
    }
    void fetchNbfcSidecarData(qualityFolder, config.quality_indicators_blob_url ?? null)
      .then((data) => {
        if (!cancelled) {
          trace("sidecar", "nbfcSidecarFetched", {
            folder: qualityFolder,
            lgdPeriods: data.lgd.length,
            rbiNhbPeriods: data.rbiNhb.length,
          });
          if (data.lgd.length > 0 || data.rbiNhb.length > 0) {
            setNbfcSidecar(data);
          } else {
            trace("sidecar", "nbfcSidecarEmpty", { folder: qualityFolder }, null, { level: "warn", msg: "LGD+RBI NHB fetch returned 0 records — files may be missing or validation failed" });
            setNbfcSidecar(null);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          trace("sidecar", "nbfcSidecarError", { folder: qualityFolder, error: String(err) }, null, { level: "error" });
          setNbfcSidecar(null);
        }
      });
    return () => { cancelled = true; };
  }, [qualityFolder, config.quality_indicators_blob_url]);

  // Single engine pass — produces both the industrial recast (RecastPeriod[])
  // and the bank pipeline result. Consolidates two earlier separate calls
  // into one for efficiency.
  // Phase B5: quality sidecar (when present) flows through to the bank
  // pipeline. The memo re-runs when quality arrives, so the asset-quality
  // signals populate as soon as the fetch resolves.
  const pipelineResult = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;
    if (scopeGate?.scopeAssessment.blocked) return null;
    try {
      return processCompanyDataFull(rawData, config, bankQuality);
    } catch (err) {
      console.error("[App] engine error:", err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [config, rawData, scopeGate, bankQuality]);

  // Phase A — Scope-aware analysis. When standalone data is also loaded,
  // compute the consolidated − standalone gap (subsidiary contribution).
  // null when standalone is null (single-scope upload). Does NOT replace
  // the main pipeline; consolidated still drives valuation. This is the
  // gap-analysis layer used by the Subsidiary Contribution panel (Phase B).
  const scopeAwareResult = useMemo<ScopeAwareResult | null>(() => {
    if (!rawData || rawData.length === 0) return null;
    if (!standaloneRawData || standaloneRawData.length === 0) return null;
    if (scopeGate?.scopeAssessment.blocked) return null;
    try {
      return processScopeAwareData(rawData, standaloneRawData, config, bankQuality);
    } catch (err) {
      console.error("[App] scope-aware analysis error:", err);
      return null;
    }
  }, [rawData, standaloneRawData, config, scopeGate, bankQuality]);

  // Log dual-scope availability so QA can verify the second ZIP loaded.
  // Phase B will consume scopeAwareResult in a dedicated UI panel; until then
  // this useEffect is the only consumer (and prevents a TS6133 unused warning).
  useEffect(() => {
    if (scopeAwareResult) {
      console.log("[App] dual-scope analysis available:", {
        alignedPeriods: scopeAwareResult.summary.alignedPeriods,
        medianPatContributionPct: scopeAwareResult.summary.medianPatContributionPct,
        patContributionTrend: scopeAwareResult.summary.patContributionTrend,
      });
    }
  }, [scopeAwareResult]);

  // Bank/NBFC pipeline result. Carries Phase B4 valuation bundle.
  const bankResult = useMemo<FinancialInstitutionAnalysisResult | null>(() => {
    if (!pipelineResult || "error" in pipelineResult) return null;
    if (pipelineResult.analysisFamily !== "financial-institution") return null;
    return pipelineResult.bankResult ?? null;
  }, [pipelineResult]);

  // Phase I9 — structural break periods from S-5.1 STRUCTURAL_EVENT flags.
  // Surfaced so the UI can offer the "exclude pre-break periods" confirmation.
  const structuralBreakPeriods = useMemo<string[]>(() => {
    if (!pipelineResult || "error" in pipelineResult) return [];
    return pipelineResult.structuralBreakPeriods ?? [];
  }, [pipelineResult]);

  // Phase I3 — loss-maker valuation anchors (revenue multiple, reverse-DCF,
  // path-to-profitability). Populated when ≥50% of periods have CNI ≤ 0.
  const lossMakerResult = useMemo(() => {
    if (!pipelineResult || "error" in pipelineResult) return null;
    return pipelineResult.lossMaker ?? null;
  }, [pipelineResult]);

  // Phase E1 — IT-services fingerprint. Advisory only — industrial pipeline
  // still runs, but UI surfaces a caveat when isITServices=true.
  const itServicesSignal = useMemo(() => {
    if (!pipelineResult || "error" in pipelineResult) return null;
    return pipelineResult.itServices ?? null;
  }, [pipelineResult]);

  // Phase F — Cyclicality assessment. Advisory banner when peak/trough detected.
  const cyclicalitySignal = useMemo(() => {
    if (!pipelineResult || "error" in pipelineResult) return null;
    return pipelineResult.cyclicality ?? null;
  }, [pipelineResult]);

  // Phase 9 — anchor ratio bands. Surfaces economically implausible outputs.
  const ratioSanity = useMemo(() => {
    if (!pipelineResult || "error" in pipelineResult) return null;
    return pipelineResult.ratioSanity ?? null;
  }, [pipelineResult]);

  // True when breaks are detected and the user hasn't yet excluded any periods.
  const hasUnacknowledgedBreaks = structuralBreakPeriods.length > 0 &&
    (!config.excluded_periods || config.excluded_periods.length === 0);

  // Derive recastData reactively. Any config change (tax rate, OCI treatment,
  // hybrid-debt flag, etc.) immediately re-computes via pipelineResult above.
  const recastOutcome = useMemo<{ data: RecastPeriod[] | null; error: string | null }>(() => {
    if (!rawData || rawData.length === 0) return { data: null, error: null };
    if (scopeGate?.scopeAssessment.blocked) {
      return {
        data: null,
        error: scopeGate.scopeAssessment.reasons[0] ?? "Unsupported dataset scope for the industrial Penman-Nissim engine.",
      };
    }
    if (!pipelineResult) return { data: null, error: null };
    if ("error" in pipelineResult) return { data: null, error: pipelineResult.error };
    return {
      data: pipelineResult.periods.length > 0 ? pipelineResult.periods : null,
      error: null,
    };
  }, [pipelineResult, rawData, scopeGate]);

  const recastData = recastOutcome.data;
  const engineError = recastOutcome.error;
  const qualityGateWithRecast = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;
    return evaluateQualityGate(rawData, config, recastData);
  }, [config, rawData, recastData]);
  const valuationReadiness = useMemo(() => (recastData?.length ? resolveValuationReadiness(recastData) : null), [recastData]);
  const analysisStatus = useMemo(
    () => deriveAnalysisStatus(qualityGateWithRecast, valuationReadiness, mappingAudit),
    [mappingAudit, qualityGateWithRecast, valuationReadiness],
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
      qualityGate: qualityGateWithRecast,
      mappingAudit,
      policyVersions,
      analysisStatus,
      hasDebugInfo: Boolean(debugInfo),
      debugFiles: debugInfo?.files?.length ?? 0,
      rawMetricKeyCount: debugInfo?.rawMetricKeys?.length ?? 0,
      engineError,
      debugInfo,
      parserDiagnostics,
      contentClass: auditMeta?.contentClass ?? null,
      retentionDays: auditMeta?.retentionDays ?? null,
      runInspectorEnabled: Boolean(auditMeta?.runAccessToken),
    }),
    [analysisStatus, auditMeta, config, debugInfo, engineError, latestPeriod, mappingAudit, parserDiagnostics, policyVersions, qualityGateWithRecast, rawData, recastData],
  );
  const publication = useMemo(
    () => (recastData?.length
      ? buildAnalysisPublicationSnapshot({
        data: recastData,
        config,
        rawData,
        auditMeta,
        sharedTraceability: traceability,
        qualityGate: qualityGateWithRecast,
        mappingAudit,
        policyVersions,
        analysisStatus,
        family: qualityGateWithRecast?.scopeAssessment.analysisFamily ?? null,
      })
      : null),
    [analysisStatus, auditMeta, config, mappingAudit, policyVersions, qualityGateWithRecast, rawData, recastData, traceability],
  );
  const comparisonPublication = useMemo(
    () => buildComparisonPublicationSnapshot(registry),
    [registry],
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
    let cancelled = false;

    const hydrateSharedComparisonRegistry = async () => {
      const result = await fetchSharedComparisonRegistryWithStatus();
      if (cancelled) return;
      setSharedRegistryStatus(result as SharedApiResult<CompanyRegistry>);
      if (result.data) {
        setRegistry((prev) => mergeCompanyRegistries(prev, result.data as CompanyRegistry));
      }
      setComparisonRegistryHydrated(true);
    };

    void hydrateSharedComparisonRegistry();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    persistCompanyRegistry(registry);
  }, [registry]);

  useEffect(() => {
    if (!comparisonRegistryHydrated || Object.keys(registry.companies).length === 0) return;
    const timer = window.setTimeout(() => {
      void syncSharedComparisonRegistryWithStatus(registry).then((result) => setSharedRegistryStatus(result as SharedApiResult<CompanyRegistry>));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [comparisonRegistryHydrated, registry]);

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

  // Fix 6: Auto-fill shares_outstanding from the latest period's shareCountInput
  // when the user hasn't manually entered a value. Uses diluted shares when
  // available, falls back to end-period shares, then capital-derived shares.
  // Only fires when recastData arrives and config.shares_outstanding is unset.
  useEffect(() => {
    if (!recastData || recastData.length === 0) return;
    if (config.shares_outstanding != null) return; // user already set it
    const latest = recastData[recastData.length - 1];
    const snap = latest.shareCountInput;
    if (!snap) return;
    const autoShares =
      snap.weightedAverageDilutedShares ??
      snap.weightedAverageBasicShares ??
      snap.endPeriodShares ??
      null;
    if (autoShares != null && autoShares > 0) {
      setConfig((prev) => {
        // Double-check: don't overwrite if user set it between renders
        if (prev.shares_outstanding != null) return prev;
        return { ...prev, shares_outstanding: autoShares };
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
      debug?: CapitalineParseDebug,
      meta?: AuditSubmissionMeta,
      nextParserDiagnostics?: SourceParserDiagnostics | null,
      nextSegmentData?: import("./engine/segmentParser").SegmentData | null,
      // Phase A — optional standalone dataset for dual-scope analysis.
      // Library cards with hasStandalone=true pass this in; manual uploads pass null.
      nextStandaloneData?: RawPeriodData[] | null,
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
      lastAuditSignatureRef.current = null;
      lastAuditStatusRef.current = null;
      lastTabAuditRef.current = null;
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
      [id]: { id, label: id, rawData: data, recastData: [], traceability: null },
    },
  }));
  // Note: Bank/NBFC datasets will auto-redirect to "bank" tab via the
  // useEffect below (which detects bankResult && !hasRecast).
  // Industrial datasets land on "statements" which is the primary analysis view.
  // M1 fix: detect financial-institution scope synchronously here to avoid
  // the "No data loaded" flash that occurs when statements tab renders before
  // the bank-redirect useEffect fires on the next render cycle.
  trace("ui", "dataLoaded", {
    periods: data.length,
    companyId: data[0]?.company_id ?? null,
    family: analysisFamilyFromScope(assessAnalysisScope(data, config)),
  });
  const quickScope = assessAnalysisScope(data, config);
  const quickFamily = analysisFamilyFromScope(quickScope);
  if (quickFamily === "financial-institution" && !quickScope.blocked) {
    setActiveTab("bank");
  } else if (quickScope.blocked) {
    setActiveTab("debug");
  } else {
    setActiveTab("statements");
  }
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
      parserDiagnostics,
      qualityGate: qualityGateWithRecast,
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
  }, [analysisStatus, auditMeta, config, debugInfo, engineError, mappingAudit, parserDiagnostics, qualityGate, rawData, recastData]);

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
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 shadow-sm">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-0 flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">PN</div>
              <div>
                <span className="font-bold text-slate-800 text-sm">Penman–Nissim V3</span>
                <span className="hidden sm:inline text-xs text-slate-400 ml-2">Residual-Income Valuation · Capitaline Ind AS</span>
              </div>
            </div>
            <nav className="flex h-full overflow-x-auto gap-0.5">
              {TAB_GROUPS.map(group => {
                const groupTabs = visibleTabs.filter(t => t.group === group.key);
                if (groupTabs.length === 0) return null;
                return (
                  <div key={group.key} className="flex items-center">
                    <span className="text-[9px] uppercase tracking-wider text-slate-400 px-1.5 hidden lg:inline">{group.label}</span>
                    {groupTabs.map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => {
                          if (tab.id === "valuation" && valuationBlocked && !financialFallbackAvailable) return;
                          setActiveTab(tab.id);
                        }}
                        title={
                          tab.id === "valuation" && valuationBlocked && !financialFallbackAvailable
                            ? scopeBlocked
                              ? "Unsupported financial-company scope. See Debug tab."
                              : "Valuation blocked by quality gate. See Debug tab."
                            : undefined
                        }
                        disabled={tab.id === "valuation" && valuationBlocked && !financialFallbackAvailable}
                        className={`px-2.5 h-full text-xs font-medium border-b-2 transition-colors flex items-center gap-1 whitespace-nowrap ${activeTab === tab.id
                          ? "border-indigo-600 text-indigo-600"
                          : tab.id === "valuation" && valuationBlocked
                            ? "border-transparent text-slate-300 cursor-not-allowed"
                            : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                          }`}>
                        <span>{tab.icon}</span>
                        <span className="hidden sm:inline">{tab.label}</span>
                      </button>
                    ))}
                    <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1 last:hidden" />
                  </div>
                );
              })}
            </nav>
            <div className="ml-3 flex items-center gap-2">
              {isAuditEnabled() && auditMeta && (
                <span className="hidden lg:inline-flex px-2 py-1 text-[11px] rounded border border-emerald-200 bg-emerald-50 text-emerald-700">
                  Audit run {auditMeta.runId.slice(0, 8)}
                </span>
              )}
              {rawData && <AnalysisStatusBadge status={analysisStatus} compact />}
              <CompanySwitcher
                registry={registry}
                activeCompanyId={config.ticker ?? null}
                onSwitchCompany={(companyId) => {
                  setWorkspaceCompanyId(companyId);
                  setActiveTab("workspace");
                }}
              />
              {serverStatus.mode === "offline" && (
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700" title="Local server not running. Live NSE prices and audit persistence unavailable. Use: npm run dev:local">
                  Offline
                </span>
              )}
              {serverStatus.mode === "local" && (
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700" title="Local server running — NSE prices + audit persistence active">
                  Local
                </span>
              )}
              <button
                onClick={() => setPaletteOpen(true)}
                className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1"
                title="Command palette (Ctrl/Cmd+K)"
              >
                ⌘ <span className="font-mono text-[10px] text-slate-500">K</span>
              </button>
              <button
                onClick={() => setShortcutsOpen(true)}
                className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700"
                title="Keyboard shortcuts (?)"
              >
                ⌨️
              </button>
              <button
                onClick={() => setGlossaryOpen(true)}
                className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700"
                title="Open glossary — definitions of RNOA, NOA, EPV, Piotroski, etc."
              >
                📖
              </button>
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
          {sharedRegistryStatus && !sharedRegistryStatus.ok && sharedRegistryStatus.status !== 404 && (
            <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <strong>Shared comparison sync:</strong> {formatSharedApiStatus(sharedRegistryStatus, "Shared comparison registry synced.")}
            </div>
          )}
          {engineError && (
            <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <strong>Engine Error:</strong> {engineError}
            </div>
          )}
          {/* Phase I9 — structural break / demerger confirmation banner */}
          {hasUnacknowledgedBreaks && (
            <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="font-semibold mb-1">Structural break detected — possible demerger or M&A event</div>
              <div className="mb-2">
                S-5.1 (dirty surplus spike) fired on{" "}
                <span className="font-mono">{structuralBreakPeriods.join(", ")}</span>.
                This typically indicates a demerger, scheme of arrangement, buyback, or Ind AS transition adjustment.
                Pre-break periods may distort growth rates, mean-reversion anchors, and terminal value.
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={() => {
                    // Find the earliest break period and exclude everything before it.
                    const sorted = [...structuralBreakPeriods].sort();
                    const firstBreak = sorted[0];
                    const toExclude = (rawData ?? [])
                      .map(p => p.period_end)
                      .filter(pe => pe < firstBreak);
                    setConfig(prev => ({ ...prev, excluded_periods: toExclude }));
                  }}
                  className="px-3 py-1.5 rounded bg-amber-700 text-white text-xs font-medium hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500"
                >
                  Exclude pre-break periods
                </button>
                <button
                  onClick={() => {
                    // Acknowledge by setting excluded_periods to empty array —
                    // suppresses the banner without actually excluding anything.
                    setConfig(prev => ({ ...prev, excluded_periods: [] }));
                  }}
                  className="px-3 py-1.5 rounded border border-amber-400 text-amber-800 text-xs font-medium hover:bg-amber-100 dark:border-amber-600 dark:text-amber-200 dark:hover:bg-amber-900/30"
                >
                  Keep all periods (I understand the risk)
                </button>
              </div>
            </div>
          )}
          {/* Phase I9 — show which periods are excluded when exclusions are active */}
          {(config.excluded_periods?.length ?? 0) > 0 && (() => {
            const totalPeriods = rawData?.length ?? 0;
            const remainingPeriods = totalPeriods - (config.excluded_periods?.length ?? 0);
            const lowHistory = remainingPeriods > 0 && remainingPeriods < 10;
            return (
              <div className={`mb-5 rounded-lg border p-3 text-xs flex flex-col gap-2 ${
                lowHistory
                  ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
                  : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400"
              }`}>
                <div className="flex items-center justify-between gap-4">
                  <span>
                    Period exclusions active:{" "}
                    <span className="font-mono">{config.excluded_periods!.join(", ")}</span>
                    {" "}excluded from the pipeline.
                  </span>
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, excluded_periods: [] }))}
                    className="shrink-0 px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Clear exclusions
                  </button>
                </div>
                {lowHistory && (
                  <div className="text-xs">
                    ⚠️ Only <strong>{remainingPeriods}</strong> period{remainingPeriods !== 1 ? "s" : ""} remain after exclusion.
                    Rigor is capped at <span className="font-mono">structurally-reconciled</span> — time-series signals
                    (growth rates, mean-reversion, terminal value anchoring) require at least 10 periods for reliability.
                  </div>
                )}
              </div>
            );
          })()}
          {qualityGate?.scopeAssessment?.screeningOnly && (
            <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="font-semibold mb-1">Screening mode — single period uploaded</div>
              <div>{qualityGate.scopeAssessment.screeningReason}</div>
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                What still works: current-period ratios, balance-sheet quality flags, point-in-time EPV/Graham-Dodd estimates, bank/NBFC metrics.
                What is disabled: growth rates, trend signals, mean-reversion anchors, V_RE_CV* residual-income valuation, rigor ladder above syntactically-valid.
                Upload at least 3 years of data to unlock the full analysis.
              </div>
            </div>
          )}
          {/* Phase E1 — IT-services caveat banner */}
          {itServicesSignal?.isITServices && (
            <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-200">
              <div className="font-semibold mb-1">💻 IT-services company detected</div>
              <div className="mb-1">{itServicesSignal.reason}</div>
              <div className="text-xs text-blue-700 dark:text-blue-300">
                The Penman-Nissim RNOA/ATO decomposition is less meaningful for human-capital businesses — NOA is structurally small (mostly receivables + cash), so RNOA looks inflated and ATO is not a useful efficiency signal.
                The moat score and terminal value anchors may overstate durability.
                Focus on: revenue growth, margin trend, FCFE yield, and employee cost ratio instead.
              </div>
            </div>
          )}
          {/* Phase F — Cyclicality peak/trough banner */}
          {(cyclicalitySignal?.classification === "cyclical-peak" || cyclicalitySignal?.classification === "cyclical-trough") && (
            <div className={`mb-5 rounded-lg border p-4 text-sm ${cyclicalitySignal.classification === "cyclical-peak"
              ? "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-200"
              : "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-200"
              }`}>
              <div className="font-semibold mb-1">
                {cyclicalitySignal.classification === "cyclical-peak" ? "🔺 Cyclical company at peak" : "🔻 Cyclical company at trough"}
              </div>
              <div className="mb-1">{cyclicalitySignal.reason}</div>
              <div className="text-xs opacity-80">
                {cyclicalitySignal.classification === "cyclical-peak"
                  ? `Latest ${cyclicalitySignal.metricUsed === "core-pm" ? "margin" : "RNOA"} (${cyclicalitySignal.latestValue != null ? (cyclicalitySignal.latestValue * 100).toFixed(1) + "%" : "—"}) is above the cycle median (${cyclicalitySignal.medianValue != null ? (cyclicalitySignal.medianValue * 100).toFixed(1) + "%" : "—"}). Valuation anchored on current earnings will overstate intrinsic value. Consider using the cycle-median as the terminal anchor.`
                  : `Latest ${cyclicalitySignal.metricUsed === "core-pm" ? "margin" : "RNOA"} (${cyclicalitySignal.latestValue != null ? (cyclicalitySignal.latestValue * 100).toFixed(1) + "%" : "—"}) is below the cycle median (${cyclicalitySignal.medianValue != null ? (cyclicalitySignal.medianValue * 100).toFixed(1) + "%" : "—"}). Valuation anchored on current earnings will understate intrinsic value. Consider using the cycle-median as the terminal anchor.`
                }
              </div>
            </div>
          )}
          <Suspense fallback={<TabSkeleton />}>
            {activeTab === "inspector" && <RunInspector auditMeta={auditMeta} analysisStatus={analysisStatus} />}
            {activeTab === "upload" && (
              <DataEntry onDataSubmit={handleDataSubmit} currentData={rawData} config={config} onConfigChange={setConfig} />
            )}
{activeTab === "dashboard" && hasRecast && (
<DashboardView
data={recastData!}
config={config}
traceability={traceability}
ratioSanity={ratioSanity}
segmentData={segmentData}
peerCount={readyCompanyCount}
onNavigate={(tab) => setActiveTab(tab as TabId)}
/>
)}
{/* Bank/NBFC dashboard: show FinancialInstitutionReport when no industrial recast */}
{activeTab === "dashboard" && !hasRecast && bankResult && (
<FinancialInstitutionReport
bankResult={bankResult}
config={config}
companyId={auditMeta?.companyId ?? rawData?.[0]?.company_id ?? null}
auditRunId={auditMeta?.runId ?? null}
marketCapCr={config.market_price != null && config.shares_outstanding != null
? (config.market_price * config.shares_outstanding) / 1e7
: null}
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
            {activeTab === "ratios" && hasRecast && <RatioReport data={recastData!} traceability={traceability} traceabilitySummary={publication?.traceabilitySummary ?? null} />}
            {activeTab === "ratios" && !hasRecast && bankResult && (
              <FinancialInstitutionReport
                bankResult={bankResult}
                config={config}
                companyId={auditMeta?.companyId ?? rawData?.[0]?.company_id ?? null}
                auditRunId={auditMeta?.runId ?? null}
                marketCapCr={config.market_price != null && config.shares_outstanding != null
                  ? (config.market_price * config.shares_outstanding) / 1e7
                  : null}
                nbfcSidecar={nbfcSidecar}
              />
            )}
            {activeTab === "forecast" && hasRecast && <ForecastReport data={recastData!} rawData={rawData} config={forecastConfig} traceability={traceability} traceabilitySummary={publication?.traceabilitySummary ?? null} />}
            {activeTab === "valuation" && hasRecast && !valuationBlocked && (
              <ValuationReport data={recastData!} config={config} analysisStatus={analysisStatus} auditMeta={auditMeta} traceability={traceability} publication={publication} lossMaker={lossMakerResult} ratioSanity={ratioSanity} segmentData={segmentData} />
            )}
            {activeTab === "valuation" && !hasRecast && bankResult && rawData && rawData.length > 0 && (
              <FinancialInstitutionReport
                bankResult={bankResult}
                config={config}
                companyId={auditMeta?.companyId ?? rawData?.[0]?.company_id ?? null}
                auditRunId={auditMeta?.runId ?? null}
                marketCapCr={config.market_price != null && config.shares_outstanding != null
                  ? (config.market_price * config.shares_outstanding) / 1e7
                  : null}
                nbfcSidecar={nbfcSidecar}
              />
            )}
            {activeTab === "bank" && bankResult && (
              <FinancialInstitutionReport
                bankResult={bankResult}
                config={config}
                companyId={auditMeta?.companyId ?? rawData?.[0]?.company_id ?? null}
                auditRunId={auditMeta?.runId ?? null}
                marketCapCr={config.market_price != null && config.shares_outstanding != null
                  ? (config.market_price * config.shares_outstanding) / 1e7
                  : null}
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
                companyId={auditMeta?.companyId ?? rawData?.[0]?.company_id ?? null}
                auditRunId={auditMeta?.runId ?? null}
                marketCapCr={config.market_price != null && config.shares_outstanding != null
                  ? (config.market_price * config.shares_outstanding) / 1e7
                  : null}
                nbfcSidecar={nbfcSidecar}
              />
            )}
            {/* Phase A — Scope tab: subsidiary contribution panel (cons − stan gap) */}
            {activeTab === "scope" && scopeAwareResult && <SubsidiaryContributionPanel result={scopeAwareResult} />}
            {activeTab === "comparison" && <ComparisonReport registry={registry} config={config} publication={comparisonPublication} />}
            {activeTab === "report" && hasRecast && (
              <AcademicReport
                data={recastData!}
                config={config}
                rawData={rawData}
                auditMeta={auditMeta}
                traceability={traceability}
                publication={publication}
                ratioSanity={ratioSanity}
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
            {activeTab === "v3analytics" && hasRecast && <V3AnalyticsPanel data={recastData!} config={config} traceability={traceability} traceabilitySummary={publication?.traceabilitySummary ?? null} />}
{activeTab === "debug" && <DebugPanel debugInfo={debugInfo} recastData={recastData} rawData={rawData} qualityGate={qualityGate} engineError={engineError} />}
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
