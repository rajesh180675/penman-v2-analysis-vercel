/* ── Searchable metric-key universe ───────────────────────────────
   Which keys the metric search can find.

   It used to search `debugInfo.rawMetricKeys`, which
   `capitalineParser.ts:580-585` builds from `periods[0]` alone — and periods are
   date-ascending (`:482-484`), so that is the OLDEST year. A key that first
   appears in a later year was unfindable: the box answered "No metric keys
   match" for data sitting in `rawData`. Measured on Bajaj Finance, the search
   reached 75 of 1048 base keys (7%); its oldest period is 2014-03, its newest
   2025-03. Infosys and TCS show no gap at all, so the defect is
   company-dependent — a fixture has to carry periods with differing key sets or
   it pins nothing.

   A union, not "the latest period instead". Reliance has 1105 base keys in its
   oldest year and 1105 in its newest, but 1114 across all of them: nine keys
   exist only in middle years, so neither end is complete.

   `!k.includes("__")` keeps this the same quantity `rawMetricKeys` was — base
   keys, not the `__`-suffixed composites, which are roughly half of all keys
   (Bajaj Finance: 1065 composite, 1048 base, 2113 together). This is also why
   `unionMetricKeyCount` in `parserFidelity.ts` is not reusable here: it omits
   the filter, so it counts a different population than the panel names.

   `capitalineParser.ts:536-539` writes the base-key winners into
   `raw_metric_values` alongside the composites, so these keys resolve against
   the per-period lookup the panel does. */

import type { CapitalineParseDebug } from "../../engine/capitalineParser";
import type { RawPeriodData } from "../../engine/types";

/**
 * Every base metric key the parse produced, in any period, sorted.
 *
 * Sorted because the panel's row window is a head-slice. Set insertion order
 * would put the oldest period's keys first — the ones that were already
 * findable — so a query matching more than the window would keep showing those
 * and still hide the recent-only key the reader came for. Alphabetical order
 * privileges no period.
 *
 * Always a fresh array: `debugInfo.rawMetricKeys` is the parser's own, held in
 * app state and head-sliced into the persisted audit snapshot, so handing it
 * out for a caller to sort is what made a UI toggle rewrite that artifact.
 */
export function searchableBaseKeys(
  rawData: readonly RawPeriodData[] | null | undefined,
  debugInfo: CapitalineParseDebug | null | undefined,
): string[] {
  const keys = new Set<string>();
  for (const period of rawData ?? []) {
    for (const key of Object.keys(period.raw_metric_values ?? {})) {
      if (!key.includes("__")) keys.add(key);
    }
  }
  // Fall back on an empty union, not merely on absent `rawData`. A dataset can
  // carry only `__`-suffixed composites and no base keys at all, and then the
  // filter leaves nothing while `rawData.length` is still truthy — which would
  // make the search report zero matches for every query.
  if (keys.size === 0) return [...(debugInfo?.rawMetricKeys ?? [])].sort();
  return [...keys].sort();
}
