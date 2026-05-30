/* ── Metric Key Search panel ──────────────────────────────────────
   Extracted verbatim from DebugPanel.tsx. No logic changes. */

import type { CapitalineParseDebug } from "../../engine/capitalineParser";
import { Card } from "./debugUi";

export function MetricSearchPanel({
  debugInfo,
  metricSearch,
  setMetricSearch,
  searchResults,
}: {
  debugInfo: CapitalineParseDebug;
  metricSearch: string;
  setMetricSearch: (value: string) => void;
  searchResults: string[] | null;
}) {
  return (
    <Card title="🔎 Metric Key Search">
      <p className="text-xs text-slate-500 mb-3">
        Search any metric name to see its raw parsed values across all periods.
        Useful for reconciling specific line items.
      </p>
      <input
        value={metricSearch}
        onChange={(e) => setMetricSearch(e.target.value)}
        placeholder="e.g. Finance Cost, Non-Controlling, Total Assets…"
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 mb-3"
      />
      {searchResults && searchResults.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="text-xs font-mono border-collapse w-full">
            <thead>
              <tr className="bg-slate-100">
                <th className="px-2 py-1.5 border text-left text-slate-600 min-w-[300px]">Metric Key</th>
                {debugInfo.detectedPeriods.slice(0, 10).map((p, i) => (
                  <th key={i} className="px-2 py-1.5 border text-right text-slate-600 min-w-[80px]">
                    {p.slice(0, 7)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {searchResults.map((key, ri) => {
                // Find period data from recastData or debugInfo
                return (
                  <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="px-2 py-1.5 border text-slate-700 max-w-xs truncate" title={key}>
                      {key}
                    </td>
                    {/* Show values if we have debug sample data */}
                    {debugInfo.detectedPeriods.slice(0, 10).map((_, pi) => {
                      const sampleRow = debugInfo.sample.firstRows.find(
                        (r) => r.metric === key || r.metric.toLowerCase() === key.toLowerCase()
                      );
                      const val = sampleRow?.values[pi] ?? "—";
                      return (
                        <td key={pi} className="px-2 py-1.5 border text-right text-slate-700">
                          {val ?? <span className="text-slate-300">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {searchResults && searchResults.length === 0 && metricSearch.length >= 2 && (
        <div className="text-sm text-slate-400 text-center py-4">
          No metric keys match "{metricSearch}"
        </div>
      )}
    </Card>
  );
}
