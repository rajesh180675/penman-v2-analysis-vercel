import { buildValuationCommandCenter, formatPct } from "../../engine/valuationCommandCenter";
import { StatTile } from "./atoms";

export default function BacktestSection({
  commandCenter,
}: {
  commandCenter: ReturnType<typeof buildValuationCommandCenter>;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Historical Signal Replay</div>
            <div className="mt-1 text-sm text-slate-600">{commandCenter.backtest.latestComparedToHistory}</div>
          </div>
          <div className="text-right text-sm text-slate-700">
            <div>Investable points: <strong>{commandCenter.backtest.investableCount}</strong></div>
            <div>High-conviction+: <strong>{commandCenter.backtest.highConvictionCount}</strong></div>
          </div>
        </div>
        {commandCenter.backtest.available ? (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <StatTile label="1Y forward win rate" value={formatPct(commandCenter.backtest.forwardWinRate1Y, 0)} />
              <StatTile label="3Y forward win rate" value={formatPct(commandCenter.backtest.forwardWinRate3Y, 0)} />
              <StatTile label="Median 1Y return" value={formatPct(commandCenter.backtest.median1Y, 1)} />
              <StatTile label="Median 3Y CAGR" value={formatPct(commandCenter.backtest.median3Y, 1)} />
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b">
                    <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Period</th>
                    <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">State</th>
                    <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Stress CAGR</th>
                    <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Realized 1Y</th>
                    <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Realized 3Y</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {commandCenter.backtest.points.slice(-8).reverse().map((point) => (
                    <tr key={point.periodEnd}>
                      <td className="px-3 py-2 text-slate-700">{point.periodEnd.slice(0, 10)}</td>
                      <td className="px-3 py-2 text-slate-700">{point.state}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatPct(point.expectedCagrStress, 1)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatPct(point.realized1Y, 1)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatPct(point.realized3Y, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
            {commandCenter.backtest.latestComparedToHistory}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signal Distribution</div>
        <div className="mt-4 space-y-2 text-sm text-slate-700">
          {Object.entries(commandCenter.backtest.countsByState).map(([state, count]) => (
            <div key={state} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <span>{state}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
