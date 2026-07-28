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

  const chartData = validFactors.map(f => ({
    name: f.name,
    value: +(f.value! * 100).toFixed(1),
    raw: f.value!,
    color: f.color,
    key: f.key,
    selected: f.key === selectedFactor,
  }));

  // Build trend data for selected factor
  const trendData = history && selectedFactor
    ? history.map(h => ({
        period: h.period,
        value: h[selectedFactor as keyof HistoryPoint] as number | null,
      })).filter(d => d.value != null)
    : [];

  const selectedMeta = factors.find(f => f.key === selectedFactor);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">DuPont 5-Factor Decomposition</h3>
          {history && history.length > 0 && (
            <p className="text-[10px] text-slate-400 mt-0.5">Click a bar to see its historical trend</p>
          )}
        </div>
        {roe != null && (
          <span className="text-sm font-bold text-indigo-600">ROE: {(roe * 100).toFixed(1)}%</span>
        )}
      </div>

      <div className="h-48">
        <ResponsiveContainer debounce={50} width="100%" height="100%">
          <BarChart data={chartData} margin={{ left: 10, right: 10, top: 10, bottom: 5 }}
            onClick={(e: any) => {
              if (e && e.activePayload && e.activePayload[0] && history) {
                const key = e.activePayload[0].payload.key;
                setSelectedFactor(prev => prev === key ? null : key);
              }
            }}
          >
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
            <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={36} style={{ cursor: history ? "pointer" : "default" }}>
              {chartData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.color}
                  fillOpacity={entry.selected ? 1 : selectedFactor ? 0.4 : 0.8}
                  stroke={entry.selected ? entry.color : "none"}
                  strokeWidth={entry.selected ? 2 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Trend drill-down — appears when a factor is clicked */}
      {selectedFactor && trendData.length >= 2 && selectedMeta && (
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
