import { StatementLineageSummary } from "../engine/statementLineage";

interface Props {
  lineage: StatementLineageSummary;
}

export default function StatementLineagePanel({ lineage }: Props) {
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
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {lineage.versions.slice(0, 6).map((version) => (
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

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Restatement candidates</div>
          <div className="mt-2 space-y-2 text-sm text-slate-700">
            {lineage.restatementCandidates.length ? (
              lineage.restatementCandidates.slice(0, 4).map((item) => <div key={item}>{item}</div>)
            ) : (
              <div>No major restatement candidate was flagged from the current filing sequence.</div>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Segment hints</div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-700">
            {lineage.segmentHints.length ? (
              lineage.segmentHints.map((item) => (
                <span key={`${item.type}:${item.label}`} className="rounded-full border border-slate-300 bg-white px-2 py-1">
                  {item.type}: {item.label}
                </span>
              ))
            ) : (
              <span className="text-sm text-slate-600">No segment-style disclosure labels were detected from the loaded raw statements.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
