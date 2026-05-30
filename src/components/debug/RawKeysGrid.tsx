/* ── All Base Metric Keys grid ────────────────────────────────────
   Extracted verbatim from DebugPanel.tsx. No logic changes. */

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
  return (
    <Card title={`All Base Metric Keys in Period 1 (${debugInfo.rawMetricKeys.length} keys)`}>
      <button
        onClick={() => setShowAllKeys(!showAllKeys)}
        className="text-sm text-indigo-600 hover:underline mb-3 block"
      >
        {showAllKeys ? "Hide" : "Show all keys"}
      </button>
      {showAllKeys && (
        <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-lg p-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
            {debugInfo.rawMetricKeys.sort().map((k, i) => (
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
