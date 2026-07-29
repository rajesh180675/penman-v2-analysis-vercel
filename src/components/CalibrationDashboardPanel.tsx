import { SignalCalibrationSummary } from "../engine/signalBacktest";
import { capped } from "./cappedList";

/** One row of tiles. The panel also says how many states it left out. */
const STATES_SHOWN = 3;
/** The alert list scrolls, so this can be generous. */
const ALERTS_SHOWN = 10;

interface Props {
  calibration: SignalCalibrationSummary;
  alerts: Array<Record<string, unknown>>;
}

export default function CalibrationDashboardPanel({ calibration, alerts }: Props) {
  // Sorted here rather than trusting the field name. Of the two producers only
  // `calibrateSignalBacktest` sorts by count; `CompanyWorkspace` builds this inline
  // from `Object.entries` over a reduce, which yields first-seen order — and since
  // `runHistory` is sorted newest-first, that is "states ordered by most recent
  // first appearance". Under a field called `stateRankings`, in tiles that show
  // nothing but a state and a count, the top three read as the three most frequent
  // states. A state seen once in last week's run outranked one seen nine times.
  const states = capped(
    [...calibration.stateRankings].sort((left, right) => right.count - left.count),
    STATES_SHOWN,
  );
  // Newest first: the research API sorts each blob listing by `uploadedAt`
  // descending, so the head is the right end to keep here. Note the total is the
  // number of alerts *loaded* — `api/research` pages that listing at 80.
  const shownAlerts = capped(alerts, ALERTS_SHOWN);

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800">Calibration And Alerts</h3>
          <p className="mt-1 text-sm text-slate-500">
            This panel turns the replay engine into an investor workflow. It shows whether the signal ladder is statistically thin or robust, and what alerts have already fired.
          </p>
        </div>
        <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {calibration.calibrationBand}
        </div>
      </div>

      {calibration.stateRankings.length > 0 && (
        <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Signal states ({calibration.stateRankings.length}) · most frequent first
        </div>
      )}
      <div className="mt-2 grid gap-3 md:grid-cols-3">
        {states.shown.map((row) => (
          <div key={row.state} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="text-xs uppercase tracking-wide text-slate-500">{row.state}</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{row.count}</div>
          </div>
        ))}
      </div>
      {states.hidden > 0 && (
        <div className="mt-2 text-xs text-slate-500">
          {states.hidden} less frequent {states.hidden === 1 ? "state is" : "states are"} not shown.
        </div>
      )}

      <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <div><strong>Hit-rate view:</strong> {calibration.hitRateSummary}</div>
        <div><strong>Alert discipline:</strong> {calibration.alertDiscipline}</div>
        <div><strong>Recommendation:</strong> {calibration.recommendation}</div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">
          Persisted alerts ({alerts.length}){alerts.length ? " · newest first" : ""}
        </div>
        <div className="max-h-60 overflow-auto px-4 py-3 text-sm text-slate-700">
          {alerts.length ? (
            <div className="space-y-3">
              {shownAlerts.shown.map((alert, index) => (
                <div key={`${alert.id ?? index}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-slate-900">{String(alert.label ?? alert.state ?? "Alert")}</div>
                    <div className="text-xs text-slate-500">{String(alert.storedAt ?? alert.asOf ?? "—")}</div>
                  </div>
                  <div className="mt-1 text-xs text-slate-600">{String(alert.summary ?? "No alert summary stored.")}</div>
                </div>
              ))}
              {shownAlerts.hidden > 0 && (
                <div className="text-xs text-slate-500">
                  {shownAlerts.hidden} older {shownAlerts.hidden === 1 ? "alert is" : "alerts are"} not shown.
                </div>
              )}
            </div>
          ) : (
            <div className="text-slate-500">No persisted alerts yet. A strong signal will create one automatically.</div>
          )}
        </div>
      </div>
    </div>
  );
}
