/**
 * The next UI shell (docs/ui-revamp-plan.md), mounted when the URL carries
 * `?ui=next`. The current interface is untouched until cutover (Phase 6).
 */
import { useMemo } from "react";
import { EmptyState } from "../components/shared/EmptyState";
import { findLibraryCompany } from "../components/data-entry/companyRegistry";
import { CasePage } from "./CasePage";
import { useCompanyRun, useRegistry, useRoute } from "./hooks";
import { LibraryPage } from "./LibraryPage";
import { formatRoute, LIBRARY, type Route } from "./route";

const SPACES: { space: Route["space"]; label: string; href: string }[] = [
  { space: "library", label: "Library", href: formatRoute(LIBRARY) },
  { space: "case", label: "Case", href: formatRoute(LIBRARY) },
  { space: "record", label: "Record", href: formatRoute({ space: "record", company: null }) },
  { space: "lab", label: "Lab", href: formatRoute({ space: "lab", tool: null }) },
];

export function NextApp() {
  const [route] = useRoute();
  const registry = useRegistry();
  const company = useMemo(
    () => route.space === "case" && registry.status === "ready" ? findLibraryCompany(registry.companies, route.company) : null,
    [route, registry],
  );
  const run = useCompanyRun(company);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <nav aria-label="Spaces">
            <ul className="flex gap-1">
              {SPACES.map((s) => {
                const active = s.space === route.space;
                // "Case" has no destination of its own until a company is chosen.
                if (s.space === "case" && !active) return null;
                return (
                  <li key={s.space}>
                    <a
                      href={s.href}
                      aria-current={active ? "page" : undefined}
                      className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
                    >
                      {s.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
          <a href={window.location.pathname} className="text-xs text-slate-500 hover:underline">Back to the current interface</a>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {route.space === "library" && <LibraryPage registry={registry} />}
        {route.space === "case" && (
          registry.status === "ready"
            ? <CasePage route={route} company={company} run={run} />
            : <LibraryPage registry={registry} />
        )}
        {route.space === "record" && (
          <EmptyState icon="book" title="Record arrives in Phase 4" body="Thesis, research journal, frozen forecasts and how they scored." />
        )}
        {route.space === "lab" && (
          <EmptyState icon="flask" title="Lab arrives in Phase 4" body="Regression, V3 analytics, run inspector and debug tools. They remain in the current interface." />
        )}
      </main>
    </div>
  );
}
