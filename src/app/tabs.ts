export type TabId = "upload" | "dashboard" | "watchlist" | "workspace" | "inspector" | "statements" | "ratios" | "forecast" | "valuation" | "bank" | "quality" | "scope" | "atlas" | "business" | "comparison" | "report" | "thesis" | "regression" | "v3analytics" | "debug";

export const TABS: { id: TabId; label: string; icon: string; needsData?: boolean | undefined; group: string }[] = [
  { id: "upload", label: "Data", icon: "📂", group: "input" },
  { id: "dashboard", label: "Dashboard", icon: "📊", needsData: true, group: "input" },
  { id: "watchlist", label: "Watchlist", icon: "🗂", group: "input" },
  { id: "workspace", label: "Workspace", icon: "🧭", group: "input" },
  { id: "inspector", label: "Runs", icon: "🛰️", group: "input" },
  { id: "statements", label: "Statements", icon: "📋", needsData: true, group: "analysis" },
  { id: "ratios", label: "Ratios", icon: "📐", needsData: true, group: "analysis" },
  { id: "quality", label: "Quality", icon: "🔍", needsData: true, group: "analysis" },
  { id: "scope", label: "Scope", icon: "🪞", needsData: true, group: "analysis" },
  { id: "atlas", label: "Atlas", icon: "🛰️", needsData: true, group: "analysis" },
  { id: "business", label: "Business Model", icon: "🏛️", needsData: true, group: "analysis" },
  { id: "forecast", label: "Forecast", icon: "📈", needsData: true, group: "analysis" },
  { id: "valuation", label: "Valuation", icon: "💰", needsData: true, group: "valuation" },
  { id: "bank", label: "Bank", icon: "🏦", needsData: true, group: "valuation" },
  { id: "comparison", label: "Comparison", icon: "👥", needsData: true, group: "peers" },
  { id: "report", label: "Report", icon: "📚", needsData: true, group: "export" },
  { id: "thesis", label: "Thesis", icon: "📋", needsData: true, group: "export" },
  { id: "regression", label: "Regression", icon: "🧪", needsData: true, group: "advanced" },
  { id: "v3analytics", label: "V3 Analytics", icon: "🔬", needsData: true, group: "advanced" },
  { id: "debug", label: "Debug", icon: "🛠", group: "advanced" },
];

export const TAB_GROUPS: { key: string; label: string }[] = [
  { key: "input", label: "Data & Input" },
  { key: "analysis", label: "Analysis" },
  { key: "valuation", label: "Valuation" },
  { key: "peers", label: "Peers" },
  { key: "export", label: "Export" },
  { key: "advanced", label: "Advanced" },
];
