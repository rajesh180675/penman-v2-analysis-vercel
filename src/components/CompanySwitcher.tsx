import { useState, useRef, useEffect } from "react";
import type { CompanyRegistry } from "../engine/types";

interface Props {
  registry: CompanyRegistry;
  /** Currently active company ID */
  activeCompanyId: string | null;
  /** Called when user selects a different company */
  onSwitchCompany: (companyId: string) => void;
}

/**
 * Header CompanySwitcher — dropdown for fast switching between loaded
 * companies without having to navigate through Watchlist.
 */
export default function CompanySwitcher({ registry, activeCompanyId, onSwitchCompany }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const companies = Object.values(registry.companies)
    .filter(c => c.recastData.length > 0)
    .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));

  if (companies.length <= 1) return null;

  const active = activeCompanyId ? registry.companies[activeCompanyId] : null;
  const activeLabel = active?.label || active?.id || "Select company";

  return (
    <div ref={ref} className="relative no-print">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors"
        title="Switch active company"
      >
        <span className="text-base">🏢</span>
        <span className="max-w-[140px] truncate">{activeLabel}</span>
        <span className="text-xs text-slate-400">{companies.length}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="currentColor">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 max-h-96 overflow-y-auto rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg z-50">
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Switch Company ({companies.length} loaded)
            </div>
          </div>
          <div className="py-1">
            {companies.map(c => {
              const isActive = c.id === activeCompanyId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onSwitchCompany(c.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  }`}
                >
                  <span className="flex-1 truncate">{c.label || c.id}</span>
                  <span className="text-[10px] text-slate-400">{c.recastData.length}p</span>
                  {isActive && <span className="text-xs">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
