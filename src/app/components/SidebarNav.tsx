import { useState } from "react";
import type { TabId } from "../tabs";
import { TABS, TAB_GROUPS } from "../tabs";
import { TAB_ICONS } from "../tabIcons";
import { Icon } from "../../components/shared/Icon";

interface SidebarNavProps {
  visibleTabs: typeof TABS;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  valuationBlocked: boolean;
  financialFallbackAvailable: boolean;
  scopeBlocked: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  input: "Setup",
  analysis: "Analyze",
  valuation: "Value",
  peers: "Compare",
  export: "Decide",
  advanced: "Advanced",
};

/**
 * The app's single tab navigation. Owns the role="tablist"/role="tab" pattern
 * (the header tab strip was removed — see AppHeader). AppShell renders the
 * matching role="tabpanel" and points `aria-labelledby` at `tab-<activeTab>`,
 * so the expanded rail's buttons carry those ids.
 */
export function SidebarNav({
  visibleTabs,
  activeTab,
  setActiveTab,
  valuationBlocked,
  financialFallbackAvailable,
  scopeBlocked,
}: SidebarNavProps) {
  const [collapsed, setCollapsed] = useState(false);

  const isDisabled = (tab: TabId) => tab === "valuation" && valuationBlocked && !financialFallbackAvailable;
  const disabledTitle = scopeBlocked
    ? "Unsupported financial-company scope. See Debug tab."
    : "Valuation blocked by quality gate. See Debug tab.";

  if (collapsed) {
    // Icon rail: plain buttons (no tab roles). Only one rail renders at a
    // time, so giving these buttons the same `tab-<id>` ids as the expanded
    // rail keeps AppShell's tabpanel `aria-labelledby` valid while collapsed.
    return (
      <aside className="w-12 flex-shrink-0 border-r wb-border wb-surface h-[calc(100vh-3.5rem)] sticky top-14 flex flex-col items-center py-2 gap-1">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 rounded-lg wb-text-3 hover:bg-slate-100 dark:hover:bg-slate-800 mb-2"
          title="Expand sidebar"
        >
          <Icon name="chevron-right" size={16} />
        </button>
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            // Keep the `tab-<id>` ids on the collapsed rail too: AppShell's
            // tabpanel points aria-labelledby at `tab-<activeTab>`, and dropping
            // the ids here would leave that reference dangling while collapsed.
            // Only one rail renders at a time, so the ids never duplicate.
            id={`tab-${tab.id}`}
            onClick={() => {
              if (isDisabled(tab.id)) return;
              setActiveTab(tab.id);
            }}
            disabled={isDisabled(tab.id)}
            className={`p-2 rounded-lg transition-colors ${
              activeTab === tab.id
                ? "wb-sidebar-item-active"
                : isDisabled(tab.id)
                ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                : "wb-text-3 hover:bg-slate-100 dark:hover:bg-slate-800"
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
      <div className="flex items-center justify-between px-3 py-2 border-b wb-divider">
        <span className="text-xs font-semibold wb-text-3 uppercase tracking-wider">Navigation</span>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 rounded wb-text-3 hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Collapse sidebar"
        >
          <Icon name="chevron-down" size={14} className="rotate-90" />
        </button>
      </div>
      <nav className="py-2" role="tablist" aria-label="Analysis tabs">
        {TAB_GROUPS.map(group => {
          const groupTabs = visibleTabs.filter(t => t.group === group.key);
          if (groupTabs.length === 0) return null;
          return (
            <div key={group.key} className="wb-sidebar-section">
              <p className="wb-sidebar-section-title">{STAGE_LABELS[group.key] ?? group.label}</p>
              {groupTabs.map(tab => (
                <button
                  key={tab.id}
                  id={`tab-${tab.id}`}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  // Only the selected tab has a rendered panel (TabRouter swaps one
                  // container's contents), so aria-controls is set only where the
                  // target actually exists — pointing at an unmounted panel-* id is
                  // the dangling-reference defect this guards against.
                  aria-controls={activeTab === tab.id ? `panel-${tab.id}` : undefined}
                  onClick={() => {
                    if (isDisabled(tab.id)) return;
                    setActiveTab(tab.id);
                  }}
                  disabled={isDisabled(tab.id)}
                  className={`wb-sidebar-item ${activeTab === tab.id ? "wb-sidebar-item-active" : ""}`}
                  title={isDisabled(tab.id) ? disabledTitle : undefined}
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
