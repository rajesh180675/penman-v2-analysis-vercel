import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, LineChart, Line, CartesianGrid } from "recharts";
import { CHART_COLORS, TOOLTIP_STYLE } from "./chartUtils";

interface DuPontFactor {
  name: string;
  value: number | null;
  color: string;
  key: string;
}

interface HistoryPoint {
  period: string;
  taxBurden: number | null;
  intBurden: number | null;
  opm: number | null;
  at: number | null;
  eqMult: number | null;
  roe5: number | null;
}

interface Props {
  /** DuPont 5-factor components for the latest period */
  taxBurden: number | null;
  interestBurden: number | null;
  operatingMargin: number | null;
  assetTurnover: number | null;
  equityMultiplier: number | null;
  /** Resulting ROE */
  roe: number | null;
  /** Full history for interactive trend drill-down */
  history?: HistoryPoint[] | undefined;
}

/**
 * Which factors can be drilled into, and which one is actually open.
 *
 * Lifted out of the component because recharts renders no bar shapes under
 * jsdom — the `<g class="recharts-bar-rectangle">` elements come back childless,
 * so the `Cell` opacity that expresses "dimmed" cannot be asserted from the DOM
 * at all. A clicking spec can see the panel appear but not the dimming, which
 * is exactly half of this defect. Putting both answers in one pure function is
 * what makes the other half testable.
 */
export function resolveDrillDown(
  factorKeys: readonly string[],
  history: readonly HistoryPoint[] | undefined,
  selectedFactor: string | null,
): { trendable: Set<string>; active: string | null } {
  // A factor is trendable only when its own series has enough non-null samples
  // to draw a line. A bare `if (!history)` guard is not enough: `history={[]}`
  // is truthy, and so is a history where one factor is null in every period. In
  // either case selecting would dim the other bars while no panel could appear.
  const trendable = new Set(
    history
      ? factorKeys.filter(
          key => history.filter(h => h[key as keyof HistoryPoint] != null).length >= 2,
        )
      : [],
  );

  // The selection is state; the history is a prop. RatioReport unmounts on tab
  // switch but not on company switch, so a selection outlives the data it was
  // made against: pick a factor on a company with history, load one with a
  // single period, and the bars would stay dimmed around a panel that is no
  // longer there. Deriving the active factor rather than resetting the state
  // closes that without discarding a selection the data may yet support again.
  const active = selectedFactor != null && trendable.has(selectedFactor) ? selectedFactor : null;

  return { trendable, active };
}

/**
 * DuPont 5-factor waterfall chart showing how each factor contributes to ROE.
 * Click any bar to expand a historical trend line for that factor.
 */
export default function DuPontWaterfall({ taxBurden, interestBurden, operatingMargin, assetTurnover, equityMultiplier, roe, history }: Props) {
  const [selectedFactor, setSelectedFactor] = useState<string | null>(null);

  const factors: DuPontFactor[] = [
    { name: "Tax Burden", value: taxBurden, color: CHART_COLORS.primary, key: "taxBurden" },
    { name: "Interest Burden", value: interestBurden, color: CHART_COLORS.tertiary, key: "intBurden" },
    { name: "Operating Margin", value: operatingMargin, color: CHART_COLORS.positive, key: "opm" },
    { name: "Asset Turnover", value: assetTurnover, color: CHART_COLORS.caution, key: "at" },
    { name: "Equity Multiplier", value: equityMultiplier, color: CHART_COLORS.negative, key: "eqMult" },
  ];

  const validFactors = factors.filter(f => f.value != null && Number.isFinite(f.value));
  if (validFactors.length < 3) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">DuPont 5-Factor Decomposition</h3>
        <p className="text-xs text-slate-500">Insufficient data for DuPont decomposition.</p>
      </div>
    );
  }

  // Keyed off the factors that actually render a bar, so the affordance, the
  // click guard and the dimming cannot disagree about which bars exist.
  const { trendable: trendableKeys, active: activeFactor } = resolveDrillDown(
    validFactors.map(f => f.key),
    history,
    selectedFactor,
  );

  const chartData = validFactors.map(f => ({
    name: f.name,
    value: +(f.value! * 100).toFixed(1),
    raw: f.value!,
    color: f.color,
    key: f.key,
    selected: f.key === activeFactor,
  }));

  // Build trend data for selected factor
  const trendData = history && activeFactor
    ? history.map(h => ({
        period: h.period,
        value: h[activeFactor as keyof HistoryPoint] as number | null,
      })).filter(d => d.value != null)
    : [];

  const selectedMeta = factors.find(f => f.key === activeFactor);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">DuPont 5-Factor Decomposition</h3>
          {/* Advertise the affordance only where it exists: a history that is
              present but too thin to plot must not invite a click. */}
          {trendableKeys.size > 0 && (
            <p className="text-[10px] text-slate-400 mt-0.5">Click a bar to see its historical trend</p>
          )}
        </div>
        {roe != null && (
          <span className="text-sm font-bold text-indigo-600">ROE: {(roe * 100).toFixed(1)}%</span>
        )}
      </div>

      <div className="h-48">
        <ResponsiveContainer debounce={50} width="100%" height="100%">
          <BarChart data={chartData} margin={{ left: 10, right: 10, top: 10, bottom: 5 }}>
            <XAxis dataKey="name" fontSize={10} angle={-15} textAnchor="end" height={50} />
            <YAxis
              tickFormatter={(v) => `${v}%`}
              fontSize={11}
              domain={["auto", "auto"]}
            />
            <Tooltip<number, string>
              formatter={(value, _name, item) => {
                const point = item.payload as (typeof chartData)[number] | undefined;
                return [`${point?.raw.toFixed(3) ?? "—"} (${value}%)`, point?.name ?? ""];
              }}
              contentStyle={TOOLTIP_STYLE}
            />
            <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "1.0×", position: "right", fontSize: 9, fill: "#94a3b8" }} />
            {/* The handler lives on the Bar, not the BarChart: the chart-level
                onClick argument (recharts' MouseHandlerDataParam) carries only
                active* indices, never a payload, so reading activePayload there
                silently never fired. BarRectangleItem does carry the row. */}
            <Bar
              dataKey="value"
              radius={[4, 4, 0, 0]}
              barSize={36}
              style={{ cursor: trendableKeys.size > 0 ? "pointer" : "default" }}
              onClick={(data) => {
                const key = (data.payload as (typeof chartData)[number] | undefined)?.key;
                if (key == null || !trendableKeys.has(key)) return;
                setSelectedFactor(prev => (prev === key ? null : key));
              }}
            >
              {chartData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.color}
                  // `activeFactor`, not `selectedFactor`: a selection that no
                  // longer has a trend must not dim its neighbours.
                  fillOpacity={entry.selected ? 1 : activeFactor ? 0.4 : 0.8}
                  stroke={entry.selected ? entry.color : "none"}
                  strokeWidth={entry.selected ? 2 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Trend drill-down — appears when a factor is clicked. Gated on
          `activeFactor`, not the raw state, so this and the dimming above
          open and close together. */}
      {activeFactor && trendData.length >= 2 && selectedMeta && (
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              {selectedMeta.name} — {trendData.length}-Period Trend
            </h4>
            <button
              onClick={() => setSelectedFactor(null)}
              className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              ✕ Close
            </button>
          </div>
          <div className="h-32">
            <ResponsiveContainer debounce={50} width="100%" height="100%">
              <LineChart data={trendData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="period" fontSize={10} />
                <YAxis
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  fontSize={10}
                  domain={["auto", "auto"]}
                />
                <Tooltip<number, string>
                  formatter={(value) => [value == null ? "—" : `${(value * 100).toFixed(2)}%`, selectedMeta.name]}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={selectedMeta.color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: selectedMeta.color }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="mt-3 text-xs text-slate-500">
        ROE = Tax Burden × Interest Burden × OPM × Asset Turnover × Equity Multiplier.
        Bars above 100% amplify returns; below 100% drag them down.
      </div>
    </div>
  );
}
