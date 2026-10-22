/**
 * The Record space's "what changed": for each pair of consecutive frozen sets,
 * what moved in every company's frozen base case beside its value. Compared in
 * the browser from the published snapshots with the report's own functions
 * (compareSnapshotSets, snapshotChangeCells), and a test holds it to
 * docs/generated/frozen-forecast-changes.md cell for cell.
 */
import { useMemo } from "react";
import {
  compareSnapshotSets,
  LISTED_VALUE_CHANGE,
  SNAPSHOT_CHANGE_COLUMNS,
  snapshotChangeCells,
  type ComparedSnapshot,
  type SnapshotSetChanges,
} from "../engine/accountability";
import { formatRoute } from "./route";

export function RecordChanges({ snapshots }: { snapshots: readonly ComparedSnapshot[] | null }) {
  const pairs = useMemo(() => (snapshots ? compareSnapshotSets(snapshots) : null), [snapshots]);
  if (!pairs) return null;
  return (
    <section aria-labelledby="frozen-changes-heading" className="space-y-4">
      <div>
        <h2 id="frozen-changes-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Frozen forecasts, set to set
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Between two sets the same company&rsquo;s value moves with the engine merged in between, the pinned market inputs
          and, where its anchor moved, the data, all at once. This lists what moved beside the value: the capital costs, and
          the year-one margin (operating income over sales) and turnover (sales over year-end NOA) the forecast starts from.
          It does not attribute the value change to any one of them; a company&rsquo;s Case splits its own run&rsquo;s move
          from the latest set between ke and terminal growth and the rest. The same comparison is in docs/generated/frozen-forecast-changes.md.
        </p>
      </div>
      {pairs.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">Fewer than two frozen sets: nothing to compare yet.</p>
      ) : (
        [...pairs].reverse().map((pair) => <SetPair key={pair.to} pair={pair} />)
      )}
    </section>
  );
}

function SetPair({ pair }: { pair: SnapshotSetChanges }) {
  const unlisted = pair.compared - pair.listed.length;
  return (
    <div className="wb-surface overflow-x-auto rounded-xl border p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{pair.from} → {pair.to}</h3>
      <p className="mt-1 text-xs text-slate-500">
        {pair.compared} companies frozen in both sets. {pair.listed.length} listed; {unlisted} moved by less than{" "}
        {(LISTED_VALUE_CHANGE * 100).toFixed(1)}% with the same anchor and basis.
        {pair.added.length > 0 && <> Frozen only in {pair.to}: {pair.added.join(", ")}.</>}
        {pair.dropped.length > 0 && <> Frozen only in {pair.from}: {pair.dropped.join(", ")}.</>}
        {pair.unrecordedBasis.length > 0 && (
          <> The {pair.unrecordedBasis.join(" and ")} {pair.unrecordedBasis.length > 1 ? "sets record" : "set records"} no
          basis (snapshot schema v1), so a carved lending arm or a change of accounts does not show in this comparison.</>
        )}
      </p>
      {pair.listed.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-right text-xs text-slate-500">
              {SNAPSHOT_CHANGE_COLUMNS.map((column, i) => (
                <th key={column} className={`py-1 font-medium ${i === 0 || i === SNAPSHOT_CHANGE_COLUMNS.length - 1 ? "text-left" : ""}`}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pair.listed.map((change) => {
              const [ticker, ...cells] = snapshotChangeCells(change);
              return (
                <tr key={change.ticker} className="border-t border-slate-100 text-right tabular-nums dark:border-slate-800">
                  <th scope="row" className="py-1 text-left font-normal">
                    <a href={formatRoute({ space: "case", company: change.ticker, section: "forecast", asOf: null, scenario: "base" })} className="text-sky-700 hover:underline dark:text-sky-400">
                      {ticker}
                    </a>
                  </th>
                  {cells.map((cell, i) => (
                    <td key={SNAPSHOT_CHANGE_COLUMNS[i + 1]} className={`py-1 ${i === cells.length - 1 ? "text-left" : ""}`}>{cell}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
