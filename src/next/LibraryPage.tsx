import { EmptyState } from "../components/shared/EmptyState";
import type { LibraryCompany } from "../components/data-entry/companyRegistry";
import type { RegistryState } from "./hooks";
import { classicHref, toolsIn } from "./legacyTools";
import { caseRoute, formatRoute } from "./route";

export function LibraryPage({ registry }: { registry: RegistryState }) {
  if (registry.status === "loading") {
    return <p className="text-sm text-slate-500" role="status">Loading the company library…</p>;
  }
  if (registry.status === "error") {
    return <EmptyState icon="alert-triangle" title="The company library could not be loaded" body={registry.message} />;
  }
  const companies = [...registry.companies].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section aria-labelledby="library-heading" className="space-y-4">
      <header className="flex items-baseline justify-between gap-4">
        <h1 id="library-heading" className="text-xl font-semibold text-slate-900 dark:text-slate-100">Library</h1>
        <p className="text-sm text-slate-500">{companies.length} companies</p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {companies.map((company) => <LibraryCard key={company.folder} company={company} />)}
      </ul>
      <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Your data and lists</h2>
        <p className="text-xs text-slate-500">These open in the classic interface until they are rebuilt here.</p>
        <ul className="mt-2 grid gap-3 sm:grid-cols-3">
          {toolsIn("library").map(({ tab, label, description }) => (
            <li key={tab}>
              <a href={classicHref(tab)} className="wb-surface block rounded-xl border p-3 text-sm shadow-sm hover:border-slate-400">
                <span className="font-medium text-slate-900 dark:text-slate-100">{label}</span>
                <span className="mt-1 block text-xs text-slate-500">{description}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function LibraryCard({ company }: { company: LibraryCompany }) {
  return (
    <li>
      <a
        href={formatRoute(caseRoute(company.ticker))}
        className="wb-surface block rounded-xl border p-4 shadow-sm transition hover:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-slate-900 dark:text-slate-100">{company.name}</span>
          <span className="font-mono text-xs text-slate-500">{company.ticker}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">{company.sector} · {company.type}</p>
      </a>
    </li>
  );
}
