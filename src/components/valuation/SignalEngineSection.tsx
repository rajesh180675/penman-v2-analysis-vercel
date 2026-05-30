import {
  buildValuationCommandCenter,
  formatHistoricalPercentile,
  formatPct,
} from "../../engine/valuationCommandCenter";
import { useLiveMarketData } from "../../hooks/useLiveMarketData";
import { SignalPill, StatTile } from "./atoms";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export default function SignalEngineSection({
  commandCenter,
  liveMarketData,
  sparklineData,
}: {
  commandCenter: ReturnType<typeof buildValuationCommandCenter>;
  liveMarketData: ReturnType<typeof useLiveMarketData>["snapshot"];
  sparklineData: Array<{ date: string; close: number }>;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Signal Engine</h2>
            <p className="mt-1 text-sm text-slate-500">
              The tab leads with the stressed case and only elevates a buy state when both valuation and historical context are unusually strong.
            </p>
          </div>
          <SignalPill state={commandCenter.signal.state} label={commandCenter.signal.label} />
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why it qualifies</div>
            <div className="mt-2 text-sm font-medium text-slate-800">{commandCenter.signal.summary}</div>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <div>Base upside: <strong>{formatPct(commandCenter.signal.baseUpsidePct)}</strong></div>
              <div>Stress upside: <strong>{formatPct(commandCenter.signal.stressUpsidePct)}</strong></div>
              <div>Historical setup: <strong>{formatHistoricalPercentile(commandCenter.signal.historicalPercentile)}</strong></div>
              <div>Reverse DCF implied growth: <strong>{formatPct(commandCenter.signal.reverseDcfImpliedGrowth, 2)}</strong></div>
              <div>Required margin of safety: <strong>{formatPct(commandCenter.signal.requiredMarginOfSafetyPct, 1)}</strong></div>
              <div>Quality score: <strong>{commandCenter.signal.qualityScore.toFixed(0)}/100</strong></div>
              <div>Opportunity score: <strong>{commandCenter.signal.opportunityScore.toFixed(0)}/100</strong></div>
              <div>Stress expected CAGR: <strong>{formatPct(commandCenter.signal.expectedCagrStress, 1)}</strong></div>
              <div>Sizing bucket: <strong>{commandCenter.signal.convictionBucket}</strong></div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kill Switches</div>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {commandCenter.signal.killSwitches.length ? commandCenter.signal.killSwitches.map((item) => (
                <li key={item} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">{item}</li>
              )) : (
                <li className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                  No active kill-switches are blocking the valuation command center.
                </li>
              )}
            </ul>
            <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Supporting Flags</div>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {commandCenter.signal.supportingFlags.length ? commandCenter.signal.supportingFlags.map((item) => (
                <li key={item} className="rounded-lg border border-slate-200 bg-white px-3 py-2">{item}</li>
              )) : (
                <li className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-500">
                  No exceptional supporting flags are active yet.
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Historical Dislocation</div>
        <div className="mt-3 grid gap-3">
          <StatTile label="Current price percentile" value={formatHistoricalPercentile(liveMarketData?.history?.currentPricePercentile)} />
          <StatTile label="52-week low" value={liveMarketData?.history?.low52Week != null ? `₹${liveMarketData.history.low52Week.toFixed(2)}` : "—"} />
          <StatTile label="52-week high" value={liveMarketData?.history?.high52Week != null ? `₹${liveMarketData.history.high52Week.toFixed(2)}` : "—"} />
          <StatTile label="Distance from 52-week low" value={formatPct(liveMarketData?.history?.distanceFrom52WeekLowPct)} />
          <StatTile label="Drawdown from 52-week high" value={formatPct(liveMarketData?.history?.drawdownFrom52WeekHighPct)} />
        </div>
        <div className="mt-5 h-40">
          {sparklineData.length ? (
            <ResponsiveContainer debounce={50} width="100%" height="100%">
              <LineChart data={sparklineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" hide />
                <YAxis tick={{ fontSize: 10 }} width={56} />
                <Tooltip />
                <Line dataKey="close" stroke="#0f172a" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">
              Historical price series unavailable for this symbol/provider.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
