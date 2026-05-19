import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LabelList } from "recharts";

interface ScenarioPoint {
  label: string;
  value: number | null;
  probability: number;
  /** Visual color for the bar — matches scenario palette */
  color: string;
}

interface Props {
  scenarios: ScenarioPoint[];
  marketPrice?: number | null;
  /** Probability-weighted expected value */
  expectedValue?: number | null;
}

/**
 * Scenario Range Chart — visual summary of the 4 forecast scenarios
 * (Stress / Base / Bull / Panic) showing intrinsic per share with market
 * price reference line. Probability shown on each bar.
 */
export default function ScenarioRangeChart({ scenarios, marketPrice, expectedValue }: Props) {
  const data = scenarios.map(s => ({
    label: s.label,
    value: s.value != null ? Math.round(s.value) : 0,
    probability: s.probability,
    color: s.color,
  }));

  const validValues = data.filter(d => d.value > 0).map(d => d.value);
  if (validValues.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Scenario Value Range</h3>
        <p className="text-xs text-slate-500 mt-2">Insufficient data to render scenario bars.</p>
      </div>
    );
  }

  const max = Math.max(...validValues, marketPrice ?? 0, expectedValue ?? 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Scenario Value Range</h3>
          <p className="text-xs text-slate-500">
            Intrinsic per share across stress / base / bull / panic paths. Market price shown as reference.
          </p>
        </div>
        <div className="flex gap-3 text-xs">
          {marketPrice != null && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Market Price</div>
              <div className="font-bold text-amber-600">₹{marketPrice.toFixed(0)}</div>
            </div>
          )}
          {expectedValue != null && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Expected Value</div>
              <div className="font-bold text-indigo-600">₹{expectedValue.toFixed(0)}</div>
            </div>
          )}
        </div>
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 5, right: 30, top: 30, bottom: 5 }}>
            <XAxis dataKey="label" fontSize={11} />
            <YAxis fontSize={10} domain={[0, max * 1.1]} tickFormatter={(v) => `₹${v}`} />
            <Tooltip
              formatter={((value: number, _name: string, props: { payload?: { probability: number } }) => [
                `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })} (P=${((props.payload?.probability ?? 0) * 100).toFixed(0)}%)`,
                "Intrinsic / share",
              ]) as any}
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
            />
            {marketPrice != null && (
              <ReferenceLine
                y={marketPrice}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                strokeWidth={2}
                label={{ value: `Market ₹${marketPrice.toFixed(0)}`, position: "right", fontSize: 10, fill: "#f59e0b" }}
              />
            )}
            {expectedValue != null && (
              <ReferenceLine
                y={expectedValue}
                stroke="#6366f1"
                strokeDasharray="6 3"
                strokeWidth={2}
                label={{ value: `E[V]`, position: "left", fontSize: 10, fill: "#6366f1" }}
              />
            )}
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              <LabelList dataKey="value" position="top" fontSize={11} formatter={((v: number) => `₹${v}`) as any} />
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Probability strip below */}
      <div className="grid grid-cols-4 gap-2 text-xs">
        {data.map((d, i) => (
          <div key={i} className="rounded-lg p-2 text-center border border-slate-100 dark:border-slate-800" style={{ background: `${d.color}15` }}>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: d.color }}>{d.label}</div>
            <div className="font-bold text-slate-900 dark:text-slate-100">₹{d.value}</div>
            <div className="text-[10px] text-slate-500">P = {(d.probability * 100).toFixed(0)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}
