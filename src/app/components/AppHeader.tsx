import { CompanyRegistry, RawPeriodData } from "../../engine/types";
import { AnalysisStatusSummary } from "../../engine/analysisStatus";
import { AuditSubmissionMeta, isAuditEnabled } from "../../lib/audit";
import { AnalysisStatusBadge } from "../../components/AnalysisStatusBadge";
import CompanySwitcher from "../../components/CompanySwitcher";
import type { TabId } from "../tabs";
import { TABS, TAB_GROUPS } from "../tabs";
import { Icon, type IconName } from "../../components/shared/Primitives";

interface AppHeaderProps {
  visibleTabs: typeof TABS;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  valuationBlocked: boolean;
  financialFallbackAvailable: boolean;
  scopeBlocked: boolean;
  auditMeta: AuditSubmissionMeta | null;
  rawData: RawPeriodData[] | null;
  analysisStatus: AnalysisStatusSummary;
  registry: CompanyRegistry;
  activeCompanyId: string | null;
  onSwitchCompany: (companyId: string) => void;
  serverMode: "offline" | "local" | string;
  darkMode: boolean;
  setDarkMode: (fn: (v: boolean) => boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
  setGlossaryOpen: (v: boolean) => void;
}

const TAB_ICONS: Record<TabId, IconName> = {
  upload: "database",
  dashboard: "chart",
  watchlist: "folder",
  workspace: "compass",
  inspector: "satellite",
  statements: "table",
  ratios: "calculator",
  quality: "search",
  scope: "mirror",
  atlas: "satellite",
  business: "building",
  forecast: "trending-up",
  valuation: "currency",
  bank: "bank",
  comparison: "users",
  report: "book",
  thesis: "document",
  regression: "flask",
  v3analytics: "microscope",
  debug: "wrench",
};

export function AppHeader({
  visibleTabs,
  activeTab,
  setActiveTab,
  valuationBlocked,
  financialFallbackAvailable,
  scopeBlocked,
  auditMeta,
  rawData,
  analysisStatus,
  registry,
  activeCompanyId,
  onSwitchCompany,
  serverMode,
  darkMode,
  setDarkMode,
  setPaletteOpen,
  setShortcutsOpen,
  setGlossaryOpen,
}: AppHeaderProps) {
  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 shadow-sm">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-0 flex items-center justify-between h-14">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">PN</div>
          <div>
            <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">Penman–Nissim V3</span>
            <span className="hidden sm:inline text-xs text-slate-400 ml-2">Residual-Income Valuation · Capitaline Ind AS</span>
          </div>
        </div>
        <nav className="flex h-full overflow-x-auto gap-0.5" role="tablist" aria-label="Analysis tabs">
          {TAB_GROUPS.map(group => {
            const groupTabs = visibleTabs.filter(t => t.group === group.key);
            if (groupTabs.length === 0) return null;
            return (
              <div key={group.key} className="flex items-center">
                <span className="text-[9px] uppercase tracking-wider text-slate-400 px-1.5 hidden lg:inline">{group.label}</span>
                {groupTabs.map(tab => (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    aria-controls={`panel-${tab.id}`}
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
                      ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                      : tab.id === "valuation" && valuationBlocked
                        ? "border-transparent text-slate-300 dark:text-slate-600 cursor-not-allowed"
                        : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300"
                      }`}>
                    <Icon name={TAB_ICONS[tab.id]} size={14} />
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
            <span className="hidden lg:inline-flex px-2 py-1 text-[11px] rounded border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400">
              Audit run {auditMeta.runId.slice(0, 8)}
            </span>
          )}
          {rawData && <AnalysisStatusBadge status={analysisStatus} compact />}
          <CompanySwitcher
            registry={registry}
            activeCompanyId={activeCompanyId}
            onSwitchCompany={onSwitchCompany}
          />
          {serverMode === "offline" && (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700" title="Local server not running. Live NSE prices and audit persistence unavailable. Use: npm run dev:local">
              Offline
            </span>
          )}
          {serverMode === "local" && (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700" title="Local server running — NSE prices + audit persistence active">
              Local
            </span>
          )}
          <button
            onClick={() => setPaletteOpen(true)}
            className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1"
            title="Command palette (Ctrl/Cmd+K)"
          >
            <Icon name="command" size={12} />
            <span className="font-mono text-[10px] text-slate-500">K</span>
          </button>
          <button
            onClick={() => setShortcutsOpen(true)}
            className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700"
            title="Keyboard shortcuts (?)"
          >
            <Icon name="keyboard" size={12} />
          </button>
          <button
            onClick={() => setGlossaryOpen(true)}
            className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700"
            title="Open glossary — definitions of RNOA, NOA, EPV, Piotroski, etc."
          >
            <Icon name="book" size={12} />
          </button>
          <button
            onClick={() => setDarkMode((v) => !v)}
            className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            title="Toggle dark mode"
          >
            <Icon name={darkMode ? "sun" : "moon"} size={12} />
          </button>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(window.location.href);
            }}
            className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            title="Copy shareable link"
          >
            <Icon name="link" size={12} />
          </button>
        </div>
      </div>
    </header>
  );
}
