/**
 * Case §4 — Forecast: the base scenario year by year, driver shifts the reader
 * can edit with the value re-computed live along the base card's own path
 * (revalueBase), the forecast's track record beside the drivers, and the base
 * case set against any of its years the company has filed since.
 */
import { useMemo, useState } from "react";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import { anchorOrBasis, anchorYear, businessChangeNote, compareSnapshots, forecastYears, scoreSnapshotAgainstFilings, yearOneDrivers, type CompanyTrackRecord, type ComparedSnapshot, type FiledScore, type FiledYear, type FiledYearToDate, type ForecastToScore, type SnapshotScenarios } from "../../engine/accountability";
import { buildScenario } from "../../engine/forecastingEngine";
import { formatPerShare } from "../../engine/valuationCommandCenter";
import { revalueBase, type BaseCaseShifts } from "../../engine/valuationCommandCenter/breakEven";
import { crore, percent } from "../format";
import type { RecastPeriod } from "../../engine/types";
import { MARGIN_HISTORY_YEARS, MarginFadeChart, frozenOnSameBasis, marginFadeRows, type FrozenForecast } from "../ui/MarginFadeChart";
import { Withheld } from "../ui/Withheld";
import { valuationDateNote } from "../ui/valuationBasis";

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
  frozen = null,
  frozenSets = [],
  setsMade = 0,
  filedYears = null,
  filedYearsToDate = [],
  accounts = "consolidated",
  asOf = null,
  initialShifts = {},
}: {
  result: LegacyAnalysisRunExecutionResult;
  trackRecord?: CompanyTrackRecord | null;
  /** The company's most recently frozen forecast, drawn beside the current one. */
  frozen?: FrozenForecast | null;
  /** Every forecast frozen for the company, in any order. */
  frozenSets?: readonly ComparedSnapshot[];
  /** How many snapshot sets have been made, for every company. */
  setsMade?: number;
  /** The company's years as first filed (the as-filed ledger); null when the ledger has none. */
  filedYears?: readonly FiledYear[] | null;
  /** The year in progress as first filed, quarter by quarter. */
  filedYearsToDate?: readonly FiledYearToDate[];
  /** The accounts the run analysed. */
  accounts?: "consolidated" | "standalone";
  /** The as-of date of the view, when it is one. */
  asOf?: string | null;
  /** Shifts in fractions (0.01 = 1pp); for deep links and tests. */
  initialShifts?: BaseCaseShifts;
}) {
  const cc = result.materialization.commandCenter;
  const [shifts, setShifts] = useState<BaseCaseShifts>(initialShifts);
  // The run's command center is deeply readonly; revalueBase only reads it.
  const input = cc as unknown as RevalueInput | null;
  const base = useMemo(() => (input ? revalueBase(input) : null), [input]);
  const edited = useMemo(() => (input ? revalueBase(input, shifts) : null), [input, shifts]);
  // The other cases as their cards forecast them, for the band a filed year falls in.
  const scenarios = useMemo((): SnapshotScenarios | undefined => {
    if (!input) return undefined;
    const path = (key: "stress" | "bull" | "historical-panic") => {
      const scenario = input.scenarios.find((s) => s.key === key)?.scenario;
      return scenario ? forecastYears(input.anchorPeriod.period_end, buildScenario(scenario, input.anchorPeriod)) : null;
    };
    const [stress, bull, historicalPanic] = [path("stress"), path("bull"), path("historical-panic")];
    return stress && bull && historicalPanic ? { stress, bull, historicalPanic } : undefined;
  }, [input]);
  // Today's base case re-valued at the latest set's ke and terminal growth
  // (kw follows, S-9.4C), which splits the move since that set in two.
  const atLatestRates = useMemo(() => {
    const latest = [...frozenSets].sort((a, b) => a.madeAt.localeCompare(b.madeAt)).at(-1);
    const card = input?.scenarios.find((s) => s.key === "base");
    if (asOf || !input || !latest || !card) return null;
    const shift = { ke: latest.assumptions.ke - card.assumptions.ke, g: latest.assumptions.g - card.assumptions.g };
    const same = Math.abs(shift.ke) < 1e-9 && Math.abs(shift.g) < 1e-9;
    return { same, value: same ? null : revalueBase(input, shift)?.value ?? null };
  }, [input, frozenSets, asOf]);

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
  const basisNote = valuationDateNote(cc);
  const lendingArm = cc.lendingArm?.status === "applied" ? cc.lendingArm.link.arm.name : null;

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
        {basisNote && <p className="mt-1 text-xs text-slate-500">{basisNote}</p>}
      </div>

      <FadePanel
        // The command center's periods are deeply readonly; the chart only reads them.
        history={cc.basisPeriods as unknown as readonly RecastPeriod[]}
        lendingArm={lendingArm}
        anchorPeriod={cc.anchorPeriod.period_end}
        forecast={edited.forecast ?? []}
        frozen={frozen}
      />

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

      {frozenSets.length > 0 && (
        <FrozenValues
          sets={frozenSets}
          setsMade={setsMade}
          // Today's run only: an as-of view's run is not the one the latest set froze.
          current={!asOf && base.forecast ? {
            ticker: frozenSets[0]!.ticker,
            madeAt: "",
            cutoffPeriod: cc.anchorPeriod.period_end,
            assumptions: card.assumptions,
            intrinsicPerShare: card.intrinsicPerShare ?? null,
            years: forecastYears(cc.anchorPeriod.period_end, base.forecast),
            basis: { accounts, lendingArm },
          } : null}
          atLatestRates={atLatestRates}
        />
      )}

      {filedYears && base.forecast && (
        <AgainstFiled
          forecast={{
            cutoffPeriod: cc.anchorPeriod.period_end,
            latestReportedPeriod: result.materialization.pipelineResult?.periods.at(-1)?.period_end ?? cc.anchorPeriod.period_end,
            basis: { accounts, lendingArm },
            anchor: anchorYear(cc.anchorPeriod),
            years: forecastYears(cc.anchorPeriod.period_end, base.forecast),
            scenarios,
          }}
          filedYears={filedYears}
          filedYearsToDate={filedYearsToDate}
          asOf={asOf}
        />
      )}
    </div>
  );
}

const signed = (x: number, unit: string) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}${unit}`;
/** A score's error as the reader reads it: sales as forecast ÷ filed − 1, margin in points of sales, earnings in ROE points. */
const shownError = (metric: FiledScore["metric"], error: number) =>
  metric === "sales-log-error" ? signed(Math.expm1(error), "%") : signed(error, " pts");
const MEASURE: Record<FiledScore["metric"], string> = { "sales-log-error": "Sales", "core-margin-point-error": "Core margin", "cni-roe-point-error": "Earnings" };
const shownFigure = (metric: FiledScore["metric"], x: number) => (metric === "core-margin-point-error" ? percent(x) : crore(x));
const BAND: Record<NonNullable<FiledScore["band"]>["position"], string> = { below: "Below stress", within: "Between", above: "Above bull" };

/**
 * The base case beside what the company has since filed for the years its
 * data did not reach: the library's Capitaline exports are refreshed by hand,
 * so a case can run a year behind the company's published results (#443), and
 * those results are the forecast's first test. Scored as the frozen-forecast
 * report scores (scoreSnapshotAgainstFilings): first filings, consolidated,
 * only years after the data, and not at all for a business the filings do not
 * describe. The base case, not the reader's edits: a case changed after
 * seeing the outcome would be scored against what it was fitted to.
 */
function AgainstFiled({ forecast, filedYears, filedYearsToDate, asOf }: {
  forecast: ForecastToScore;
  filedYears: readonly FiledYear[];
  filedYearsToDate: readonly FiledYearToDate[];
  asOf: string | null;
}) {
  const { scores, skipped, businessChange } = scoreSnapshotAgainstFilings(forecast, filedYears, filedYearsToDate);
  const years = [...new Set(scores.map((s) => s.periodEnd))];
  return (
    <div className="wb-surface overflow-x-auto rounded-xl border p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Against the results filed since</h2>
      <p className="mt-1 text-xs text-slate-500">
        The base case beside what the company has filed on NSE for the years its data did not reach: consolidated, as first
        reported, ₹ crore. Sales are net of the excise duty a filing itemizes. The core margin is operating income after tax over
        sales, built from the filed lines on the recast&rsquo;s tax rules; the forecast&rsquo;s is {forecast.cutoffPeriod}&rsquo;s filed
        margin moved as the forecast moves its own, so a gap between how Capitaline and the filings measure the level is not
        counted against it. Earnings set forecast CNI against the owners&rsquo;
        profit filed, which includes one-offs the forecast does not model, with errors in points of the opening year&rsquo;s filed
        owners&rsquo; equity. &ldquo;Nothing changes&rdquo; repeats {forecast.cutoffPeriod}&rsquo;s filed figures. The last
        column places the filed figure against the stress and bull cases, compared as the base case is. A year still in
        progress is projected from the months filed so far: the last full year&rsquo;s sales grown as those months grew on the
        same months a year before, and its margin moved as theirs moved. Its earnings are not projected, as a quarter&rsquo;s
        one-offs weigh too much in part of a year.
        {asOf && " In an as-of view the forecast is made from Capitaline's history, which can include restatements filed after that date."}
      </p>
      {skipped ? (
        <div className="mt-2"><Withheld reason={`Not compared: ${skipped}.`} /></div>
      ) : !years.length ? (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Nothing has been filed yet for a year after this case&rsquo;s data, which runs to {forecast.latestReportedPeriod ?? forecast.cutoffPeriod}.
        </p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-right text-xs text-slate-500">
              <th className="py-1 text-left font-medium">Year</th>
              <th className="py-1 text-left font-medium">Measure</th>
              <th className="py-1 font-medium">Forecast</th>
              <th className="py-1 font-medium">Filed</th>
              <th className="py-1 font-medium">Forecast error</th>
              <th className="py-1 font-medium">&ldquo;Nothing changes&rdquo; error</th>
              <th className="py-1 font-medium">Closer</th>
              <th className="py-1 font-medium">Stress to bull</th>
            </tr>
          </thead>
          <tbody>
            {years.flatMap((year) => scores.filter((s) => s.periodEnd === year).map((s) => (
              <tr key={`${year}-${s.metric}`} className="border-t border-slate-100 text-right tabular-nums dark:border-slate-800">
                <th scope="row" className="py-1 text-left font-normal">
                  {year}{s.provisional && <span className="block text-xs text-slate-500">projected from {s.provisional.months} months to {s.provisional.through}</span>}
                </th>
                <td className="py-1 text-left">{MEASURE[s.metric]}</td>
                <td className="py-1">{shownFigure(s.metric, s.forecast)}</td>
                <td className="py-1">{shownFigure(s.metric, s.actual)}</td>
                <td className="py-1">{shownError(s.metric, s.model)}</td>
                <td className="py-1">{shownError(s.metric, s.randomWalk)}</td>
                <td className="py-1">{Math.abs(s.model) < Math.abs(s.randomWalk) ? "Forecast" : "Nothing changes"}</td>
                <td className="py-1">{s.band ? BAND[s.band.position] : "—"}</td>
              </tr>
            )))}
          </tbody>
        </table>
      )}
      {businessChange && !skipped && (
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
          From {businessChange.fiscalYearEnd}, not compared: {businessChangeNote(businessChange)}.
        </p>
      )}
    </div>
  );
}

/**
 * Every forecast frozen for the company, set by set, and this run's base case
 * after the latest (compareSnapshots): the value beside what it was built on.
 * A record of change, not an attribution. Between two sets the value moves with
 * the engine merged in between, the pinned market inputs and, where the anchor
 * moved, the data, all at once, and nothing here re-values one in isolation.
 */
function FrozenValues({ sets, setsMade, current, atLatestRates }: {
  sets: readonly ComparedSnapshot[];
  setsMade: number;
  current: ComparedSnapshot | null;
  /** This run's base case at the latest set's ke and terminal growth; `same` when they are this run's. */
  atLatestRates: { same: boolean; value: number | null } | null;
}) {
  const ordered = [...sets].sort((a, b) => a.madeAt.localeCompare(b.madeAt));
  const latest = ordered.at(-1)!;
  const rows = [...ordered, ...(current ? [current] : [])].map((s, i, all) => ({
    s,
    drivers: yearOneDrivers(s),
    change: i > 0 ? compareSnapshots([all[i - 1]!], [s])[0] ?? null : null,
  }));
  return (
    <div className="wb-surface overflow-x-auto rounded-xl border p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Frozen values, set by set</h2>
      <p className="mt-1 text-xs text-slate-500">
        Frozen in {ordered.length} of the {setsMade} sets made{current && <>, with this run&rsquo;s base case after the latest</>}.
        Each change is from the row above. Between two rows the value moves with the engine changed in between, the pinned
        market inputs and, where the anchor moved, the data, all at once: this records what moved beside it, not why.
        Margin and turnover are the forecast&rsquo;s first year.{current && <> This run&rsquo;s move from the latest set is split below the table.</>}
      </p>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-right text-xs text-slate-500">
            <th className="py-1 text-left font-medium">Frozen</th>
            <th className="py-1 text-left font-medium">Anchor</th>
            <th className="py-1 font-medium">Value per share</th>
            <th className="py-1 font-medium">Change</th>
            <th className="py-1 font-medium">ke</th>
            <th className="py-1 font-medium">kw</th>
            <th className="py-1 font-medium">g</th>
            <th className="py-1 font-medium">Margin</th>
            <th className="py-1 font-medium">Turnover</th>
            <th className="py-1 text-left font-medium">Anchor or basis</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, drivers, change }) => (
            <tr key={s.madeAt || "current"} className="border-t border-slate-100 text-right tabular-nums dark:border-slate-800">
              <th scope="row" className="py-1 text-left font-normal">{s === current ? "This run" : s.madeAt}</th>
              <td className="py-1 text-left">{s.cutoffPeriod}</td>
              <td className="py-1">{formatPerShare(s.intrinsicPerShare)}</td>
              <td className="py-1">{change?.valueChange != null ? signed(change.valueChange, "%") : "—"}</td>
              <td className="py-1">{percent(s.assumptions.ke)}</td>
              <td className="py-1">{percent(s.assumptions.kw)}</td>
              <td className="py-1">{percent(s.assumptions.g)}</td>
              <td className="py-1">{drivers.margin != null ? percent(drivers.margin) : "—"}</td>
              <td className="py-1">{drivers.turnover != null ? `${drivers.turnover.toFixed(2)}×` : "—"}</td>
              <td className="py-1 text-left">{change ? anchorOrBasis(change) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {current && atLatestRates && latest.intrinsicPerShare != null && current.intrinsicPerShare != null && (
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
          {atLatestRates.same
            ? <>This run has the {latest.madeAt} set&rsquo;s ke and terminal growth, so its move from that set is all forecast, data and engine.</>
            : atLatestRates.value == null
              ? <>This run&rsquo;s base case could not be valued at the {latest.madeAt} set&rsquo;s ke and terminal growth.</>
              : <>
                  At the {latest.madeAt} set&rsquo;s ke ({percent(latest.assumptions.ke)}) and terminal growth ({percent(latest.assumptions.g)}),
                  kw following them, this run&rsquo;s base case is worth {formatPerShare(atLatestRates.value)}. So of its move from that
                  set, {signedRupees(atLatestRates.value - latest.intrinsicPerShare)} is the forecast, the data and the engine, and{" "}
                  {signedRupees(current.intrinsicPerShare - atLatestRates.value)} is ke and terminal growth: the forecast first, then the
                  rates on it.
                </>}
        </p>
      )}
    </div>
  );
}

const signedRupees = (x: number) => `${x >= 0 ? "+" : "−"}${formatPerShare(Math.abs(x))}`;

/**
 * The margin fade against history, with the frozen forecast beside it, all of
 * one business: the one the forecast is of. The history was the filed recast,
 * so with a lending arm carved the forecast line fell from the consolidated
 * margin to the carved one in its first year (M&M 12.0% → 7.3%, Grasim 10.9%
 * → 6.7%), a fade that was only a change of basis.
 */
function FadePanel({ history, lendingArm, anchorPeriod, forecast, frozen }: {
  /** The command center's basis periods (oldest first). */
  history: readonly RecastPeriod[];
  /** The lending arm the valuation carved out, if it carved one. */
  lendingArm: string | null;
  anchorPeriod: string;
  forecast: Parameters<typeof marginFadeRows>[2];
  frozen: FrozenForecast | null;
}) {
  const comparable = frozen && frozenOnSameBasis(frozen, lendingArm) ? frozen : null;
  const rows = marginFadeRows(history, anchorPeriod, forecast, comparable);
  return (
    <div className="wb-surface rounded-xl border p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Margin fade</h2>
      <MarginFadeChart
        rows={rows}
        frozenMadeAt={comparable?.madeAt ?? null}
        historyShown={Math.min(MARGIN_HISTORY_YEARS, history.length)}
        historyTotal={history.length}
      />
      {lendingArm && (
        <p className="mt-1 text-xs text-slate-500">
          Without {lendingArm}: the valuation carves the lending arm out, so these margins, reported and forecast, are the rest of the business&rsquo;s, not the consolidated statements&rsquo;.
        </p>
      )}
      {!frozen ? (
        <p className="mt-1 text-xs text-slate-500">No forecast has been frozen for this company yet, so there is no earlier forecast to compare.</p>
      ) : !comparable ? (
        <p className="mt-1 text-xs text-slate-500">
          The forecast frozen on {frozen.madeAt} was of {frozen.basis?.lendingArm ? `the business without ${frozen.basis.lendingArm}` : "the consolidated statements, lending arm included"}, so it is not drawn beside this one.
        </p>
      ) : null}
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
