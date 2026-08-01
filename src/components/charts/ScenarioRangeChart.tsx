import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LabelList } from "recharts";
import { fmtINR, TOOLTIP_STYLE } from "./chartUtils";

interface ScenarioPoint {
  label: string;
  value: number | null;
  probability: number;
  /** Visual color for the bar — matches scenario palette */
  color: string;
}

interface Props {
  scenarios: ScenarioPoint[];
  marketPrice?: number | null | undefined;
  /** Probability-weighted expected value */
  expectedValue?: number | null | undefined;
  /**
   * Whether bars are on a per-share (₹/share) axis. When false the values are
   * raw ₹ Cr and `marketPrice` — an equity *per-share* price — has no business
   * on this axis, so the reference line and stat are suppressed. Without this,
   * the no-shares-out path plotted ₹Cr scenario values beside a ₹/share market
   * price under a "per share" label (the unit-scale class; see
   * `docs/.../unit-scale-mismatch-in-charts`).
   */
  perShare?: boolean;
}

/**
 * Scenario Range Chart — visual summary of the 4 forecast scenarios
 * (Stress / Base / Bull / Panic) showing intrinsic value with a market-price
 * reference line *when the bars are per share*. Probability shown on each bar.
 */
export default function ScenarioRangeChart({ scenarios, marketPrice, expectedValue, perShare = true }: Props) {
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

  // A per-share equity price only scales the axis when the bars are per share.
  // On the ₹Cr path it is a different unit — including it in the domain would
  // squash the bars for a comparison the reference line then doesn't make.
  const refPrice = perShare ? marketPrice : null;
  const max = Math.max(...validValues, refPrice ?? 0, expectedValue ?? 0);
  const unitLabel = perShare ? "per share" : "₹ Cr";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Scenario Value Range <span className="text-slate-400 font-normal">({unitLabel})</span></h3>
          <p className="text-xs text-slate-500">
            Intrinsic value {unitLabel} across stress / base / bull / panic paths{perShare ? ". Market price shown as reference." : "."}
          </p>
        </div>
        <div className="flex gap-3 text-xs">
          {refPrice != null && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Market Price</div>
              <div className="font-bold text-amber-600">₹{refPrice.toFixed(0)}</div>
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
        <ResponsiveContainer debounce={50} width="100%" height="100%">
          <BarChart data={data} margin={{ left: 5, right: 30, top: 30, bottom: 5 }}>
            <XAxis dataKey="label" fontSize={11} />
            <YAxis fontSize={10} domain={[0, max * 1.1]} tickFormatter={(v) => fmtINR(v)} />
            <Tooltip<number, string>
              formatter={(value, _name, item) => [
                `₹${(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} (P=${(((item.payload as { probability?: number } | undefined)?.probability ?? 0) * 100).toFixed(0)}%)`,
                perShare ? "Intrinsic / share" : "Intrinsic (₹ Cr)",
              ]}
              contentStyle={TOOLTIP_STYLE}
            />
            {refPrice != null && (
              <ReferenceLine
                y={refPrice}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                strokeWidth={2}
                label={{ value: `Market ₹${refPrice.toFixed(0)}`, position: "right", fontSize: 10, fill: "#f59e0b" }}
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
              {/* recharts types the label as RenderableText, which includes
                  null/undefined; the guard keeps a missing bar from printing
                  "₹undefined" above it. */}
              <LabelList dataKey="value" position="top" fontSize={11} formatter={(v) => (v == null ? "" : `₹${v}`)} />
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
