/**
 * Case §2 — Business & economics: the reformulated statements and the
 * RNOA drivers as one table, every number opening its lineage.
 */
import { useMemo, useState } from "react";
import type { RecastPeriod } from "../../engine/types";
import { crore, percent } from "../format";
import { BALANCE_LINES, INCOME_LINES, RATIOS, resolveLineage, type LineageTarget } from "../lineage";
import { LineageDrawer } from "../ui/LineageDrawer";

/** Years shown; the rest are named, not hidden silently. */
export const ECONOMICS_YEARS = 6;

export function EconomicsSection({ periods }: { periods: readonly RecastPeriod[] }) {
  const [target, setTarget] = useState<LineageTarget | null>(null);
  const first = Math.max(0, periods.length - ECONOMICS_YEARS);
  const shown = periods.slice(first).map((period, i) => ({ period, index: first + i }));
  const lineage = useMemo(() => (target ? resolveLineage(periods, target) : null), [periods, target]);

  if (periods.length === 0) {
    return <p className="text-sm text-slate-500">The run produced no recast periods.</p>;
  }

  const cell = (t: LineageTarget, text: string | null, label: string) => (
    <td className="px-2 py-1 text-right tabular-nums">
      {text == null ? (
        <span className="text-xs text-slate-500 dark:text-slate-400" title="Not reported for this year">n/a</span>
      ) : (
        <button
          type="button"
          onClick={() => setTarget(t)}
          aria-label={`${label}, ${periods[t.period]!.period_end}: ${text} — show where it comes from`}
          className={`rounded px-1 hover:bg-sky-50 hover:text-sky-800 dark:hover:bg-slate-800 ${target && target.kind === t.kind && target.id === t.id && target.period === t.period ? "bg-sky-100 dark:bg-slate-700" : ""}`}
        >
          {text}
        </button>
      )}
    </td>
  );

  const group = (title: string, rows: { id: string; label: string; text: (p: RecastPeriod) => string | null; kind: "line" | "ratio" }[]) => (
    <>
      <tr>
        <th colSpan={shown.length + 1} className="pt-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</th>
      </tr>
      {rows.map((row) => (
        <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
          <th scope="row" className="py-1 pr-3 text-left font-normal text-slate-700 dark:text-slate-300">{row.label}</th>
          {shown.map(({ period, index }) => cell({ kind: row.kind, id: row.id, period: index }, row.text(period), row.label))}
        </tr>
      ))}
    </>
  );

  const flagged = shown.filter(({ period }) => (period.spec_flags ?? []).length > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <div className="wb-surface overflow-x-auto rounded-xl border p-4 shadow-sm">
          <p className="mb-2 text-xs text-slate-500">
            ₹ crore unless a percentage. Showing the latest {shown.length} of {periods.length} years. Select any number to see where it comes from.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left text-xs font-medium text-slate-500">Year ending</th>
                {shown.map(({ period }) => (
                  <th key={period.period_end} scope="col" className="px-2 text-right text-xs font-medium text-slate-500">{period.period_end}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group("Income", INCOME_LINES.map((l) => ({ id: l.id, label: l.label, kind: "line", text: (p) => crore(l.value(p)) })))}
              {group("Balance sheet", BALANCE_LINES.map((l) => ({ id: l.id, label: l.label, kind: "line", text: (p) => crore(l.value(p)) })))}
              {group("Drivers", RATIOS.map((r) => ({ id: r.id, label: r.label, kind: "ratio", text: (p) => percent(r.value(p)) })))}
            </tbody>
          </table>
        </div>

        <div className="wb-surface rounded-xl border p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Pattern breaks</h2>
          {flagged.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No anomaly flags in the years shown.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {flagged.map(({ period }) => (
                <li key={period.period_end}>
                  <span className="font-medium">{period.period_end}</span>
                  <span className="text-slate-500">: </span>
                  {(period.spec_flags ?? []).map((f) => `${f.spec_id} ${f.label}`).join(" · ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        {lineage ? (
          <LineageDrawer
            lineage={lineage}
            asPercent={target?.kind === "ratio"}
            onNavigate={setTarget}
            onClose={() => setTarget(null)}
          />
        ) : (
          <p className="text-xs text-slate-500">Select a number to see its source rows and formula.</p>
        )}
      </div>
    </div>
  );
}
