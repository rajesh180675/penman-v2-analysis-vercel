import { useState } from "react";
import type { TabId } from "../tabs";
import { TABS, TAB_GROUPS } from "../tabs";
import { Icon, type IconName } from "../../components/shared/Primitives";

interface SidebarNavProps {
  visibleTabs: typeof TABS;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  valuationBlocked: boolean;
  financialFallbackAvailable: boolean;
  scopeBlocked: boolean;
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

const STAGE_LABELS: Record<string, string> = {
  input: "Setup",
  analysis: "Analyze",
  valuation: "Value",
  peers: "Compare",
  export: "Decide",
  advanced: "Advanced",
};

export function SidebarNav({
  visibleTabs,
  activeTab,
  setActiveTab,
  valuationBlocked,
  financialFallbackAvailable,
  scopeBlocked,
}: SidebarNavProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside className="w-12 flex-shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 h-[calc(100vh-3.5rem)] sticky top-14 flex flex-col items-center py-2 gap-1">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 mb-2"
          title="Expand sidebar"
        >
          <Icon name="chevron-right" size={16} />
        </button>
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              if (tab.id === "valuation" && valuationBlocked && !financialFallbackAvailable) return;
              setActiveTab(tab.id);
            }}
            disabled={tab.id === "valuation" && valuationBlocked && !financialFallbackAvailable}
            className={`p-2 rounded-lg transition-colors ${
              activeTab === tab.id
                ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-400"
                : tab.id === "valuation" && valuationBlocked
                ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
            title={tab.label}
          >
            <Icon name={TAB_ICONS[tab.id]} size={18} />
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="wb-sidebar">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-800">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Navigation</span>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Collapse sidebar"
        >
          <Icon name="chevron-down" size={14} className="rotate-90" />
        </button>
      </div>
      <nav className="py-2">
        {TAB_GROUPS.map(group => {
          const groupTabs = visibleTabs.filter(t => t.group === group.key);
          if (groupTabs.length === 0) return null;
          return (
            <div key={group.key} className="wb-sidebar-section">
              <p className="wb-sidebar-section-title">{STAGE_LABELS[group.key] ?? group.label}</p>
              {groupTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (tab.id === "valuation" && valuationBlocked && !financialFallbackAvailable) return;
                    setActiveTab(tab.id);
                  }}
                  disabled={tab.id === "valuation" && valuationBlocked && !financialFallbackAvailable}
                  className={`wb-sidebar-item ${activeTab === tab.id ? "wb-sidebar-item-active" : ""}`}
                  title={
                    tab.id === "valuation" && valuationBlocked && !financialFallbackAvailable
                      ? scopeBlocked
                        ? "Unsupported financial-company scope. See Debug tab."
                        : "Valuation blocked by quality gate. See Debug tab."
                      : undefined
                  }
                >
                  <span className="wb-sidebar-icon">
                    <Icon name={TAB_ICONS[tab.id]} size={16} />
                  </span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
