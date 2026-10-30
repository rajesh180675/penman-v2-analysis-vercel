/**
 * The recast's input, rebuilt from a run's canonical facts.
 *
 * The recast reads its periods' lines by name, and the fact set holds a fact
 * for every line it can read (recastLineCatalog.ts). This rebuilds each
 * period's `raw_metric_values` from those facts alone, so the recast consumes
 * canonical data rather than the parse (migration plan §8.4). It is the
 * recast's input only: the quality gate, the mapping audit, parser fidelity
 * and the unusual-item screen list or count every label in a parse, and keep
 * reading the parse itself.
 *
 * Each line's statement-tagged key ("Total Assets__BalanceSheet") carries its
 * fact's value. The parser also writes each label's bare key ("Total
 * Assets"), from the statement it ranks first among those that filed the
 * label (balance sheet, then profit and loss, then cash flow), even when that
 * statement's cell is empty. The bare key follows the same statement here, so
 * an empty balance-sheet cell leaves it empty rather than falling through to a
 * cash-flow value: the bank pipeline reads "Investments" by its bare key, and
 * filling it from the cash-flow line moved seven runs (measured 2026-10-29).
 * Which statements filed a label is read from the parse's keys; every value is
 * read from the facts.
 *
 * A source whose labels carry no statement (Screener, XBRL, manual entry)
 * writes a line under its bare label only, and its fact is recorded on that
 * label, so the line comes back under it.
 */
import type { RawPeriodData } from "../types";
import type { FactSet } from "./contracts";
import { isRecastLine } from "./recastLineCatalog";
import { RECAST_LINE_CONCEPT_PREFIX } from "./sourceAdapters";

/** The parser's ranking of a label's statements for its bare key (capitalineParser.ts). */
const STATEMENT_PRECEDENCE: Readonly<Record<string, number>> = { BalanceSheet: 3, ProfitLoss: 2, CashFlow: 1 };

/**
 * Whether periods rebuilt from these facts can stand in for this parse: every
 * recast line the parse carries a finite value for, under its statement-tagged
 * key or (where the parse tags it nowhere) its bare label, has a recast-line
 * fact in that period. A projection would drop a line without one. A
 * Capitaline parse tags every line and writes its bare key from the tagged
 * ones; a Screener, XBRL or manual upload writes bare labels only, which the
 * text bundle maps on an inferred statement (sourceAdapters.ts); a bundle a
 * caller assembles may map neither.
 */
export function canProjectRecastPeriods(factSet: FactSet, parsedPeriods: readonly RawPeriodData[]): boolean {
  const factLabels = new Map<string, Set<string>>();
  for (const fact of factSet.facts) {
    if (!fact.conceptId.startsWith(RECAST_LINE_CONCEPT_PREFIX)) continue;
    const labels = factLabels.get(fact.period.end) ?? new Set<string>();
    labels.add(fact.rawLabel);
    factLabels.set(fact.period.end, labels);
  }
  return parsedPeriods.every((period) => {
    const values = period.raw_metric_values ?? {};
    const held = factLabels.get(period.period_end) ?? new Set<string>();
    const tagged = new Set<string>();
    for (const key of Object.keys(values)) {
      const separator = key.indexOf("__");
      if (separator >= 0) tagged.add(key.slice(0, separator));
    }
    return Object.entries(values).every(([key, value]) => {
      if (value == null || !Number.isFinite(value)) return true;
      const separator = key.indexOf("__");
      const read = separator >= 0
        ? STATEMENT_PRECEDENCE[key.slice(separator + 2)] != null && isRecastLine(key.slice(0, separator))
        : !tagged.has(key) && isRecastLine(key);
      return !read || held.has(key);
    });
  });
}

/**
 * Each parsed period, its values rebuilt from the fact set's recast-line facts.
 * Periods keep their order and every field but `raw_metric_values`; a period
 * the set holds no line for gets none.
 */
export function projectRecastPeriods(
  factSet: FactSet,
  parsedPeriods: readonly RawPeriodData[],
): RawPeriodData[] {
  const valuesByPeriod = new Map<string, Record<string, number>>();
  for (const fact of factSet.facts) {
    if (!fact.conceptId.startsWith(RECAST_LINE_CONCEPT_PREFIX) || fact.value.kind !== "numeric") continue;
    const values = valuesByPeriod.get(fact.period.end) ?? {};
    values[fact.rawLabel] = Number(fact.value.decimal);
    valuesByPeriod.set(fact.period.end, values);
  }
  return parsedPeriods.map((period) => {
    const composite = valuesByPeriod.get(period.period_end) ?? {};
    const filedStatement = new Map<string, { rank: number; key: string }>();
    for (const parsedKey of Object.keys(period.raw_metric_values ?? {})) {
      const separator = parsedKey.indexOf("__");
      if (separator < 0) continue;
      const label = parsedKey.slice(0, separator);
      const rank = STATEMENT_PRECEDENCE[parsedKey.slice(separator + 2)] ?? 0;
      const best = filedStatement.get(label);
      if (!best || rank > best.rank) filedStatement.set(label, { rank, key: parsedKey });
    }
    const values: Record<string, number> = { ...composite };
    for (const [label, { key }] of filedStatement) {
      const value = composite[key];
      if (value !== undefined) values[label] = value;
    }
    return { ...period, raw_metric_values: values };
  });
}
