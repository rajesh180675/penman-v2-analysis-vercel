import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import type { SegmentData } from "../../engine/segmentParser";

interface Props {
  segmentData: SegmentData | null;
  unit?: string;
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316", "#6366f1", "#ef4444"];

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export default function SegmentBreakdown({ segmentData, unit = "₹ Cr" }: Props) {
  if (!segmentData || !segmentData.segments || segmentData.segments.length === 0) {
    return null; // Don't show panel if no segment data — Dashboard already gates rendering
  }

  const { segments, years, data } = segmentData;

  // Latest year is first in the array (Capitaline reports newest first)
  const latestYear = years[0];
  const segType = segmentData.segmentationType === "business" ? "Business" :
                  segmentData.segmentationType === "geographic" ? "Geographic" : "Total";

  // Build latest-period revenue + result breakdown
  const latestBreakdown = segments.map((seg, i) => {
    const periodData = data[seg]?.[latestYear];
    return {
      name: seg,
      revenue: periodData?.revenue ?? 0,
      result: periodData?.result ?? 0,
      assets: periodData?.assets ?? 0,
      color: COLORS[i % COLORS.length],
    };
  }).filter(s => s.revenue !== 0 || s.result !== 0);

  const totalRevenue = latestBreakdown.reduce((s, x) => s + Math.abs(x.revenue), 0);
  const totalResult = latestBreakdown.reduce((s, x) => s + x.result, 0);

  // Build time-series for stacked area chart (oldest first)
  const reversedYears = [...years].reverse();
  const timeSeries = reversedYears.map(year => {
    const row: Record<string, number | string> = { year };
    for (const seg of segments) {
      row[seg] = data[seg]?.[year]?.revenue ?? 0;
    }
    return row;
  });

  // Pie data with percentages
  const pieData = latestBreakdown.map(s => ({
    name: s.name,
    value: Math.abs(s.revenue),
    pct: totalRevenue > 0 ? (Math.abs(s.revenue) / totalRevenue) : 0,
    color: s.color,
  }));

  // Concentration risk
  const top = pieData.length > 0 ? pieData.reduce((a, b) => a.value > b.value ? a : b) : null;
  const concentration = top ? top.pct : 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:bg-slate-900/60 dark:border-slate-700 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Segment Breakdown</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {segType} segmentation — {latestBreakdown.length} segments · {latestYear}
          </p>
        </div>
        {top && (
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Largest Segment</div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate max-w-[180px]" title={top.name}>{top.name}</div>
            <div className={`text-xs font-bold ${
              concentration > 0.6 ? "text-amber-600" : concentration > 0.4 ? "text-blue-600" : "text-emerald-600"
            }`}>{pct(concentration)} of revenue</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pie chart — revenue mix */}
        <div>
          <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Revenue Mix ({latestYear})</h4>
          <div className="h-56">
            <ResponsiveContainer debounce={50} width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={85}
                  paddingAngle={2}
                  dataKey="value"
                  label={(entry: any) => `${((entry.pct ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                  fontSize={10}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={((value: number, _name: string, props: { payload?: { pct: number } }) =>
                    [`${unit} ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })} (${(props.payload?.pct ?? 0 * 100).toFixed(1)}%)`, ""]) as any
                  }
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} verticalAlign="bottom" iconSize={8} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bar chart — revenue vs result by segment */}
        <div>
          <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Revenue vs Profit by Segment</h4>
          <div className="h-56">
            <ResponsiveContainer debounce={50} width="100%" height="100%">
              <BarChart data={latestBreakdown} margin={{ left: 5, right: 10, top: 5, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
                <XAxis
                  dataKey="name"
                  fontSize={9}
                  angle={-20}
                  textAnchor="end"
                  height={50}
                  interval={0}
                />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} fontSize={10} />
                <Tooltip
                  formatter={((value: number) => [`${unit} ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, ""]) as any}
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" fillOpacity={0.85} radius={[3, 3, 0, 0]} />
                <Bar dataKey="result" name="Profit (Result)" fill="#10b981" fillOpacity={0.85} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Per-segment summary table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
              <th className="text-left py-2 font-semibold uppercase tracking-wide text-[10px]">Segment</th>
              <th className="text-right py-2 font-semibold uppercase tracking-wide text-[10px]">Revenue</th>
              <th className="text-right py-2 font-semibold uppercase tracking-wide text-[10px]">% Mix</th>
              <th className="text-right py-2 font-semibold uppercase tracking-wide text-[10px]">Result</th>
              <th className="text-right py-2 font-semibold uppercase tracking-wide text-[10px]">Margin</th>
              <th className="text-right py-2 font-semibold uppercase tracking-wide text-[10px]">Assets</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {latestBreakdown.map(s => {
              const mix = totalRevenue > 0 ? Math.abs(s.revenue) / totalRevenue : 0;
              const margin = s.revenue !== 0 ? s.result / s.revenue : null;
              return (
                <tr key={s.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[200px]" title={s.name}>{s.name}</span>
                    </div>
                  </td>
                  <td className="py-2 text-right font-mono text-slate-700 dark:text-slate-300">
                    {s.revenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </td>
                  <td className="py-2 text-right font-mono font-bold text-slate-700 dark:text-slate-300">
                    {(mix * 100).toFixed(1)}%
                  </td>
                  <td className={`py-2 text-right font-mono ${s.result >= 0 ? "text-slate-700 dark:text-slate-300" : "text-red-600"}`}>
                    {s.result.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </td>
                  <td className={`py-2 text-right font-mono font-bold ${
                    margin == null ? "text-slate-400" :
                    margin >= 0.20 ? "text-emerald-600" :
                    margin >= 0.10 ? "text-blue-600" :
                    margin >= 0 ? "text-slate-600" :
                    "text-red-600"
                  }`}>
                    {margin == null ? "—" : pct(margin)}
                  </td>
                  <td className="py-2 text-right font-mono text-slate-600 dark:text-slate-400">
                    {s.assets ? s.assets.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-300 dark:border-slate-600 font-bold">
              <td className="py-2 text-slate-800 dark:text-slate-100">Total</td>
              <td className="py-2 text-right font-mono text-slate-800 dark:text-slate-100">
                {totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </td>
              <td className="py-2 text-right">100%</td>
              <td className={`py-2 text-right font-mono ${totalResult >= 0 ? "text-slate-800 dark:text-slate-100" : "text-red-600"}`}>
                {totalResult.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </td>
              <td className={`py-2 text-right font-mono ${
                totalRevenue > 0 && totalResult / totalRevenue >= 0.10 ? "text-emerald-600" : "text-slate-700"
              }`}>
                {totalRevenue > 0 ? pct(totalResult / totalRevenue) : "—"}
              </td>
              <td className="py-2 text-right">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Concentration warning */}
      {concentration > 0.7 && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 p-3 text-xs text-amber-800 dark:text-amber-200">
          ⚠️ <strong>High concentration risk:</strong> {top?.name} accounts for {pct(concentration)} of revenue. Diversification benefits are limited.
        </div>
      )}

      {/* Time-series — segment revenue evolution */}
      {timeSeries.length >= 2 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Segment Revenue Over Time</h4>
          <div className="h-44">
            <ResponsiveContainer debounce={50} width="100%" height="100%">
              <BarChart data={timeSeries} margin={{ left: 5, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
                <XAxis dataKey="year" fontSize={10} />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} fontSize={10} />
                <Tooltip
                  formatter={((value: number) => [`${unit} ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, ""]) as any}
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                {segments.map((seg, i) => (
                  <Bar
                    key={seg}
                    dataKey={seg}
                    stackId="rev"
                    fill={COLORS[i % COLORS.length]}
                    fillOpacity={0.85}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
