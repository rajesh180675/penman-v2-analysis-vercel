/**
 * Case §4 — Forecast: the base scenario year by year, driver shifts the reader
 * can edit with the value re-computed live along the base card's own path
 * (revalueBase), and the forecast's track record beside the drivers.
 */
import { useMemo, useState } from "react";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import type { CompanyTrackRecord } from "../../engine/accountability";
import { formatPerShare } from "../../engine/valuationCommandCenter";
import { revalueBase, type BaseCaseShifts } from "../../engine/valuationCommandCenter/breakEven";
import { crore, percent } from "../format";
import { Withheld } from "../ui/Withheld";

type RevalueInput = Parameters<typeof revalueBase>[0];

const SHIFTS: { key: keyof BaseCaseShifts; label: string; help: string }[] = [
  { key: "sales_growth", label: "Sales growth", help: "every forecast year, percentage points" },
  { key: "core_sales_pm", label: "Core operating margin", help: "every forecast year, percentage points" },
  { key: "ke", label: "Cost of equity", help: "percentage points; kw follows structurally" },
  { key: "g", label: "Terminal growth", help: "percentage points" },
];

export function ForecastSection({
  result,
  trackRecord = null,
  initialShifts = {},
}: {
  result: LegacyAnalysisRunExecutionResult;
  trackRecord?: CompanyTrackRecord | null;
  /** Shifts in fractions (0.01 = 1pp); for deep links and tests. */
  initialShifts?: BaseCaseShifts;
}) {
  const cc = result.materialization.commandCenter;
  const [shifts, setShifts] = useState<BaseCaseShifts>(initialShifts);
  // The run's command center is deeply readonly; revalueBase only reads it.
  const input = cc as unknown as RevalueInput | null;
  const base = useMemo(() => (input ? revalueBase(input) : null), [input]);
  const edited = useMemo(() => (input ? revalueBase(input, shifts) : null), [input, shifts]);

  if (!cc || !base || !edited) {
    return (
      <Withheld reason={cc
        ? "The run has no base-case forecast."
        : "Financial institutions have no industrial forecast; see the Valuation section."} />
    );
  }

  const changed = SHIFTS.some(({ key }) => (shifts[key] ?? 0) !== 0);
  const difference = edited.value != null && base.value != null && base.value !== 0 ? (edited.value - base.value) / Math.abs(base.value) : null;
  const card = cc.scenarios.find((s) => s.key === "base")!;

  return (
    <div className="space-y-4">
      <div className="wb-surface rounded-xl border p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Change the base case</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SHIFTS.map(({ key, label, help }) => (
            <label key={key} className="text-sm">
              <span className="block font-medium">{label}</span>
              <span className="block text-xs text-slate-500">{help}</span>
              <input
                type="number"
                step={0.5}
                value={((shifts[key] ?? 0) * 100).toString()}
                onChange={(e) => {
                  const pp = Number(e.target.value);
                  setShifts((s) => ({ ...s, [key]: Number.isFinite(pp) ? pp / 100 : 0 }));
                }}
                className="mt-1 w-28 rounded border border-slate-300 bg-white px-2 py-1 text-right dark:border-slate-600 dark:bg-slate-900"
              />
              <span className="ml-1 text-xs text-slate-500">pp</span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-baseline gap-6 text-sm">
          <p>Base case <strong>{formatPerShare(base.value)}</strong></p>
          <p>
            With your changes{" "}
            {edited.value != null
              ? <strong>{formatPerShare(edited.value)}</strong>
              : <Withheld reason={edited.ke - edited.g <= 0.005 || edited.kw - edited.g <= 0.005
                ? "Terminal growth must stay below the discount rates."
                : "The changed case produced no value."} />}
            {difference != null && changed ? <span className="ml-1 text-slate-500">({difference >= 0 ? "+" : ""}{(difference * 100).toFixed(1)}%)</span> : null}
          </p>
          {changed && (
            <button type="button" onClick={() => setShifts({})} className="text-xs text-sky-700 hover:underline dark:text-sky-400">Reset</button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">ke {percent(edited.ke)} · kw {percent(edited.kw)} (derived, read-only) · terminal growth {percent(edited.g)}</p>
      </div>

      <div className="wb-surface overflow-x-auto rounded-xl border p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{changed ? "Your case" : "Base case"}, year by year</h2>
        <p className="mt-1 text-xs text-slate-500">From {cc.anchorPeriod.period_end}. ₹ crore unless a percentage.</p>
        {edited.forecast ? (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-500">
                <th className="py-1 text-left font-medium">Year</th>
                <th className="py-1 font-medium">Sales</th>
                <th className="py-1 font-medium">Growth</th>
                <th className="py-1 font-medium">Core margin</th>
                <th className="py-1 font-medium">Turnover</th>
                <th className="py-1 font-medium">OI</th>
                <th className="py-1 font-medium">NOA</th>
                <th className="py-1 font-medium">CNI</th>
                <th className="py-1 font-medium">CSE</th>
              </tr>
            </thead>
            <tbody>
              {edited.forecast.map((f) => (
                <tr key={f.period_label} className="border-t border-slate-100 text-right tabular-nums dark:border-slate-800">
                  <th scope="row" className="py-1 text-left font-normal">{f.period_label}</th>
                  <td className="py-1">{crore(f.Sales_f)}</td>
                  <td className="py-1">{percent(f.sales_growth_assumption)}</td>
                  <td className="py-1">{percent(f.core_sales_pm_assumption)}</td>
                  <td className="py-1">{f.ato_assumption.toFixed(2)}×</td>
                  <td className="py-1">{crore(f.OI_f)}</td>
                  <td className="py-1">{crore(f.NOA_f)}</td>
                  <td className="py-1">{crore(f.CNI_f)}</td>
                  <td className="py-1">{crore(f.CSE_f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Withheld reason="The changed case could not be forecast." />
        )}
        <p className="mt-2 text-xs text-slate-500">
          Forecast policy: {card.forecastPolicy?.narrative?.[0] ?? "persistence-led fade toward sector anchors."}
        </p>
      </div>

      <TrackRecord record={trackRecord} />
    </div>
  );
}

const TRACK: { metric: keyof CompanyTrackRecord["oneYearAhead"]; label: string }[] = [
  { metric: "sales-log-error", label: "Sales" },
  { metric: "core-oi-margin-error", label: "Operating margin" },
  { metric: "core-rnoa-error", label: "Return on NOA" },
  { metric: "cni-roe-point-error", label: "Earnings (CNI)" },
];

function TrackRecord({ record }: { record: CompanyTrackRecord | null }) {
  return (
    <div className="wb-surface rounded-xl border p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">How this forecast has done</h2>
      <p className="mt-1 text-xs text-slate-500">
        Walk-forward backtest: the same base forecast made at each past year, scored one year ahead against &ldquo;nothing changes&rdquo;.
      </p>
      {record ? (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {TRACK.map(({ metric, label }) => {
            const r = record.oneYearAhead[metric];
            return (
              <li key={metric} className="text-sm">
                <span className="block text-xs text-slate-500">{label}</span>
                {r ? <strong>{r.beatRandomWalk} of {r.scored} years</strong> : <Withheld reason="Not scored for this company." />}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-2"><Withheld reason="No backtest record for this company." /></div>
      )}
    </div>
  );
}
