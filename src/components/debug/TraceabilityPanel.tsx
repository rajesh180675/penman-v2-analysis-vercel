/* ── Traceability Panel — Source key → statement → value ──────────
   Extracted verbatim from DebugPanel.tsx. Export handlers and selection
   state remain owned by DebugPanel and are passed as props. No logic changes. */

import type { TraceMap } from "../../engine/types";
import { Card } from "./debugUi";

export type TraceRecord = {
  period: string;
  line: string;
  statement: string;
  key: string;
  value: number;
  matchType: string;
  note: string;
};

export function TraceabilityPanel({
  trace,
  traceRecords,
  selectedTraceLine,
  setSelectedTraceLine,
  exportTraceCSV,
  exportTraceJSON,
}: {
  trace: TraceMap;
  traceRecords: TraceRecord[];
  selectedTraceLine: string;
  setSelectedTraceLine: (value: string) => void;
  exportTraceCSV: () => void;
  exportTraceJSON: () => void;
}) {
  return (
    <Card title="Traceability Panel — Source key → statement → value">
      <p className="text-xs text-slate-500 mb-3">
        Audit trail for computed lines in selected period. Click a line to inspect exact source metric keys and matched statement.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={exportTraceCSV}
          disabled={traceRecords.length === 0}
          className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Export Trace CSV
        </button>
        <button
          onClick={exportTraceJSON}
          disabled={traceRecords.length === 0}
          className="px-3 py-1.5 rounded-md bg-slate-700 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Export Trace JSON
        </button>
        <span className="text-xs text-slate-500 self-center">
          {traceRecords.length.toLocaleString()} trace rows across all periods.
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-slate-200 rounded-lg p-2 max-h-80 overflow-auto">
          {Object.keys(trace).sort().map((line) => (
            <button
              key={line}
              onClick={() => setSelectedTraceLine(line)}
              className={`w-full text-left px-2 py-1 rounded text-xs font-mono ${
                selectedTraceLine === line ? "bg-indigo-100 text-indigo-800" : "hover:bg-slate-100 text-slate-700"
              }`}
            >
              {line}
            </button>
          ))}
        </div>
        <div className="border border-slate-200 rounded-lg p-3 max-h-80 overflow-auto">
          {selectedTraceLine && trace[selectedTraceLine] ? (
            <div className="space-y-2">
              <div className="font-semibold text-sm text-slate-700">{selectedTraceLine}</div>
              {trace[selectedTraceLine].map((t, i) => (
                <div key={i} className="text-xs border border-slate-100 rounded p-2 bg-slate-50">
                  <div><span className="text-slate-500">statement:</span> <span className="font-mono">{t.statement}</span></div>
                  <div><span className="text-slate-500">key:</span> <span className="font-mono">{t.key}</span></div>
                  <div><span className="text-slate-500">value:</span> <span className="font-mono">{t.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></div>
                  <div><span className="text-slate-500">match:</span> <span className="font-mono">{t.matchType}</span></div>
                  {t.note ? <div className="text-amber-700">{t.note}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-400">Select a line to inspect trace entries.</div>
          )}
        </div>
      </div>
    </Card>
  );
}
