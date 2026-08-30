import { CompanyRegistry, RawPeriodData } from "../../engine/types";
import { AnalysisStatusSummary } from "../../engine/analysisStatus";
import { AuditSubmissionMeta, isAuditEnabled } from "../../lib/audit";
import { AnalysisStatusBadge } from "../../components/AnalysisStatusBadge";
import CompanySwitcher from "../../components/CompanySwitcher";
import { Icon } from "../../components/shared/Icon";

interface AppHeaderProps {
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

/**
 * Top bar: brand + status chips + utility buttons only. Tab navigation lives
 * solely in `SidebarNav` (which owns the role="tablist" pattern) — the 20-tab
 * horizontal strip that used to sit here was removed as part of the Workbench
 * shell consolidation (docs/greenfield-ui-redesign.md Phase 5).
 */
export function AppHeader({
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
            {/* h1, not a span: the document had no level-one heading at all
                (axe: page-has-heading-one). Tailwind preflight resets heading
                size/weight/margin to inherit, so the classes keep the visual. */}
            <h1 className="inline font-bold text-slate-800 dark:text-slate-100 text-sm">Penman–Nissim V3</h1>
            <span className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400 ml-2">Residual-Income Valuation · Capitaline Ind AS</span>
          </div>
        </div>
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
            className="wb-icon-btn"
            title="Command palette (Ctrl/Cmd+K)"
          >
            <Icon name="command" size={12} />
            <span className="font-mono text-[10px] wb-text-3">K</span>
          </button>
          <button
            onClick={() => setShortcutsOpen(true)}
            className="wb-icon-btn"
            title="Keyboard shortcuts (?)"
          >
            <Icon name="keyboard" size={12} />
          </button>
          <button
            onClick={() => setGlossaryOpen(true)}
            className="wb-icon-btn"
            title="Open glossary — definitions of RNOA, NOA, EPV, Piotroski, etc."
          >
            <Icon name="book" size={12} />
          </button>
          <button
            onClick={() => setDarkMode((v) => !v)}
            className="wb-icon-btn"
            title="Toggle dark mode"
          >
            <Icon name={darkMode ? "sun" : "moon"} size={12} />
          </button>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(window.location.href);
            }}
            className="wb-icon-btn"
            title="Copy shareable link"
          >
            <Icon name="link" size={12} />
          </button>
        </div>
      </div>
    </header>
  );
}
