import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import { TOOLTIP_STYLE } from "./chartUtils";

interface DriverImpact {
  driver: string;
  /** Intrinsic value if driver shifts unfavorably (e.g., -1 std) */
  low: number;
  /** Intrinsic value if driver shifts favorably (e.g., +1 std) */
  high: number;
  /** What "low" and "high" mean (for tooltip) */
  range: string;
}

interface Props {
  /** Base intrinsic value (per share) */
  baseValue: number;
  /** Each driver's impact range */
  drivers: DriverImpact[];
  /** Optional market price reference line */
  marketPrice?: number | null;
}

/**
 * Forecast Sensitivity Tornado — visualizes which drivers move intrinsic
 * value the most. Sorted by impact magnitude. Reveals what your valuation
 * is actually betting on.
 */
export default function ForecastTornado({ baseValue, drivers, marketPrice }: Props) {
  if (!drivers || drivers.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Sensitivity Tornado</h3>
        <p className="text-xs text-slate-500 mt-2">Insufficient data to compute driver sensitivity.</p>
      </div>
    );
  }

  // Compute symmetric width centered on baseValue, sort by largest impact
  const sorted = [...drivers].sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));

  const data = sorted.map(d => {
    const downside = d.low - baseValue;  // typically negative
    const upside = d.high - baseValue;   // typically positive
    return {
      driver: d.driver,
      downside: +downside.toFixed(0),
      upside: +upside.toFixed(0),
      lowAbs: d.low,
      highAbs: d.high,
      range: d.range,
      magnitude: Math.abs(d.high - d.low),
    };
  });

  const maxAbs = Math.max(...data.map(d => Math.max(Math.abs(d.downside), Math.abs(d.upside))));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Sensitivity Tornado</h3>
        <p className="text-xs text-slate-500">
          How much each driver moves intrinsic value (₹/share). Sorted by impact magnitude.
          Wider bars mean the valuation is more sensitive to that input.
        </p>
      </div>

      <div className="text-xs flex items-center gap-3 text-slate-600 dark:text-slate-400">
        <span>Base intrinsic value: <strong className="text-slate-900 dark:text-slate-100">₹{baseValue.toFixed(0)}</strong></span>
        {marketPrice != null && (
          <span>Market price: <strong className="text-slate-900 dark:text-slate-100">₹{marketPrice.toFixed(0)}</strong></span>
        )}
      </div>

      <div style={{ height: Math.max(220, data.length * 38) }}>
        <ResponsiveContainer debounce={50} width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            stackOffset="sign"
            margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
          >
            <XAxis
              type="number"
              fontSize={10}
              domain={[-maxAbs, maxAbs]}
              tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`}
            />
            <YAxis
              type="category"
              dataKey="driver"
              width={130}
              fontSize={11}
              tick={{ fill: "#475569" }}
            />
            <Tooltip
              formatter={((_value: number, name: string, props: { payload?: { lowAbs: number; highAbs: number; range: string } }) => {
                if (name === "downside") return [`₹${(props.payload?.lowAbs ?? 0).toFixed(0)}`, "Low scenario"];
                return [`₹${(props.payload?.highAbs ?? 0).toFixed(0)}`, "High scenario"];
              }) as any}
              labelFormatter={(label, payload) => {
                const range = payload?.[0]?.payload?.range;
                return range ? `${label} — ${range}` : label;
              }}
              contentStyle={TOOLTIP_STYLE}
            />
            <ReferenceLine x={0} stroke="#94a3b8" strokeWidth={2} />
            <Bar dataKey="downside" stackId="impact" fill="#ef4444" radius={[4, 0, 0, 4]}>
              {data.map((_, i) => <Cell key={`d${i}`} fill="#ef4444" fillOpacity={0.75} />)}
            </Bar>
            <Bar dataKey="upside" stackId="impact" fill="#10b981" radius={[0, 4, 4, 0]}>
              {data.map((_, i) => <Cell key={`u${i}`} fill="#10b981" fillOpacity={0.75} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="text-[11px] text-slate-500 italic">
        Interpretation: focus on the top 2-3 drivers — these are what the valuation is fundamentally betting on.
        Confirm those assumptions are defensible before committing to the model.
      </div>
    </div>
  );
}
