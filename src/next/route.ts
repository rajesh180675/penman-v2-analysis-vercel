/**
 * Routes for the next UI (docs/ui-revamp-plan.md). Hash-based — `#/case/ITC/verdict?asOf=2023-03-31`
 * — because the deployment has no SPA rewrites: a path route would 404 on
 * refresh. Pure: parse and format round-trip, and unknown input falls back to
 * the Library rather than throwing.
 */

export const CASE_SECTIONS = [
  { id: "verdict", label: "Verdict" },
  { id: "economics", label: "Business & economics" },
  { id: "evidence", label: "Evidence & trust" },
  { id: "forecast", label: "Forecast" },
  { id: "valuation", label: "Valuation" },
  { id: "peers", label: "Peers" },
] as const;

export type CaseSection = (typeof CASE_SECTIONS)[number]["id"];
export type Scenario = "bear" | "base" | "bull";

export type Route =
  | { readonly space: "library" }
  | {
      readonly space: "case";
      readonly company: string;
      readonly section: CaseSection;
      readonly asOf: string | null;
      readonly scenario: Scenario;
    }
  | { readonly space: "record"; readonly company: string | null }
  | { readonly space: "lab"; readonly tool: string | null };

const SECTION_IDS = new Set<string>(CASE_SECTIONS.map((s) => s.id));
const SCENARIOS = new Set<string>(["bear", "base", "bull"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type CaseRoute = Extract<Route, { space: "case" }>;

export const LIBRARY: Route = { space: "library" };

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, "");
  const [path = "", query = ""] = raw.split("?", 2);
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);

  switch (parts[0]) {
    case "case": {
      const company = parts[1];
      if (!company) return LIBRARY;
      const section = parts[2] && SECTION_IDS.has(parts[2]) ? (parts[2] as CaseSection) : "verdict";
      const asOf = params.get("asOf");
      const scenario = params.get("scenario");
      return {
        space: "case",
        company,
        section,
        asOf: asOf && ISO_DATE.test(asOf) ? asOf : null,
        scenario: scenario && SCENARIOS.has(scenario) ? (scenario as Scenario) : "base",
      };
    }
    case "record":
      return { space: "record", company: parts[1] ?? null };
    case "lab":
      return { space: "lab", tool: parts[1] ?? null };
    default:
      return LIBRARY;
  }
}

export function formatRoute(route: Route): string {
  switch (route.space) {
    case "library":
      return "#/library";
    case "case": {
      const params = new URLSearchParams();
      if (route.asOf) params.set("asOf", route.asOf);
      if (route.scenario !== "base") params.set("scenario", route.scenario);
      const query = params.toString();
      return `#/case/${encodeURIComponent(route.company)}/${route.section}${query ? `?${query}` : ""}`;
    }
    case "record":
      return route.company ? `#/record/${encodeURIComponent(route.company)}` : "#/record";
    case "lab":
      return route.tool ? `#/lab/${encodeURIComponent(route.tool)}` : "#/lab";
  }
}

export function caseRoute(company: string, section: CaseSection = "verdict"): CaseRoute {
  return { space: "case", company, section, asOf: null, scenario: "base" };
}
