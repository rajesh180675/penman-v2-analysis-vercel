import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { RecastPeriod } from "../../engine/types";

interface Props {
  data: RecastPeriod[];
}

export default function PenmanDecompositionChart({ data }: Props) {
  if (data.length < 3) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Penman Decomposition</h3>
        <p className="text-xs text-slate-500">Need ≥3 periods for trend chart.</p>
      </div>
    );
  }

  const chartData = data.map(p => ({
    period: p.period_end.slice(0, 4),
    PM: p.ratios?.PM != null ? +(p.ratios.PM * 100).toFixed(1) : null,
    ATO: p.ratios?.ATO != null ? +p.ratios.ATO.toFixed(2) : null,
    RNOA: p.ratios?.RNOA != null ? +(p.ratios.RNOA * 100).toFixed(1) : null,
    ROCE: p.ratios?.ROCE != null ? +(p.ratios.ROCE * 100).toFixed(1) : null,
  }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Penman Decomposition — RNOA = PM × ATO</h3>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="period" fontSize={11} />
            <YAxis
              yAxisId="pct"
              orientation="left"
              tickFormatter={(v) => `${v}%`}
              fontSize={11}
              domain={["auto", "auto"]}
            />
            <YAxis
              yAxisId="mult"
              orientation="right"
              tickFormatter={(v) => `${v}×`}
              fontSize={11}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              formatter={(value: any, name: any) => {
                if (name === "ATO") return [`${value}×`, name];
                return [`${value}%`, name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area
              yAxisId="pct"
              type="monotone"
              dataKey="RNOA"
              stroke="#6366f1"
              fill="#6366f1"
              fillOpacity={0.1}
              strokeWidth={2}
              dot={{ r: 3 }}
              name="RNOA %"
            />
            <Area
              yAxisId="pct"
              type="monotone"
              dataKey="PM"
              stroke="#10b981"
              fill="#10b981"
              fillOpacity={0.05}
              strokeWidth={1.5}
              dot={{ r: 2 }}
              name="PM %"
            />
            <Area
              yAxisId="mult"
              type="monotone"
              dataKey="ATO"
              stroke="#f59e0b"
              fill="#f59e0b"
              fillOpacity={0.05}
              strokeWidth={1.5}
              dot={{ r: 2 }}
              name="ATO ×"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        RNOA (Return on Net Operating Assets) decomposes into Profit Margin × Asset Turnover.
        Rising PM with stable ATO = pricing power. Rising ATO with stable PM = operational efficiency.
      </div>
    </div>
  );
}
