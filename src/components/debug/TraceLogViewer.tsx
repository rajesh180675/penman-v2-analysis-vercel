/* ── Trace Log Viewer (self-contained, own local state) ───────────
   Extracted verbatim from DebugPanel.tsx. No logic changes. */

import { useState, useMemo } from "react";
import { getTraceEvents, getTraceSummary, exportTraceJSON, clearTrace, type TraceCategory, type TraceEvent } from "../../lib/traceLogger";
import { Card } from "./debugUi";

export function TraceLogViewer() {
  const [filter, setFilter] = useState<TraceCategory | "all">("all");
  const [refreshKey, setRefreshKey] = useState(0);

  // Both readers take their data from the trace logger's module-level buffer,
  // not from props or state, so `refreshKey` is an invalidation key rather than
  // a value they read. `handleClear` bumps it after `clearTrace()`; without it
  // the rule's advice would leave the summary and the event list showing the
  // buffer as it stood at mount, i.e. the entries the user just cleared.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const summary = useMemo(() => getTraceSummary(), [refreshKey]);
  const events = useMemo(() => {
    const all = getTraceEvents(filter === "all" ? undefined : { cat: filter });
    return all.slice(-200); // Show last 200 events
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, refreshKey]);

  const handleExport = () => {
    const json = exportTraceJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `penman-trace-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    clearTrace();
    setRefreshKey(k => k + 1);
  };

  const categories: (TraceCategory | "all")[] = [
    "all", "parse", "pipeline", "bank", "valuation", "quality",
    "sidecar", "mapping", "ui", "fetch", "scope", "config", "export",
  ];

  const levelColor = (level?: string) => {
    if (level === "error") return "text-rose-600 dark:text-rose-400";
    if (level === "warn") return "text-amber-600 dark:text-amber-400";
    return "text-slate-600 dark:text-slate-400";
  };

  const catColor = (cat: string) => {
    const colors: Record<string, string> = {
      parse: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
      pipeline: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
      bank: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
      valuation: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
      quality: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
      sidecar: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
      mapping: "bg-slate-100 text-slate-700 dark:bg-slate-700/30 dark:text-slate-300",
      ui: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
      fetch: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
      scope: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
      config: "bg-gray-100 text-gray-700 dark:bg-gray-700/30 dark:text-gray-300",
      export: "bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300",
    };
    return colors[cat] ?? "bg-slate-100 text-slate-700";
  };

  return (
    <Card title="Trace Log">
      {/* Summary bar */}
      <div className="flex items-center gap-4 mb-4 text-xs">
        <span className="font-mono">{summary.totalEvents} events</span>
        {summary.warnings > 0 && (
          <span className="text-amber-600 font-semibold">{summary.warnings} warnings</span>
        )}
        {summary.errors > 0 && (
          <span className="text-rose-600 font-semibold">{summary.errors} errors</span>
        )}
        <span className="text-slate-400">
          Session: {summary.sessionStart ? new Date(summary.sessionStart).toLocaleTimeString() : "—"}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs"
          >
            Refresh
          </button>
          <button
            onClick={handleExport}
            className="px-2 py-1 rounded border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-xs"
          >
            Export JSON
          </button>
          <button
            onClick={handleClear}
            className="px-2 py-1 rounded border border-rose-300 dark:border-rose-600 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30 text-xs"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-1 mb-4">
        {categories.map(cat => {
          const count = cat === "all" ? summary.totalEvents : (summary.categories[cat] ?? 0);
          const isActive = filter === cat;
          return (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                isActive
                  ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200"
              }`}
            >
              {cat} {count > 0 && `(${count})`}
            </button>
          );
        })}
      </div>

      {/* Category breakdown */}
      {Object.keys(summary.categories).length > 0 && (
        <div className="grid grid-cols-4 md:grid-cols-6 gap-2 mb-4">
          {Object.entries(summary.categories)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .map(([cat, count]) => (
              <div key={cat} className={`rounded px-2 py-1 text-[10px] font-mono ${catColor(cat)}`}>
                {cat}: {count as number}
              </div>
            ))}
        </div>
      )}

      {/* Event list */}
      <div className="max-h-[600px] overflow-y-auto border border-slate-200 dark:border-slate-700 rounded">
        <table className="w-full text-[11px] border-collapse font-mono">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="text-left py-1 px-2 w-[70px]">Time</th>
              <th className="text-left py-1 px-2 w-[70px]">Cat</th>
              <th className="text-left py-1 px-2 w-[150px]">Operation</th>
              <th className="text-left py-1 px-2">Data</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center py-8 text-slate-400">
                  No trace events yet. Load a company to start tracing.
                </td>
              </tr>
            )}
            {events.map((evt, idx) => (
              <tr
                key={idx}
                className={`border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                  evt.level === "error" ? "bg-rose-50/50 dark:bg-rose-900/10" :
                  evt.level === "warn" ? "bg-amber-50/50 dark:bg-amber-900/10" : ""
                }`}
              >
                <td className="py-0.5 px-2 text-slate-400 whitespace-nowrap">
                  {new Date(evt.ts).toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </td>
                <td className="py-0.5 px-2">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold ${catColor(evt.cat)}`}>
                    {evt.cat}
                  </span>
                </td>
                <td className={`py-0.5 px-2 font-semibold ${levelColor(evt.level)}`}>
                  {evt.op}
                  {evt.duration_ms != null && (
                    <span className="ml-1 text-slate-400 font-normal">{evt.duration_ms}ms</span>
                  )}
                </td>
                <td className="py-0.5 px-2 text-slate-500 dark:text-slate-400 truncate max-w-[400px]">
                  {evt.msg ?? formatTraceData(evt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function formatTraceData(evt: TraceEvent): string {
  const parts: string[] = [];
  if (evt.input) {
    for (const [k, v] of Object.entries(evt.input)) {
      if (v == null) continue;
      if (typeof v === "number") parts.push(`${k}=${typeof v === "number" && v % 1 !== 0 ? v.toFixed(4) : v}`);
      else if (typeof v === "string") parts.push(`${k}="${v}"`);
      else if (typeof v === "boolean") parts.push(`${k}=${v}`);
      else parts.push(`${k}=${JSON.stringify(v).slice(0, 50)}`);
    }
  }
  if (evt.output) {
    for (const [k, v] of Object.entries(evt.output)) {
      if (v == null) continue;
      if (typeof v === "number") parts.push(`→${k}=${typeof v === "number" && v % 1 !== 0 ? v.toFixed(4) : v}`);
      else if (typeof v === "string") parts.push(`→${k}="${v}"`);
      else if (typeof v === "boolean") parts.push(`→${k}=${v}`);
      else parts.push(`→${k}=${JSON.stringify(v).slice(0, 50)}`);
    }
  }
  return parts.join(" · ");
}
