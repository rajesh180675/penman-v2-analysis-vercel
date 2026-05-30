/* ── Raw Grid Dumps (per file — click to expand) ──────────────────
   Extracted verbatim from DebugPanel.tsx. Expansion state remains owned
   by DebugPanel and is passed as props. No logic changes. */

import type { CapitalineParseDebug } from "../../engine/capitalineParser";
import { Card } from "./debugUi";

export function RawGridDumps({
  debugInfo,
  expandedGrid,
  setExpandedGrid,
}: {
  debugInfo: CapitalineParseDebug;
  expandedGrid: string | null;
  setExpandedGrid: (value: string | null) => void;
}) {
  return (
    <Card title="Raw Grid Dumps (per file — click to expand)">
      <p className="text-xs text-slate-500 mb-3">
        First 30 rows after cleaning Angular template residue.
        Yellow row = detected year header. C0 = metric name, C1+ = period values.
      </p>
      <div className="space-y-3">
        {debugInfo.rawGrids.map((gd, i) => (
          <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedGrid(expandedGrid === gd.file ? null : gd.file)}
              className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100 flex flex-wrap justify-between items-center text-left gap-2"
            >
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-700 text-sm">{gd.file}</span>
                <span className="text-xs text-slate-400">
                  {gd.rowCount}r × {gd.colCount}c | best: {gd.bestMethod}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {gd.methods.map((m, j) => (
                  <span key={j} className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded font-mono">{m}</span>
                ))}
                {gd.headerDetected ? (
                  <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                    ✓ header@row{gd.headerRowIndex}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded font-bold">✗ NO HEADER</span>
                )}
                <span className="text-slate-400 text-xs">{expandedGrid === gd.file ? "▲" : "▼"}</span>
              </div>
            </button>

            {expandedGrid === gd.file && (
              <div className="p-4 space-y-4 bg-white">
                {gd.errors.length > 0 && (
                  <div className="text-xs text-red-600 bg-red-50 p-3 rounded-lg space-y-1">
                    <div className="font-semibold">Parse errors:</div>
                    {gd.errors.map((e, j) => <div key={j}>• {e}</div>)}
                  </div>
                )}
                {gd.headerDetected && gd.periodLabels && (
                  <div>
                    <div className="text-xs font-semibold text-slate-500 mb-2">
                      Period columns detected ({gd.periodLabels.length}):
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {gd.periodLabels.map((l, j) => (
                        <span key={j} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs font-mono">{l}</span>
                      ))}
                    </div>
                  </div>
                )}
                {gd.firstRows.length === 0 ? (
                  <div className="text-sm text-red-500 font-medium py-8 text-center border-2 border-dashed border-red-200 rounded-lg">
                    ⚠ Grid is EMPTY — all parse strategies returned 0 rows.
                  </div>
                ) : (
                  <>
                    <div className="text-xs font-semibold text-slate-500 mb-1">First {gd.firstRows.length} rows:</div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="text-xs font-mono border-collapse min-w-full">
                        <thead>
                          <tr className="bg-slate-100">
                            <th className="px-2 py-1 border border-slate-200 text-slate-400 w-8">#</th>
                            {(gd.firstRows[0] ?? []).slice(0, 12).map((_c, ci) => (
                              <th key={ci} className="px-2 py-1 border border-slate-200 text-slate-500 min-w-[90px]">C{ci}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {gd.firstRows.map((row, ri) => (
                            <tr
                              key={ri}
                              className={ri === gd.headerRowIndex ? "bg-yellow-100 font-bold" : ri % 2 === 0 ? "bg-white" : "bg-slate-50"}
                            >
                              <td className="px-2 py-1 border border-slate-200 text-slate-300 text-center">{ri}</td>
                              {row.slice(0, 12).map((cell, ci) => (
                                <td
                                  key={ci}
                                  className={`px-2 py-1 border border-slate-200 max-w-[120px] truncate ${ci === 0 ? "text-left" : "text-right"}`}
                                  title={cell}
                                >
                                  {cell || <span className="text-slate-200">·</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-slate-400">Hover cells to see full content.</p>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
