/* ── Metric Key Search panel ──────────────────────────────────────
   Values are read from the parsed periods by (key, period_end).

   They used to be read from `debugInfo.sample.firstRows[].values[pi]`
   against a header row built from `debugInfo.detectedPeriods`, and
   those two are oppositely ordered: `capitalineParser` sorts
   `detectedPeriods` date-ascending, while each `values` array is in
   source grid-column order, which every bundled Capitaline export
   writes newest-first. So column index 0 meant FY2012 in the header
   and FY2026 in the body — every number sat under the wrong year.

   Indexing could not be repaired, only abandoned: `values` width
   varies row to row within one table (each source file contributes
   its own column count), so no single index-to-period mapping is
   correct for every row. And `sample.firstRows` is a 40-row
   header-proximity dump, so most searchable keys had no row at all
   and rendered a full line of dashes — indistinguishable from a key
   that parsed as empty. Keyed lookup is exact, order-independent,
   and covers every key. */

import type { RawPeriodData } from "../../engine/types";
import { capped } from "../cappedList";
import { Card } from "./debugUi";

/** Period columns. Newest first, since that is the end a reader checks. */
const PERIODS_SHOWN = 10;

/** Matching keys rendered as rows. Read by the caller that does the slicing. */
export const SEARCH_ROWS_SHOWN = 30;

export interface MetricSearchResults {
  /** The keys rendered as rows. */
  shown: string[];
  /** How many keys matched the query, before the row cap. */
  total: number;
}

function formatValue(value: number) {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/**
 * What basis the numbers are on. Three cases, not two: the parser scales to
 * ₹ Crores from a recognised unit, but on `"Unknown"` it passes values through
 * unscaled (`capitalineParser` raises its own warning saying so), and claiming
 * Crores there would be a false claim about the one thing this panel is for.
 * Absent means Crores by the documented convention for legacy fixtures.
 */
function unitNote(unit: RawPeriodData["currency_unit"]) {
  if (unit === "Unknown") {
    return "The source unit was not recognised, so these values are unscaled — not necessarily ₹ Crores.";
  }
  if (unit && unit !== "Crores") {
    return `Values are ₹ Crores, scaled by the parser from ${unit} in the source file.`;
  }
  return "Values are ₹ Crores.";
}

export function MetricSearchPanel({
  rawData,
  metricSearch,
  setMetricSearch,
  searchResults,
}: {
  rawData?: readonly RawPeriodData[] | null | undefined;
  metricSearch: string;
  setMetricSearch: (value: string) => void;
  searchResults: MetricSearchResults | null;
}) {
  // Sorted here rather than trusting the input: `capitalineParser` emits
  // periods date-ascending, so the head of an unsorted list is the oldest year
  // and a head-slice would drop the latest ones — the years being reconciled.
  const periods = capped(
    [...(rawData ?? [])].sort((left, right) => right.period_end.localeCompare(left.period_end)),
    PERIODS_SHOWN,
  );
  const hiddenRows = searchResults ? searchResults.total - searchResults.shown.length : 0;
  // Stated because the basis changed with the source. The old cells were raw
  // grid text; these are `raw_metric_values`, which the parser has already
  // scaled to ₹ Crores. A reviewer holding the .xls open next to this panel
  // needs to know when the two disagree by a multiplier. `currency_unit` is
  // one dominant value applied to every period, so period 0 speaks for all.
  const sourceUnit = periods.shown[0]?.currency_unit;

  return (
    <Card title="🔎 Metric Key Search">
      <p className="text-xs text-slate-500 mb-3">
        Search any metric name to see its parsed values across all periods.
        Useful for reconciling specific line items.
        {periods.shown.length > 0 ? ` ${unitNote(sourceUnit)}` : ""}
      </p>
      <input
        value={metricSearch}
        onChange={(e) => setMetricSearch(e.target.value)}
        placeholder="e.g. Finance Cost, Non-Controlling, Total Assets…"
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 mb-3"
      />
      {searchResults && searchResults.total > 0 && periods.shown.length > 0 && (
        <>
          <div className="text-xs text-slate-500 mb-2">
            {hiddenRows > 0
              ? `Showing ${searchResults.shown.length} of ${searchResults.total} matching keys`
              : `${searchResults.total} matching ${searchResults.total === 1 ? "key" : "keys"}`}
            {" · "}
            {periods.hidden > 0
              ? `${periods.shown.length} of ${periods.shown.length + periods.hidden} periods, newest first`
              : `all ${periods.shown.length} periods, newest first`}
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="text-xs font-mono border-collapse w-full">
              <thead>
                <tr className="bg-slate-100">
                  <th className="px-2 py-1.5 border text-left text-slate-600 min-w-[300px]">Metric Key</th>
                  {periods.shown.map((period) => (
                    <th
                      key={period.period_end}
                      className="px-2 py-1.5 border text-right text-slate-600 min-w-[80px]"
                    >
                      {period.period_end.slice(0, 7)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {searchResults.shown.map((key, ri) => (
                  <tr key={key} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="px-2 py-1.5 border text-slate-700 max-w-xs truncate" title={key}>
                      {key}
                    </td>
                    {periods.shown.map((period) => {
                      const value = period.raw_metric_values[key];
                      return (
                        <td
                          key={period.period_end}
                          className="px-2 py-1.5 border text-right text-slate-700"
                        >
                          {/* Three distinct states, kept distinct: a number, a
                              key that parsed as null, and a key absent from
                              this period — the last usually means the source
                              label changed that year. */}
                          {typeof value === "number" ? (
                            formatValue(value)
                          ) : value === null ? (
                            <span className="text-slate-400" title="Parsed as null">—</span>
                          ) : (
                            <span className="text-slate-300" title="Key not present in this period">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {searchResults && searchResults.total > 0 && periods.shown.length === 0 && (
        <div className="text-sm text-slate-400 text-center py-4">
          {searchResults.total} matching {searchResults.total === 1 ? "key" : "keys"}, but no parsed
          periods are loaded to show values from.
        </div>
      )}
      {searchResults && searchResults.total === 0 && metricSearch.length >= 2 && (
        <div className="text-sm text-slate-400 text-center py-4">
          No metric keys match &quot;{metricSearch}&quot;
        </div>
      )}
    </Card>
  );
}
