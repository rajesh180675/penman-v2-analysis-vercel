import { EmptyState } from "../components/shared/EmptyState";
import type { LibraryCompany } from "../components/data-entry/companyRegistry";
import type { CompanyRunState } from "./companyRun";
import type { TrackRecordFile } from "./hooks";
import { CASE_SECTIONS, formatRoute, LIBRARY, type CaseRoute, type CaseSection } from "./route";
import type { RecastPeriod } from "../engine/types";
import { EconomicsSection } from "./sections/EconomicsSection";
import { EvidenceSection } from "./sections/EvidenceSection";
import { ForecastSection } from "./sections/ForecastSection";
import { PeersSection } from "./sections/PeersSection";
import { ValuationSection } from "./sections/ValuationSection";
import { VerdictSection } from "./sections/VerdictSection";

const STEP_LABEL = { fetching: "Fetching filings…", parsing: "Reading statements…", analysing: "Running the analysis…" } as const;

export function CasePage({
  route,
  company,
  run,
  trackRecords = null,
  peers = [],
  peerRuns = null,
  onLoadPeers = () => {},
}: {
  route: CaseRoute;
  company: LibraryCompany | null;
  run: CompanyRunState | null;
  trackRecords?: TrackRecordFile | null;
  peers?: readonly LibraryCompany[];
  peerRuns?: ReadonlyMap<string, CompanyRunState> | null;
  onLoadPeers?: () => void;
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
        {run?.status === "ready"
          ? renderSection(route.section, run.result, { trackRecords, company, peers, peerRuns, onLoadPeers })
          : null}
      </section>
    </article>
  );
}

function renderSection(
  section: CaseSection,
  result: Extract<CompanyRunState, { status: "ready" }>["result"],
  context: {
    trackRecords: TrackRecordFile | null;
    company: LibraryCompany;
    peers: readonly LibraryCompany[];
    peerRuns: ReadonlyMap<string, CompanyRunState> | null;
    onLoadPeers: () => void;
  },
) {
  const trackRecord = context.trackRecords?.companies.find((c) => c.ticker === context.company.ticker) ?? null;
  switch (section) {
    case "verdict":
      return <VerdictSection result={result} trackRecord={trackRecord} />;
    case "economics":
      // The run's periods are deeply readonly; the section only reads them.
      return <EconomicsSection periods={(result.materialization.pipelineResult?.periods ?? []) as unknown as readonly RecastPeriod[]} />;
    case "evidence":
      return <EvidenceSection result={result} />;
    case "forecast":
      return <ForecastSection result={result} trackRecord={trackRecord} />;
    case "valuation":
      return <ValuationSection result={result} />;
    case "peers":
      return <PeersSection company={context.company} result={result} peers={context.peers} peerRuns={context.peerRuns} onLoadPeers={context.onLoadPeers} />;
  }
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
