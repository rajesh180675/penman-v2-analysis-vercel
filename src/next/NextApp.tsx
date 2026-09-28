/**
 * The next UI shell (docs/ui-revamp-plan.md) — the default interface since the
 * Phase 6 cutover. The classic interface stays at `?ui=classic`.
 */
import { useMemo, useState } from "react";
import { findLibraryCompany } from "../components/data-entry/companyRegistry";
import { CasePage } from "./CasePage";
import { registerUploadedCompany, sessionRegistry, useCompanyRun, usePeerRuns, useRegistry, useRoute, useSnapshots, useTieOut, useTrackRecord } from "./hooks";
import { choosePeers } from "./sections/PeersSection";
import { ToolsPage } from "./ToolsPage";
import type { UploadedCompany } from "./UploadPanel";
import { LibraryPage } from "./LibraryPage";
import { formatRoute, LIBRARY, type Route } from "./route";

const SPACES: { space: Route["space"]; label: string; href: string }[] = [
  { space: "library", label: "Library", href: formatRoute(LIBRARY) },
  { space: "case", label: "Case", href: formatRoute(LIBRARY) },
  { space: "record", label: "Record", href: formatRoute({ space: "record", company: null, tool: null }) },
  { space: "lab", label: "Lab", href: formatRoute({ space: "lab", tool: null, company: null }) },
];

export function NextApp() {
  const [route, navigate] = useRoute();
  const registry = useRegistry();
  const [uploaded, setUploaded] = useState<readonly UploadedCompany[]>([]);
  // Library companies and this session's uploads, one list for lookup and peers.
  const companies = useMemo(
    () => (registry.status === "ready" ? [...registry.companies, ...uploaded.map((u) => u.company)] : []),
    [registry, uploaded],
  );
  // The company a route names — a Case, or the Record/Lab tool's subject.
  const company = useMemo(
    () => (route.space !== "library" && route.company && registry.status === "ready" ? findLibraryCompany(companies, route.company) : null),
    [route, registry, companies],
  );
  const onUpload = (upload: UploadedCompany) => {
    registerUploadedCompany(upload.company, upload.bytes);
    setUploaded((prev) => [...prev.filter((u) => u.company.folder !== upload.company.folder), upload]);
    navigate({ space: "case", company: upload.company.ticker, section: "verdict", asOf: null, scenario: "base" });
  };
  const run = useCompanyRun(company, route.space === "case" ? route.asOf : null);
  const trackRecords = useTrackRecord();
  const snapshots = useSnapshots();
  const tieOut = useTieOut();
  const peers = useMemo(
    () => (company && registry.status === "ready" ? choosePeers(company, companies) : []),
    [company, registry, companies],
  );
  const [peersRequestedFor, setPeersRequestedFor] = useState<string | null>(null);
  const peerRuns = usePeerRuns(peers, route.space === "case" && company != null && peersRequestedFor === company.folder);

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
          <a href="/?ui=classic" className="text-xs text-slate-500 hover:underline">Classic interface</a>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {route.space === "library" && <LibraryPage registry={registry} uploaded={uploaded} onUpload={onUpload} />}
        {route.space === "case" && (
          registry.status === "ready"
            ? (
              <CasePage
                route={route}
                company={company}
                run={run}
                trackRecords={trackRecords}
                snapshots={snapshots}
                tieOut={tieOut}
                peers={peers}
                peerRuns={peerRuns}
                onLoadPeers={() => setPeersRequestedFor(company?.folder ?? null)}
              />
            )
            : <LibraryPage registry={registry} />
        )}
        {(route.space === "record" || route.space === "lab") && (
          registry.status === "ready"
            // A company's tools read the same run as its Case (one per session).
            ? <ToolsPage route={route} companies={companies} company={company} run={run} sessionRegistry={sessionRegistry()} />
            : <LibraryPage registry={registry} />
        )}
      </main>
    </div>
  );
}
