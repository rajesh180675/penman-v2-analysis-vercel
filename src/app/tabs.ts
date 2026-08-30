export type TabId = "upload" | "dashboard" | "watchlist" | "workspace" | "inspector" | "statements" | "ratios" | "forecast" | "valuation" | "bank" | "quality" | "scope" | "atlas" | "business" | "comparison" | "report" | "thesis" | "regression" | "v3analytics" | "debug" | "design" | "charts";

// No `icon` field: tab icons are SVG, resolved via `src/app/tabIcons.ts`
// (TAB_ICONS). The old emoji strings are gone with the header tab strip.
export const TABS: { id: TabId; label: string; needsData?: boolean | undefined; group: string }[] = [
  { id: "upload", label: "Data", group: "input" },
  { id: "dashboard", label: "Dashboard", needsData: true, group: "input" },
  { id: "watchlist", label: "Watchlist", group: "input" },
  { id: "workspace", label: "Workspace", group: "input" },
  { id: "inspector", label: "Runs", group: "input" },
  { id: "statements", label: "Statements", needsData: true, group: "analysis" },
  { id: "ratios", label: "Ratios", needsData: true, group: "analysis" },
  { id: "quality", label: "Quality", needsData: true, group: "analysis" },
  { id: "scope", label: "Scope", needsData: true, group: "analysis" },
  { id: "atlas", label: "Atlas", needsData: true, group: "analysis" },
  { id: "business", label: "Business Model", needsData: true, group: "analysis" },
  { id: "forecast", label: "Forecast", needsData: true, group: "analysis" },
  { id: "valuation", label: "Valuation", needsData: true, group: "valuation" },
  { id: "bank", label: "Bank", needsData: true, group: "valuation" },
  { id: "comparison", label: "Comparison", needsData: true, group: "peers" },
  { id: "report", label: "Report", needsData: true, group: "export" },
  { id: "thesis", label: "Thesis", needsData: true, group: "export" },
  { id: "regression", label: "Regression", needsData: true, group: "advanced" },
  { id: "v3analytics", label: "V3 Analytics", needsData: true, group: "advanced" },
  { id: "debug", label: "Debug", group: "advanced" },
  // Dev-only design-system checklist (docs/greenfield-ui-redesign.md §2.7).
  // Hidden unless import.meta.env.DEV — see useTabVisibility.
  { id: "design", label: "Design", group: "advanced" },
  { id: "charts", label: "Charts", group: "advanced" },
];

export const TAB_GROUPS: { key: string; label: string }[] = [
  { key: "input", label: "Data & Input" },
  { key: "analysis", label: "Analysis" },
  { key: "valuation", label: "Valuation" },
  { key: "peers", label: "Peers" },
  { key: "export", label: "Export" },
  { key: "advanced", label: "Advanced" },
];
