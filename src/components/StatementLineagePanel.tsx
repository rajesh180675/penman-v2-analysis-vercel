import { StatementLineageSummary } from "../engine/statementLineage";
import { capped } from "./cappedList";
import {
  CANDIDATES_SHOWN,
  SEGMENT_HINTS_SHOWN,
  VERSIONS_SHOWN,
} from "./statementLineageWindow";

interface Props {
  lineage: StatementLineageSummary;
}

export default function StatementLineagePanel({ lineage }: Props) {
  // Newest first. `buildStatementLineage` preserves the parser's ascending period
  // order (`capitalineParser` sorts oldest-first), so taking the head of this list
  // showed the *oldest* six filings of fifteen: Infosys rendered 2012 through 2017
  // and hid every year from 2018 to 2026. On a panel whose stated job is judging
  // whether the loaded statements are clean filings or amended history, and beside
  // a valuation that runs off the latest period, the recent filings are the ones
  // being asked about.
  //
  // Reversed here rather than in the engine because the ascending order is
  // load-bearing there: each version's `restatementSignals` compare against
  // `rows[index - 1]`, so "previous filing" depends on it.
  const versions = capped([...lineage.versions].reverse(), VERSIONS_SHOWN);

  // Same reversal, same reason. HDFC Bank's candidates are 2012, 2020 and 2024 —
  // the two a reviewer would look at first were the two furthest down the list.
  const candidates = capped([...lineage.restatementCandidates].reverse(), CANDIDATES_SHOWN);

  // Not reversed: hints are label-ordered from the latest period, so neither end is
  // newer and there is no better half to keep. Capped here rather than in the engine
  // — `buildStatementLineage` used to `slice(0, 12)` itself, which bound for 6 of the
  // 12 companies sampled (Hindustan Unilever 35 hints, Cholamandalam and HDFC Life 33)
  // and threw away the one fact this render needs, that there were more.
  const hints = capped(lineage.segmentHints, SEGMENT_HINTS_SHOWN);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800">Filing Lineage And Segment Hints</h3>
          <p className="mt-1 text-sm text-slate-500">
            This helps the investor judge whether the loaded statements are clean year-on-year filings, amended history, or disclosures that need segment-aware follow-up.
          </p>
        </div>
        <div className="text-xs text-slate-500">
          A {lineage.filingMix.annual} · Q {lineage.filingMix.quarterly} · TTM {lineage.filingMix.ttm}
          {/* `unknown` was omitted, so the mix silently failed to sum to the filing
              count whenever a period end fell outside the four quarter-end dates
              `deriveFilingKind` recognises. Latent on the bundled data — all 128
              period ends are 03-31 — but the chip reads as a complete breakdown. */}
          {lineage.filingMix.unknown > 0 ? ` · ? ${lineage.filingMix.unknown}` : ""}
        </div>
      </div>

      <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Filings ({lineage.versions.length}) · newest first
      </div>

      <div className="mt-2 space-y-2">
        {versions.shown.map((version) => (
          <div key={version.versionTag} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-slate-900">{version.periodEnd.slice(0, 10)}</div>
              <div className="text-xs uppercase tracking-wide text-slate-500">
                {version.filingKind} · amendment {version.amendmentLikelihood}
              </div>
            </div>
            {version.restatementSignals.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {version.restatementSignals.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 text-xs text-emerald-700">No obvious restatement or scale-break signal was detected for this filing.</div>
            )}
          </div>
        ))}
      </div>

      {versions.hidden > 0 ? (
        <div className="mt-2 text-xs text-slate-500">
          {versions.hidden} earlier {versions.hidden === 1 ? "filing is" : "filings are"} not shown.
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Restatement candidates ({lineage.restatementCandidates.length})
          </div>
          <div className="mt-2 space-y-2 text-sm text-slate-700">
            {candidates.shown.length ? (
              candidates.shown.map((item) => <div key={item}>{item}</div>)
            ) : (
              <div>No major restatement candidate was flagged from the current filing sequence.</div>
            )}
            {candidates.hidden > 0 ? (
              <div className="text-xs text-slate-500">+{candidates.hidden} more not shown.</div>
            ) : null}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Segment hints ({lineage.segmentHints.length})
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-700">
            {hints.shown.length ? (
              hints.shown.map((item) => (
                <span key={`${item.type}:${item.label}`} className="rounded-full border border-slate-300 bg-white px-2 py-1">
                  {item.type}: {item.label}
                </span>
              ))
            ) : (
              <span className="text-sm text-slate-600">No segment-style disclosure labels were detected from the loaded raw statements.</span>
            )}
            {hints.hidden > 0 ? (
              <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">+{hints.hidden} more</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
