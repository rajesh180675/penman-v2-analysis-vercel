import type { EngineConfig, RecastPeriod } from "../types";
import { restampDerived } from "./restamp";

/**
 * The longest a financial year can run: a company changing its year end may
 * take a transition year of up to 15 months (Companies Act 2013, s. 2(41)). A
 * longer gap between two year ends is missing years, not a long year (Paytm's
 * export jumps FY16 → FY19), so it is read as an ordinary 12-month year.
 */
export const MAX_TRANSITION_MONTHS = 15;

const MONTH_MS = 30.44 * 86_400_000;

/**
 * Months each period covers, from the gap to the previous year end. The export
 * states no period length (Capitaline's headers are YYYYMM only), so the gap is
 * the evidence: Nestlé India's 2022-12 → 2024-03 is its 15-month transition to
 * a March year end. The first period, and a gap no transition year can span,
 * are read as 12 months.
 */
export function periodMonths(periods: readonly { readonly period_end: string }[]): Map<string, number> {
  const ends = [...periods].map((p) => p.period_end).sort();
  return new Map(ends.map((end, i) => {
    if (i === 0) return [end, 12];
    const months = Math.round((Date.parse(end) - Date.parse(ends[i - 1]!)) / MONTH_MS);
    return [end, months >= 1 && months <= MAX_TRANSITION_MONTHS ? months : 12];
  }));
}

/** The rates and counts in a flow statement that are not themselves flows. */
const NOT_FLOWS = new Set(["taxRate", "FinanceIncomeRung", "coverageRatio", "driverRatios"]);

function scaleFlows<T extends object>(statement: T, factor: number): T {
  const scaled: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(statement)) {
    if (NOT_FLOWS.has(key)) scaled[key] = value;
    else if (typeof value === "number") scaled[key] = value * factor;
    else if (value != null && typeof value === "object" && !Array.isArray(value)) scaled[key] = scaleFlows(value, factor);
    else scaled[key] = value;
  }
  return scaled as T;
}

/**
 * Periods whose flows cover a year other than twelve months, restated to a
 * twelve-month rate: every income-statement, core/unusual and cash-flow flow
 * times 12/months, the balance sheet as filed. Growth, turnover, margins and
 * returns are then measured year on year. Nestlé India's 15-month FY2024 read
 * as +44% sales growth and then −17% into FY25 (12 months against 15), and the
 * forecast blended that −17% into its year-one growth; restated, FY25 grew
 * 3.5%. The period and its successor (whose growth is measured against it)
 * are re-stamped; the filed recast, its statements and reconciliation are
 * untouched.
 */
export function annualizePeriods(
  periods: readonly RecastPeriod[],
  months: ReadonlyMap<string, number>,
  config: EngineConfig,
): { readonly periods: RecastPeriod[]; readonly annualized: readonly { readonly periodEnd: string; readonly months: number }[] } {
  const annualized = periods.flatMap((p) => {
    const m = months.get(p.period_end) ?? 12;
    return m !== 12 ? [{ periodEnd: p.period_end, months: m }] : [];
  });
  if (annualized.length === 0) return { periods: [...periods], annualized };
  const out = periods.map((period) => {
    const m = months.get(period.period_end) ?? 12;
    if (m === 12) return period;
    const factor = 12 / m;
    return { ...period, is: scaleFlows(period.is, factor), cu: scaleFlows(period.cu, factor), cf: scaleFlows(period.cf, factor) };
  });
  const touched = new Set(annualized.map((a) => a.periodEnd));
  for (let i = 0; i < out.length; i += 1) {
    const restate = touched.has(out[i]!.period_end) || (i > 0 && touched.has(out[i - 1]!.period_end));
    if (!restate) continue;
    if (out[i] === periods[i]) out[i] = { ...out[i]! };
    restampDerived(out[i]!, i > 0 ? out[i - 1]! : null, config);
  }
  return { periods: out, annualized };
}
