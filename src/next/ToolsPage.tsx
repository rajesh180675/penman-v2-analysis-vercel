/**
 * The Record and Lab spaces. Each tool renders here on the chosen company's
 * shared run — the one its Case reads — so a tool never re-runs the analysis
 * and shows the Case's numbers. Tools that need a company say so until one is
 * chosen.
 */
import { lazy, Suspense } from "react";
import { TABS, type TabId } from "../app/tabs";
import type { LibraryCompany } from "../components/data-entry/companyRegistry";
import type { CompanyRegistry } from "../engine/types";
import type { CompanyRunState } from "./companyRun";
import { toolsIn } from "./legacyTools";
import { formatRoute, type Route } from "./route";
import { Withheld } from "./ui/Withheld";

// The tools are their own chunk: a Case visit never loads them.
const ToolPanel = lazy(() => import("./ToolPanel").then((m) => ({ default: m.ToolPanel })));

const NEEDS_DATA = new Set<TabId>(TABS.filter((t) => t.needsData).map((t) => t.id));

const SPACE = {
  record: { title: "Record", intro: "Thesis, reports and exports for a company." },
  lab: { title: "Lab", intro: "Diagnostic and research tools." },
} as const;

const STEP_LABEL = { fetching: "Fetching filings…", parsing: "Reading statements…", analysing: "Running the analysis…" } as const;

type ToolsRoute = Extract<Route, { space: "record" | "lab" }>;

export function ToolsPage({
  route,
  companies,
  company,
  run = null,
  sessionRegistry = { companies: {} },
}: {
  route: ToolsRoute;
  companies: readonly LibraryCompany[];
  /** The company from the route, when it is in the library. */
  company: LibraryCompany | null;
  /** That company's shared run. */
  run?: CompanyRunState | null;
  sessionRegistry?: CompanyRegistry;
}) {
  const kind = route.space;
  const tools = toolsIn(kind);
  const tool = tools.find((t) => t.tab === route.tool) ?? null;
  const sorted = [...companies].sort((a, b) => a.name.localeCompare(b.name));
  const at = (next: { company?: string | null; tool?: string | null }): string =>
    formatRoute({ ...route, ...next } as ToolsRoute);

  return (
    <section aria-labelledby="tools-heading" className="space-y-4">
      <header>
        <h1 id="tools-heading" className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          {SPACE[kind].title}{company ? ` — ${company.name}` : ""}
        </h1>
        <p className="text-sm text-slate-500">{SPACE[kind].intro}</p>
      </header>

      <label className="block text-sm">
        <span className="mr-2 text-slate-600 dark:text-slate-300">Company</span>
        <select
          value={company?.ticker ?? ""}
          onChange={(e) => { window.location.hash = at({ company: e.target.value || null }); }}
          className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
        >
          <option value="">Choose a company…</option>
          {sorted.map((c) => <option key={c.folder} value={c.ticker}>{c.name}</option>)}
        </select>
      </label>
      {route.company && !company && (
        <p className="text-sm text-red-700 dark:text-red-400" role="alert">No company "{route.company}" in the library.</p>
      )}

      <nav aria-label={`${SPACE[kind].title} tools`}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {tools.map(({ tab, label, description }) => {
            const active = tab === tool?.tab;
            return (
              <li key={tab}>
                <a
                  href={at({ tool: tab })}
                  aria-current={active ? "page" : undefined}
                  className={`wb-surface block rounded-xl border p-4 shadow-sm hover:border-slate-400 ${active ? "border-sky-600" : ""}`}
                >
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</span>
                  <span className="mt-1 block text-xs text-slate-500">{description}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {tool && (
        <section aria-label={tool.label} className="border-t border-slate-200 pt-4 dark:border-slate-700">
          <ToolBody tab={tool.tab} company={company} run={run} sessionRegistry={sessionRegistry} />
        </section>
      )}
    </section>
  );
}

function ToolBody({ tab, company, run, sessionRegistry }: {
  tab: TabId;
  company: LibraryCompany | null;
  run: CompanyRunState | null;
  sessionRegistry: CompanyRegistry;
}) {
  if (NEEDS_DATA.has(tab) && !company) {
    return <Withheld reason="Choose a company first — this tool works on one company's data." />;
  }
  if (company && run?.status === "loading") {
    return <p className="text-sm text-slate-500" role="status">{STEP_LABEL[run.step]}</p>;
  }
  if (company && run?.status === "error") {
    return <p className="text-sm text-red-700 dark:text-red-400" role="alert">Analysis could not run: {run.message}</p>;
  }
  const ready = company && run?.status === "ready" ? run : null;
  // A company tool waits for its run; the rest render straight away.
  if (NEEDS_DATA.has(tab) && !ready) return <p className="text-sm text-slate-500" role="status">Loading…</p>;
  return (
    <Suspense fallback={<p className="text-sm text-slate-500" role="status">Loading the tool…</p>}>
      <ToolPanel tab={tab} run={ready} sessionRegistry={sessionRegistry} />
    </Suspense>
  );
}
