/**
 * Core operating margin: reported years, the current forecast, and the forecast
 * frozen on an earlier day — one measure, one axis (% of sales). Each forecast
 * line starts at its own anchor year, so it visibly departs from the reported
 * line. Identity is never colour alone: a legend, a dashed frozen line, and a
 * table view (the third palette slot is below 3:1 on the light surface).
 */
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastPeriod, RecastPeriod } from "../../engine/types";
import { percent } from "../format";

export interface FrozenForecast {
  readonly madeAt: string;
  readonly cutoffPeriod: string;
  readonly years: readonly { readonly periodEnd: string; readonly sales: number; readonly operatingIncome: number }[];
}

export interface MarginRow {
  readonly year: number;
  readonly reported: number | null;
  readonly forecast: number | null;
  readonly frozen: number | null;
}

/** Reported years shown; the count shown is stated beside the chart. */
export const MARGIN_HISTORY_YEARS = 8;

const yearOf = (periodEnd: string) => Number(periodEnd.slice(0, 4));
const finite = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : null);

/** Reported core margin: the ratio the forecast drivers are built on. */
function reportedMargin(p: RecastPeriod): number | null {
  return finite(p.ratios?.CoreSalesPM ?? (p.is.Sales > 0 && p.cu ? p.cu.CoreOI / p.is.Sales : null));
}

export function marginFadeRows(
  history: readonly RecastPeriod[],
  anchorPeriod: string,
  forecast: readonly ForecastPeriod[],
  frozen: FrozenForecast | null,
): MarginRow[] {
  const rows = new Map<number, { reported: number | null; forecast: number | null; frozen: number | null }>();
  const row = (year: number) => {
    let r = rows.get(year);
    if (!r) rows.set(year, (r = { reported: null, forecast: null, frozen: null }));
    return r;
  };
  const reportedByYear = new Map(history.map((p) => [yearOf(p.period_end), reportedMargin(p)]));
  for (const p of history.slice(-MARGIN_HISTORY_YEARS)) row(yearOf(p.period_end)).reported = reportedMargin(p);

  const anchorYear = yearOf(anchorPeriod);
  row(anchorYear).forecast = reportedByYear.get(anchorYear) ?? null;
  forecast.forEach((f, i) => { row(anchorYear + i + 1).forecast = finite(f.core_sales_pm_assumption); });

  if (frozen) {
    const cutoffYear = yearOf(frozen.cutoffPeriod);
    if (reportedByYear.has(cutoffYear)) row(cutoffYear).frozen = reportedByYear.get(cutoffYear) ?? null;
    for (const y of frozen.years) row(yearOf(y.periodEnd)).frozen = y.sales > 0 ? finite(y.operatingIncome / y.sales) : null;
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([year, r]) => ({ year, ...r }));
}

// One decimal: margins move within a few points, and whole-percent ticks repeat.
const pctTick = (v: number) => `${(v * 100).toFixed(1)}%`;

export function MarginFadeChart({
  rows,
  frozenMadeAt,
  historyShown,
  historyTotal,
}: {
  rows: readonly MarginRow[];
  frozenMadeAt: string | null;
  historyShown: number;
  historyTotal: number;
}) {
  const series: { key: "reported" | "forecast" | "frozen"; name: string; color: string; dash: string | null }[] = [
    { key: "reported", name: "Reported", color: "var(--series-1)", dash: null },
    { key: "forecast", name: "Current forecast", color: "var(--series-2)", dash: null },
    ...(frozenMadeAt ? [{ key: "frozen" as const, name: `Forecast frozen ${frozenMadeAt}`, color: "var(--series-3)", dash: "6 4" }] : []),
  ];

  return (
    <figure className="viz-series" aria-label="Core operating margin, reported and forecast, % of sales">
      <figcaption className="text-xs text-slate-500 dark:text-slate-400">
        Core operating margin, % of sales — latest {historyShown} of {historyTotal} reported years, then the forecasts.
      </figcaption>
      <div className="mt-2 h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={[...rows]} margin={{ top: 8, right: 28, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeWidth={1} />
            <XAxis dataKey="year" tickFormatter={(y: number) => `FY${String(y).slice(2)}`} tick={{ fill: "var(--viz-ink)", fontSize: 11 }} stroke="var(--viz-grid)" />
            <YAxis tickFormatter={pctTick} tick={{ fill: "var(--viz-ink)", fontSize: 11 }} stroke="var(--viz-grid)" width={48} domain={["auto", "auto"]} />
            <Tooltip
              formatter={(value: number | undefined, name: string | undefined) => [percent(value) ?? "not reported", name ?? ""]}
              labelFormatter={(y) => `Year ending ${String(y)}`}
              // Text wears text colour; the series name carries identity.
              itemStyle={{ color: "var(--viz-ink)" }}
              separator=": "
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--viz-ink)" }} itemSorter={(item) => series.findIndex((s) => s.key === item.dataKey)} />
            {series.map((s) => (
              <Line
                key={s.key}
                // Straight segments: annual points, nothing measured between them.
                type="linear"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                {...(s.dash ? { strokeDasharray: s.dash } : {})}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={{ r: 4, fill: s.color, stroke: "var(--viz-surface)", strokeWidth: 2 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-slate-600 dark:text-slate-300">Show as a table</summary>
        <table className="mt-2 w-full">
          <thead>
            <tr className="text-right text-slate-500">
              <th className="py-1 text-left font-medium">Year ending</th>
              {series.map((s) => <th key={s.key} className="py-1 font-medium">{s.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} className="border-t border-slate-100 text-right tabular-nums dark:border-slate-800">
                <th scope="row" className="py-1 text-left font-normal">{r.year}</th>
                {series.map((s) => <td key={s.key} className="py-1">{percent(r[s.key]) ?? ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
