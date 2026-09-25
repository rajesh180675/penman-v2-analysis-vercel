import { EmptyState } from "../components/shared/EmptyState";
import type { LibraryCompany } from "../components/data-entry/companyRegistry";
import type { CompanyRunState } from "./companyRun";
import { CASE_SECTIONS, formatRoute, LIBRARY, type CaseRoute, type CaseSection } from "./route";

/** Phase that builds each section, and today's tab that covers it meanwhile. */
const SECTION_STATUS: Record<CaseSection, { phase: number; currentTab: string }> = {
  verdict: { phase: 1, currentTab: "dashboard" },
  economics: { phase: 2, currentTab: "statements" },
  evidence: { phase: 2, currentTab: "quality" },
  forecast: { phase: 3, currentTab: "forecast" },
  valuation: { phase: 3, currentTab: "valuation" },
  peers: { phase: 4, currentTab: "comparison" },
};

const STEP_LABEL = { fetching: "Fetching filings…", parsing: "Reading statements…", analysing: "Running the analysis…" } as const;

export function CasePage({
  route,
  company,
  run,
}: {
  route: CaseRoute;
  company: LibraryCompany | null;
  run: CompanyRunState | null;
}) {
  if (!company) {
    return (
      <EmptyState
        icon="search"
        title={`No company "${route.company}" in the library`}
        body="Pick a company from the Library."
      />
    );
  }
  const section = CASE_SECTIONS.find((s) => s.id === route.section)!;
  const status = SECTION_STATUS[route.section];
  const currentUiHref = `?company=${encodeURIComponent(company.ticker)}&tab=${status.currentTab}`;

  return (
    <article aria-labelledby="case-heading" className="space-y-5">
      <header className="space-y-1">
        <a href={formatRoute(LIBRARY)} className="text-xs text-slate-500 hover:underline">Library</a>
        <h1 id="case-heading" className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {company.name} <span className="font-mono text-base text-slate-500">{company.ticker}</span>
        </h1>
        <RunStatus run={run} />
      </header>

      <nav aria-label="Case sections">
        <ul className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700">
          {CASE_SECTIONS.map((s) => {
            const active = s.id === route.section;
            return (
              <li key={s.id}>
                <a
                  href={formatRoute({ ...route, section: s.id })}
                  aria-current={active ? "page" : undefined}
                  className={`block border-b-2 px-3 py-2 text-sm ${active ? "border-sky-600 font-medium text-slate-900 dark:text-slate-100" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
                >
                  {s.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-label={section.label}>
        <EmptyState
          icon="layers"
          title={`${section.label} arrives in Phase ${status.phase}`}
          body="Until then, the current interface covers it."
          action={{ label: "Open in the current interface", onClick: () => window.location.assign(currentUiHref) }}
        />
      </section>
    </article>
  );
}

function RunStatus({ run }: { run: CompanyRunState | null }) {
  if (!run) return null;
  if (run.status === "loading") {
    return <p className="text-sm text-slate-500" role="status">{STEP_LABEL[run.step]}</p>;
  }
  if (run.status === "error") {
    return <p className="text-sm text-red-700 dark:text-red-400" role="alert">Analysis could not run: {run.message}</p>;
  }
  const { result } = run;
  if (!result.run) {
    return <p className="text-sm text-red-700 dark:text-red-400" role="alert">Analysis failed: {result.status === "failed" ? result.message : result.status}</p>;
  }
  const { confidence, rigor } = result.run.trustEnvelope;
  const tone = confidence.tone === "emerald"
    ? "text-emerald-700 dark:text-emerald-400"
    : confidence.tone === "amber" ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
  return (
    <p className="text-sm" role="status">
      <span className={`font-medium ${tone}`}>{confidence.headline}</span>
      <span className="text-slate-500"> · Rigor: {rigor.currentLabel}</span>
    </p>
  );
}
