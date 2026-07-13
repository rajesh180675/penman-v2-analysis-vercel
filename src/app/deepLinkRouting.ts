import type { AnalysisFamily, ScopeAssessment } from "../engine/scopePolicy";
import type { TabId } from "./tabs";

const FINANCIAL_SUPPORTED_TABS = new Set<TabId>([
  "dashboard", "watchlist", "workspace", "inspector", "ratios", "quality",
  "valuation", "bank", "atlas", "business", "comparison", "report", "debug",
]);
const FINANCIAL_BLOCKED_TABS = new Set<TabId>([
  "watchlist", "workspace", "inspector", "valuation", "bank", "atlas",
  "business", "comparison", "debug",
]);

export function defaultPostIngestionTab(family: AnalysisFamily, scope: ScopeAssessment): TabId {
  if (scope.blocked) return "debug";
  return family === "financial-institution" ? "bank" : "statements";
}

export function resolvePostIngestionDeepLinkTab(input: {
  requestedTab: TabId | null;
  family: AnalysisFamily;
  scope: ScopeAssessment;
  hasStandaloneData: boolean;
}): TabId {
  const fallback = defaultPostIngestionTab(input.family, input.scope);
  const requested = input.requestedTab;
  if (!requested || requested === "upload") return fallback;
  if (requested === "scope") {
    return input.family === "industrial" && !input.scope.blocked && input.hasStandaloneData ? "scope" : fallback;
  }
  if (input.family === "industrial") return requested;
  const allowed = input.scope.blocked ? FINANCIAL_BLOCKED_TABS : FINANCIAL_SUPPORTED_TABS;
  return allowed.has(requested) ? requested : fallback;
}
