/**
 * Where every tab of the current interface lives in the next UI
 * (docs/ui-revamp-plan.md, "Where today's 22 tabs go"). A tab is either
 * rebuilt as a Case section, or reached from the Library, Record or Lab, which
 * open it in the classic interface for the chosen company until it is rebuilt.
 * Keyed by TabId, so a new tab without a home fails to compile.
 */
import type { TabId } from "../app/tabs";
import type { CaseSection } from "./route";

export type TabHome =
  | { readonly kind: "case"; readonly section: CaseSection }
  | { readonly kind: "library" | "record" | "lab"; readonly label: string; readonly description: string };

export const TAB_HOMES: Readonly<Record<TabId, TabHome>> = {
  dashboard: { kind: "case", section: "verdict" },
  statements: { kind: "case", section: "economics" },
  ratios: { kind: "case", section: "economics" },
  business: { kind: "case", section: "economics" },
  atlas: { kind: "case", section: "economics" },
  quality: { kind: "case", section: "evidence" },
  scope: { kind: "case", section: "evidence" },
  forecast: { kind: "case", section: "forecast" },
  valuation: { kind: "case", section: "valuation" },
  bank: { kind: "case", section: "valuation" },
  comparison: { kind: "case", section: "peers" },

  upload: { kind: "library", label: "Upload your own data", description: "Load a Capitaline, Screener, XBRL or manual dataset that is not in the library." },
  watchlist: { kind: "library", label: "Watchlist", description: "Companies you track, with their latest signals." },
  workspace: { kind: "library", label: "Workspace", description: "Your saved companies and shared research state." },

  report: { kind: "record", label: "Academic report", description: "The full written analysis, exportable." },
  thesis: { kind: "record", label: "Investment thesis", description: "The thesis and the evidence behind it." },

  inspector: { kind: "lab", label: "Run inspector", description: "Every analysis run, its identity and integrity." },
  regression: { kind: "lab", label: "Regression", description: "Cross-period regression diagnostics." },
  v3analytics: { kind: "lab", label: "V3 analytics", description: "Terminal value, market-implied and sensitivity analytics." },
  debug: { kind: "lab", label: "Debug", description: "Parser mappings, recast verification and raw lines." },
  design: { kind: "lab", label: "Design system", description: "The component and token checklist (development builds)." },
  charts: { kind: "lab", label: "Charts", description: "The chart gallery." },
};

/** The classic interface at a tab, for a company when one is given. */
export function classicHref(tab: TabId, companyTicker: string | null = null): string {
  const params = new URLSearchParams({ ui: "classic", tab });
  if (companyTicker) params.set("company", companyTicker);
  return `/?${params.toString()}`;
}

/** The tabs a space hosts, in declaration order. */
export function toolsIn(kind: "library" | "record" | "lab"): { tab: TabId; label: string; description: string }[] {
  return (Object.entries(TAB_HOMES) as [TabId, TabHome][]).flatMap(([tab, home]) =>
    home.kind === kind ? [{ tab, label: home.label, description: home.description }] : []);
}
