/* ── Granularity Coverage Checklist panel ─────────────────────────
   Extracted verbatim from DebugPanel.tsx. Export handlers remain owned
   by DebugPanel and are passed as props. No logic changes. */

import type { GranularityChecklistReport } from "../../engine/mappingAudit";
import { Card, StatBox } from "./debugUi";

export function GranularityChecklistPanel({
  granularityChecklist,
  exportChecklistCSV,
  exportChecklistJSON,
}: {
  granularityChecklist: GranularityChecklistReport;
  exportChecklistCSV: () => void;
  exportChecklistJSON: () => void;
}) {
  return (
    <Card title="Granularity Coverage Checklist (10 requested domains)">
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={exportChecklistCSV}
          className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
        >
          Export CSV
        </button>
        <button
          onClick={exportChecklistJSON}
          className="px-3 py-1.5 rounded-md bg-slate-700 text-white text-xs font-medium hover:bg-slate-800"
        >
          Export JSON
        </button>
        <span className="text-xs text-slate-500 self-center">
          Audit trail download includes status, coverage, matched keys, and missing keys.
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatBox label="Pass" value={granularityChecklist.summary.pass} />
        <StatBox label="Partial" value={granularityChecklist.summary.partial} highlight={granularityChecklist.summary.partial > 0} />
        <StatBox label="Fail" value={granularityChecklist.summary.fail} highlight={granularityChecklist.summary.fail > 0} />
      </div>

      <div className="space-y-3">
        {granularityChecklist.items.map((item) => (
          <div key={item.id} className="border border-slate-200 rounded-lg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="font-semibold text-sm text-slate-700">{item.title}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                  coverage {item.coveragePct.toFixed(0)}%
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-semibold ${
                    item.status === "pass"
                      ? "bg-green-100 text-green-700"
                      : item.status === "partial"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-red-100 text-red-700"
                  }`}
                >
                  {item.status.toUpperCase()}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500 mb-2">{item.note}</p>
            <div className="text-xs mb-1 text-slate-600 font-semibold">Mapped keys used ({item.matchedKeys.length})</div>
            {item.matchedKeys.length > 0 ? (
              <div className="flex flex-wrap gap-1 mb-2">
                {item.matchedKeys.slice(0, 18).map((k) => (
                  <span key={k} className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-mono">
                    {k}
                  </span>
                ))}
                {item.matchedKeys.length > 18 && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]">
                    +{item.matchedKeys.length - 18} more
                  </span>
                )}
              </div>
            ) : (
              <div className="text-xs text-red-600 mb-2">No mapped keys found in dataset for this domain.</div>
            )}
            {item.missingKeys.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                  Show missing mapped keys ({item.missingKeys.length})
                </summary>
                <div className="mt-2 max-h-28 overflow-auto space-y-1">
                  {item.missingKeys.map((k) => (
                    <div key={k} className="text-[11px] text-slate-500 font-mono">
                      {k}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
