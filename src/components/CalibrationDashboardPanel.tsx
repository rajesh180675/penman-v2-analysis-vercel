import { SignalCalibrationSummary } from "../engine/signalBacktest";

interface Props {
  calibration: SignalCalibrationSummary;
  alerts: Array<Record<string, unknown>>;
}

export default function CalibrationDashboardPanel({ calibration, alerts }: Props) {
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

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {calibration.stateRankings.slice(0, 3).map((row) => (
          <div key={row.state} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="text-xs uppercase tracking-wide text-slate-500">{row.state}</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{row.count}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <div><strong>Hit-rate view:</strong> {calibration.hitRateSummary}</div>
        <div><strong>Alert discipline:</strong> {calibration.alertDiscipline}</div>
        <div><strong>Recommendation:</strong> {calibration.recommendation}</div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">Persisted alerts</div>
        <div className="max-h-60 overflow-auto px-4 py-3 text-sm text-slate-700">
          {alerts.length ? (
            <div className="space-y-3">
              {alerts.slice(0, 10).map((alert, index) => (
                <div key={`${alert.id ?? index}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-slate-900">{String(alert.label ?? alert.state ?? "Alert")}</div>
                    <div className="text-xs text-slate-500">{String(alert.storedAt ?? alert.asOf ?? "—")}</div>
                  </div>
                  <div className="mt-1 text-xs text-slate-600">{String(alert.summary ?? "No alert summary stored.")}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-500">No persisted alerts yet. A strong signal will create one automatically.</div>
          )}
        </div>
      </div>
    </div>
  );
}
