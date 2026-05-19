import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

interface Props {
  /** DuPont 5-factor components for the latest period */
  taxBurden: number | null;
  interestBurden: number | null;
  operatingMargin: number | null;
  assetTurnover: number | null;
  equityMultiplier: number | null;
  /** Resulting ROE */
  roe: number | null;
}

/**
 * DuPont 5-factor waterfall chart showing how each factor contributes to ROE.
 * Factors < 1.0 drag ROE down, factors > 1.0 amplify it.
 */
export default function DuPontWaterfall({ taxBurden, interestBurden, operatingMargin, assetTurnover, equityMultiplier, roe }: Props) {
  const factors = [
    { name: "Tax Burden", value: taxBurden, color: "#6366f1" },
    { name: "Interest Burden", value: interestBurden, color: "#8b5cf6" },
    { name: "Operating Margin", value: operatingMargin, color: "#10b981" },
    { name: "Asset Turnover", value: assetTurnover, color: "#f59e0b" },
    { name: "Equity Multiplier", value: equityMultiplier, color: "#ef4444" },
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
    // Factors are ratios; show how far from 1.0 (neutral)
    deviation: +((f.value! - 1) * 100).toFixed(1),
  }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">DuPont 5-Factor Decomposition</h3>
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
            <Tooltip
              formatter={((value: number, _name: string, props: any) => [
                `${props.payload.raw.toFixed(3)} (${value}%)`,
                props.payload.name,
              ]) as any}
              contentStyle={{ fontSize: 11, borderRadius: 8, background: "#1e293b", border: "1px solid #334155", color: "#f1f5f9" }}
            />
            <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "1.0×", position: "right", fontSize: 9, fill: "#94a3b8" }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={36}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 text-xs text-slate-500">
        ROE = Tax Burden × Interest Burden × OPM × Asset Turnover × Equity Multiplier.
        Bars above 100% amplify returns; below 100% drag them down.
      </div>
    </div>
  );
}
