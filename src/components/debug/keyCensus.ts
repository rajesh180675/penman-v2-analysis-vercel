/* ── Parsed key census ────────────────────────────────────────────
   How many distinct metric keys the parse produced.

   The banner and the two head tiles used `debug.metrics.totalCompositeKeys`
   beside `debug.metrics.totalBaseKeys`, and those two count different things:

   - `totalComposite++` (`capitalineParser.ts:517`) sits INSIDE the per-period
     loop opening at `:497`, so it is a sum of key-values over every period.
   - `totalBaseKeys` (`:596`) is `firstPeriodKeys.length` — ONE period's keys,
     and the oldest one, since `detectedPeriods` is date-ascending.

   Rendered side by side, that invited a comparison neither number supports.
   Measured under jsdom:

       company          periods  banner            distinct
       Infosys          15       3600 / 235        240 / 235
       Bajaj Finance    12       11770 / 75        1065 / 1048

   Infosys' 3600 is exactly 15 × 240. Bajaj Finance read as 157:1
   composite-to-base when the true ratio is 1.02:1 — the composite side inflated
   about 11x by the period sum, the base side deflated about 14x by being one old
   period.

   Counted here rather than fixed in the parser because `metrics` is
   fixture-pinned in six specs and persisted through
   `auditSnapshotTransport.ts:60`, so changing those quantities would silently
   rewrite stored audit snapshots.

   Kept separate from `searchableKeys.ts` on purpose: that answers "which keys can
   the search find" and returns names, this answers "how many are there" and
   returns counts. Sharing one pass would tie the search universe to what the
   header happens to want to display. */

import type { CapitalineParseDebug } from "../../engine/capitalineParser";
import type { RawPeriodData } from "../../engine/types";

export interface ParsedKeyCensus {
  /** Distinct `__`-suffixed composite keys across every counted period. */
  compositeKeys: number;
  /** Distinct base metric keys across every counted period. */
  baseKeys: number;
  /**
   * How many periods the counts were measured over. `0` means no parsed periods
   * were available and the numbers came from the parser's own per-period
   * totals — which are not distinct counts, so a caller must not label them as
   * such.
   */
  periodsCounted: number;
}

/**
 * Distinct composite and base key counts over all parsed periods.
 *
 * Both counted from the same pass so they share a basis and can be read against
 * each other, which is the whole point. Keys are counted by presence, matching
 * the parser: a key whose value parsed as `null` was still extracted.
 */
export function parsedKeyCensus(
  rawData: readonly RawPeriodData[] | null | undefined,
  debugInfo: CapitalineParseDebug | null | undefined,
): ParsedKeyCensus {
  const periods = rawData ?? [];
  if (periods.length === 0) {
    return {
      compositeKeys: debugInfo?.metrics.totalCompositeKeys ?? 0,
      baseKeys: debugInfo?.metrics.totalBaseKeys ?? 0,
      periodsCounted: 0,
    };
  }

  const composite = new Set<string>();
  const base = new Set<string>();
  for (const period of periods) {
    for (const key of Object.keys(period.raw_metric_values ?? {})) {
      if (key.includes("__")) composite.add(key);
      else base.add(key);
    }
  }
  return {
    compositeKeys: composite.size,
    baseKeys: base.size,
    periodsCounted: periods.length,
  };
}

/**
 * The one line that tells a reader what basis the two counts share, or warns
 * that they share none.
 *
 * `null` for a single period, where "distinct across all periods" is a vacuous
 * claim that would only add noise.
 */
export function censusBasisNote(census: ParsedKeyCensus): string | null {
  if (census.periodsCounted === 0) {
    // A failed parse shows 0 beside 0. There is no mismatched pair on screen to
    // warn about, and the warning under "Parse failed" is just noise.
    if (census.compositeKeys === 0 && census.baseKeys === 0) return null;
    // Otherwise these are the parser's own totals — the mismatched pair. Say so
    // rather than let the two numbers imply a comparison.
    return "Parser totals: the composite count is summed over periods, the base count is one period's. Not comparable.";
  }
  if (census.periodsCounted === 1) return null;
  return `Distinct keys across all ${census.periodsCounted} periods.`;
}
