/**
 * The Record and Lab spaces: the tools that are not yet rebuilt, each opened
 * in the classic interface for the chosen company. Tools that need a
 * company's data say so until one is chosen.
 */
import { useState } from "react";
import { TABS, type TabId } from "../app/tabs";
import type { LibraryCompany } from "../components/data-entry/companyRegistry";
import { classicHref, toolsIn } from "./legacyTools";
import { formatRoute } from "./route";
import { Withheld } from "./ui/Withheld";

const NEEDS_DATA = new Set<TabId>(TABS.filter((t) => t.needsData).map((t) => t.id));

const SPACE = {
  record: { title: "Record", intro: "Thesis, reports and exports for a company." },
  lab: { title: "Lab", intro: "Diagnostic and research tools." },
} as const;

export function ToolsPage({
  kind,
  companies,
  company,
}: {
  kind: "record" | "lab";
  companies: readonly LibraryCompany[];
  /** The company from the route (Record); the Lab keeps its own choice. */
  company: LibraryCompany | null;
}) {
  const [labCompany, setLabCompany] = useState<string>("");
  const chosen = kind === "record" ? company : companies.find((c) => c.ticker === labCompany) ?? null;
  const sorted = [...companies].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section aria-labelledby="tools-heading" className="space-y-4">
      <header>
        <h1 id="tools-heading" className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          {SPACE[kind].title}{chosen ? ` — ${chosen.name}` : ""}
        </h1>
        <p className="text-sm text-slate-500">{SPACE[kind].intro} They open in the classic interface until they are rebuilt here.</p>
      </header>

      <label className="block text-sm">
        <span className="mr-2 text-slate-600 dark:text-slate-300">Company</span>
        <select
          value={chosen?.ticker ?? ""}
          onChange={(e) => {
            if (kind === "record") window.location.hash = formatRoute({ space: "record", company: e.target.value || null });
            else setLabCompany(e.target.value);
          }}
          className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
        >
          <option value="">Choose a company…</option>
          {sorted.map((c) => <option key={c.folder} value={c.ticker}>{c.name}</option>)}
        </select>
      </label>

      <ul className="grid gap-3 sm:grid-cols-2">
        {toolsIn(kind).map(({ tab, label, description }) => {
          const blocked = NEEDS_DATA.has(tab) && !chosen;
          return (
            <li key={tab} className="wb-surface rounded-xl border p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</h2>
              <p className="mt-1 text-xs text-slate-500">{description}</p>
              <div className="mt-2 text-sm">
                {blocked
                  ? <Withheld reason="Choose a company first — this tool works on one company's data." />
                  : <a href={classicHref(tab, chosen?.ticker ?? null)} className="text-sky-700 hover:underline dark:text-sky-400">Open in the classic interface</a>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
