/**
 * The Record space's scoreboard: every frozen forecast scored against the
 * results the company filed since, set by set, then the latest set company by
 * company. Scored in the browser from the published snapshots and the tie-out
 * ledger's first filings with the report's own functions
 * (scoreFrozenForecasts), and a test holds it to accountability/frozen-scores.json,
 * so this page and docs/generated/frozen-forecast-scores.md cannot disagree.
 */
import { useMemo } from "react";
import {
  businessChangeNote,
  scoreFrozenForecasts,
  scoresBySet,
  summarizeBands,
  summarizeScores,
  type FiledScore,
  type FrozenScore,
  type FrozenSetScores,
  type FrozenToScore,
} from "../engine/accountability";
import type { TieOutCompany } from "./hooks";
import { formatRoute } from "./route";

const IN_PROGRESS: readonly FiledScore["metric"][] = ["sales-log-error", "core-margin-point-error"];
const MEASURE: Record<FiledScore["metric"], string> = { "sales-log-error": "Sales", "core-margin-point-error": "Core margin", "cni-roe-point-error": "Earnings" };
const UNIT: Record<FiledScore["metric"], string> = { "sales-log-error": "%", "core-margin-point-error": " pts", "cni-roe-point-error": " pts" };
const shown = (metric: FiledScore["metric"], x: number) => `${(x * 100).toFixed(1)}${UNIT[metric]}`;
const signedShown = (metric: FiledScore["metric"], x: number) => `${x >= 0 ? "+" : ""}${shown(metric, x)}`;
const share = (x: number) => `${Math.round(x * 100)}%`;

/** The frozen forecasts scored from the published copies, as score-frozen.ts scores the files. */
export function frozenScoresFrom(snapshots: readonly FrozenToScore[], tieOut: readonly TieOutCompany[]): FrozenScore[] {
  return scoreFrozenForecasts(snapshots, (ticker) => {
    const company = tieOut.find((c) => c.symbol === ticker);
    return company ? { years: company.filedYears ?? [], yearsToDate: company.filedYearsToDate ?? [] } : null;
  });
}

export function RecordScores({ snapshots, tieOut }: { snapshots: readonly FrozenToScore[] | null; tieOut: readonly TieOutCompany[] | null }) {
  const results = useMemo(() => (snapshots && tieOut ? frozenScoresFrom(snapshots, tieOut) : null), [snapshots, tieOut]);
  if (!results) return <p className="text-sm text-slate-500" role="status">Loading the frozen forecasts…</p>;
  const sets = scoresBySet(results);
  const latest = sets.at(-1);
  return (
    <section aria-labelledby="frozen-scores-heading" className="space-y-4">
      <div>
        <h2 id="frozen-scores-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Frozen forecasts, scored against what was filed since
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Each set froze the app&rsquo;s base case for every industrial company on the day it was made, and is never changed.
          Each forecast is scored against the results the company later filed on NSE, as first filed, for the years its data
          never reached: sales as a log error in %, net of itemized excise; core margin as a move from the cutoff year, in points
          of sales, for sets that record that year (2026-10-19 on); earnings as CNI against the owners&rsquo; profit filed, in
          points of the opening year&rsquo;s filed equity. &ldquo;Nothing changes&rdquo; repeats the cutoff year&rsquo;s filed
          figures, and skill is one less the forecast&rsquo;s median error over its median error. The year in progress is scored
          apart and provisionally, from the months filed so far against the same months a year before, and is replaced once the
          year is filed. The same scores are in docs/generated/frozen-forecast-scores.md.
        </p>
      </div>
      {!latest ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">No forecast has been frozen yet.</p>
      ) : (
        <>
          {[...sets].reverse().map((set) => <SetScores key={set.madeAt} set={set} />)}
          <ByCompany madeAt={latest.madeAt} rows={results.filter((r) => r.madeAt === latest.madeAt)} />
        </>
      )}
    </section>
  );
}

function SetScores({ set }: { set: FrozenSetScores }) {
  return (
    <div className="wb-surface overflow-x-auto rounded-xl border p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Frozen {set.madeAt}</h3>
      <p className="mt-1 text-xs text-slate-500">{set.scored} of {set.forecasts} forecasts scored on a filed year.</p>
      {set.final.length > 0 ? (
        <ScoreTables scores={set.final} />
      ) : (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">No year after these forecasts&rsquo; data has been filed yet.</p>
      )}
      {set.provisional.length > 0 && (
        <>
          <p className="mt-3 text-xs font-medium text-slate-600 dark:text-slate-300">
            The year in progress, provisional: projected from {set.provisionalMonths != null ? `${set.provisionalMonths} months filed` : "the months filed, which differ by company"}.
            Earnings are not projected.
          </p>
          <ScoreTables scores={set.provisional} metrics={IN_PROGRESS} />
        </>
      )}
    </div>
  );
}

function ScoreTables({ scores, metrics }: { scores: readonly FiledScore[]; metrics?: readonly FiledScore["metric"][] }) {
  const rows = summarizeScores(scores, metrics).filter((s) => s.n > 0);
  const bands = summarizeBands(scores, metrics)?.filter((b) => b.n > 0) ?? [];
  return (
    <>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-right text-xs text-slate-500">
            <th className="py-1 text-left font-medium">Measure</th>
            <th className="py-1 font-medium">Scored</th>
            <th className="py-1 font-medium">Forecast median error</th>
            <th className="py-1 font-medium">&ldquo;Nothing changes&rdquo; median error</th>
            <th className="py-1 font-medium">Skill</th>
            <th className="py-1 font-medium">Mean bias</th>
            <th className="py-1 font-medium">Closer than &ldquo;nothing changes&rdquo;</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.metric} className="border-t border-slate-100 text-right tabular-nums dark:border-slate-800">
              <th scope="row" className="py-1 text-left font-normal">{MEASURE[s.metric]}</th>
              <td className="py-1">{s.n}</td>
              <td className="py-1">{shown(s.metric, s.model)}</td>
              <td className="py-1">{shown(s.metric, s.randomWalk)}</td>
              <td className="py-1">{Number.isFinite(s.skill) ? `${s.skill >= 0 ? "+" : ""}${(s.skill * 100).toFixed(0)}%` : "not defined"}</td>
              <td className="py-1">{signedShown(s.metric, s.bias)}</td>
              <td className="py-1">{s.closer} of {s.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {bands.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <caption className="text-left text-xs text-slate-500">Where the filed figures fell against the frozen stress and bull cases</caption>
          <thead>
            <tr className="text-right text-xs text-slate-500">
              <th className="py-1 text-left font-medium">Measure</th>
              <th className="py-1 font-medium">Scored</th>
              <th className="py-1 font-medium">Below stress</th>
              <th className="py-1 font-medium">Between</th>
              <th className="py-1 font-medium">Above bull</th>
              <th className="py-1 font-medium">Below panic</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.metric} className="border-t border-slate-100 text-right tabular-nums dark:border-slate-800">
                <th scope="row" className="py-1 text-left font-normal">{MEASURE[b.metric]}</th>
                <td className="py-1">{b.n}</td>
                <td className="py-1">{share(b.below)}</td>
                <td className="py-1">{share(b.within)}</td>
                <td className="py-1">{share(b.above)}</td>
                <td className="py-1">{share(b.belowPanic)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function ByCompany({ madeAt, rows }: { madeAt: string; rows: readonly FrozenScore[] }) {
  return (
    <div className="wb-surface overflow-x-auto rounded-xl border p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Frozen {madeAt}, by company</h3>
      <p className="mt-1 text-xs text-slate-500">
        All {rows.length} forecasts in the set. Each error is signed, the forecast&rsquo;s beside &ldquo;nothing changes&rdquo;.
      </p>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-right text-xs text-slate-500">
            <th className="py-1 text-left font-medium">Company</th>
            <th className="py-1 text-left font-medium">Cutoff</th>
            <th className="py-1 text-left font-medium">Year</th>
            <th className="py-1 font-medium">Sales</th>
            <th className="py-1 font-medium">Nothing changes</th>
            <th className="py-1 font-medium">Core margin</th>
            <th className="py-1 font-medium">Nothing changes</th>
            <th className="py-1 font-medium">Earnings</th>
            <th className="py-1 font-medium">Nothing changes</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r) => {
            const company = (
              <a href={formatRoute({ space: "case", company: r.ticker, section: "forecast", asOf: null, scenario: "base" })} className="text-sky-700 hover:underline dark:text-sky-400">
                {r.ticker}
              </a>
            );
            if (r.skipped || !r.scores.length) {
              return [(
                <tr key={r.ticker} className="border-t border-slate-100 dark:border-slate-800">
                  <th scope="row" className="py-1 text-left font-normal">{company}</th>
                  <td className="py-1">{r.cutoff}</td>
                  <td colSpan={7} className="py-1 text-slate-600 dark:text-slate-300">
                    {r.skipped ? `Not scored: ${r.skipped}.` : "No year after its data has been filed yet."}
                  </td>
                </tr>
              )];
            }
            return [...new Set(r.scores.map((s) => s.periodEnd))].map((year) => {
              const months = r.scores.find((s) => s.periodEnd === year)?.provisional?.months;
              const cells = (metric: FiledScore["metric"]) => {
                const x = r.scores.find((s) => s.periodEnd === year && s.metric === metric);
                return x
                  ? <><td className="py-1">{signedShown(metric, x.model)}</td><td className="py-1">{signedShown(metric, x.randomWalk)}</td></>
                  : <td colSpan={2} className="py-1 text-slate-500">{months ? "not projected" : "not scored"}</td>;
              };
              return (
                <tr key={`${r.ticker}-${year}`} className="border-t border-slate-100 text-right tabular-nums dark:border-slate-800">
                  <th scope="row" className="py-1 text-left font-normal">{company}</th>
                  <td className="py-1 text-left">{r.cutoff}</td>
                  <td className="py-1 text-left">{year}{months ? ` (${months} months filed)` : ""}</td>
                  {cells("sales-log-error")}
                  {cells("core-margin-point-error")}
                  {cells("cni-roe-point-error")}
                </tr>
              );
            }).concat(r.businessChange ? [(
              <tr key={`${r.ticker}-change`} className="border-t border-slate-100 dark:border-slate-800">
                <th scope="row" className="py-1 text-left font-normal">{company}</th>
                <td className="py-1">{r.cutoff}</td>
                <td className="py-1">{r.businessChange.fiscalYearEnd} on</td>
                <td colSpan={6} className="py-1 text-slate-600 dark:text-slate-300">Not scored: {businessChangeNote(r.businessChange)}.</td>
              </tr>
            )] : []);
          })}
        </tbody>
      </table>
    </div>
  );
}
