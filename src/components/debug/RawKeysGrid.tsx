/* ── All Base Metric Keys grid ────────────────────────────────────
   Lists `debug.rawMetricKeys`, which `capitalineParser.ts:580-585` builds from
   `periods[0]` alone. `detectedPeriods` is date-ascending (`:482-484`), so that
   is the OLDEST year — the title said "Period 1", and every other surface here
   puts newest first, so a reader reasonably read it as the latest. Name the
   year rather than its index.

   This card stays scoped to that one period on purpose: it documents the field
   the audit snapshot persists. Searching across all periods is the metric
   search panel's job. */

import type { CapitalineParseDebug } from "../../engine/capitalineParser";
import { Card } from "./debugUi";

export function RawKeysGrid({
  debugInfo,
  showAllKeys,
  setShowAllKeys,
  setMetricSearch,
}: {
  debugInfo: CapitalineParseDebug;
  showAllKeys: boolean;
  setShowAllKeys: (value: boolean) => void;
  setMetricSearch: (value: string) => void;
}) {
  const oldest = debugInfo.detectedPeriods[0]?.slice(0, 7);
  const periodCount = debugInfo.detectedPeriods.length;
  const scope = oldest
    ? `${oldest}, oldest of ${periodCount} ${periodCount === 1 ? "period" : "periods"}`
    : "the earliest period";

  return (
    <Card title={`Base Metric Keys in ${scope} (${debugInfo.rawMetricKeys.length} keys)`}>
      <button
        onClick={() => setShowAllKeys(!showAllKeys)}
        className="text-sm text-indigo-600 hover:underline mb-3 block"
      >
        {showAllKeys ? "Hide" : "Show all keys"}
      </button>
      {showAllKeys && (
        <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-lg p-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
            {/* Sort a copy. `Array.prototype.sort` is in-place, and this array
                is the parser's own: `auditSnapshotTransport.ts:66` head-slices
                the same `debug.rawMetricKeys` into the persisted audit
                snapshot. Sorting it here meant whether a reviewer had expanded
                this toggle decided whether that artifact captured the
                alphabetically-first keys or the parse-order-first ones. */}
            {[...debugInfo.rawMetricKeys].sort().map((k, i) => (
              <div
                key={i}
                className="text-xs font-mono text-slate-600 bg-slate-50 px-2 py-1 rounded truncate cursor-pointer hover:bg-indigo-50 hover:text-indigo-700"
                title={k}
                onClick={() => setMetricSearch(k)}
              >
                {k}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
