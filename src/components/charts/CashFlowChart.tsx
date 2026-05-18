import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from "recharts";
import type { RecastPeriod } from "../../engine/types";

interface Props {
  data: RecastPeriod[];
  unit?: string;
}

/**
 * Cash Flow Health Chart — three views:
 *  1. CFO vs Net Income (earnings quality / accruals signal)
 *  2. FCF (CFO − Capex) trend with conversion ratio
 *  3. Cash deployment (Capex / Dividends / Buybacks) as stacked bars
 */
export default function CashFlowChart({ data, unit = "₹ Cr" }: Props) {
  if (!data || data.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Cash Flow Health</h3>
        <p className="text-xs text-slate-500 mt-2">Need at least 2 periods.</p>
      </div>
    );
  }

  const series = data.map(p => {
    const cfo = p.cf?.CFO ?? 0;
    const capex = Math.abs(p.cf?.Capex ?? 0);
    const cni = p.is?.CNI ?? 0;
    const fcf = cfo - capex;
    const div = p.cf?.DividendPaid ?? 0;
    const bb = p.cf?.ShareBuybacks ?? 0;
    return {
      period: p.period_end.slice(0, 7),
      CFO: +cfo.toFixed(0),
      CNI: +cni.toFixed(0),
      FCF: +fcf.toFixed(0),
      Capex: +capex.toFixed(0),
      Dividends: +Math.abs(div).toFixed(0),
      Buybacks: +Math.abs(bb).toFixed(0),
      conversion: cni > 0 ? +((cfo / cni) * 100).toFixed(0) : null,
    };
  });

  const latest = series[series.length - 1];
  const totals = series.reduce(
    (a, p) => ({
      CFO: a.CFO + p.CFO,
      CNI: a.CNI + p.CNI,
      Capex: a.Capex + p.Capex,
      Dividends: a.Dividends + p.Dividends,
      Buybacks: a.Buybacks + p.Buybacks,
    }),
    { CFO: 0, CNI: 0, Capex: 0, Dividends: 0, Buybacks: 0 },
  );
  const avgConversion = totals.CNI > 0 ? (totals.CFO / totals.CNI) * 100 : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Cash Flow Health</h3>
        <p className="text-xs text-slate-500">CFO vs earnings, free cash flow, and cash deployment ({unit})</p>
      </div>

      {/* Latest period KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">CFO</div>
          <div className="text-base font-bold text-slate-900 dark:text-slate-100">{unit} {latest.CFO.toLocaleString("en-IN")}</div>
        </div>
        <div className="rounded-lg bg-blue-50 dark:bg-blue-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-blue-700 dark:text-blue-300">FCF (CFO − Capex)</div>
          <div className={`text-base font-bold ${latest.FCF >= 0 ? "text-slate-900 dark:text-slate-100" : "text-red-600"}`}>
            {unit} {latest.FCF.toLocaleString("en-IN")}
          </div>
        </div>
        <div className="rounded-lg bg-slate-100 dark:bg-slate-800/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-400">CFO / Net Income</div>
          <div className={`text-base font-bold ${
            latest.conversion != null && latest.conversion >= 100 ? "text-emerald-600" :
            latest.conversion != null && latest.conversion >= 80 ? "text-blue-600" :
            "text-amber-600"
          }`}>
            {latest.conversion != null ? `${latest.conversion}%` : "—"}
          </div>
        </div>
        <div className="rounded-lg bg-slate-100 dark:bg-slate-800/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-400">Avg Conversion</div>
          <div className="text-base font-bold text-slate-900 dark:text-slate-100">
            {avgConversion != null ? `${avgConversion.toFixed(0)}%` : "—"}
          </div>
        </div>
      </div>

      {/* CFO vs Net Income */}
      <div className="h-56">
        <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">CFO vs Net Income — Earnings Quality Signal</h4>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ left: 5, right: 10, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
            <XAxis dataKey="period" fontSize={10} />
            <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} fontSize={10} />
            <Tooltip
              formatter={(value: number) => [`${unit} ${value?.toLocaleString("en-IN")}`, ""]}
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Bar dataKey="CFO" fill="#10b981" fillOpacity={0.85} radius={[3, 3, 0, 0]} />
            <Bar dataKey="CNI" fill="#3b82f6" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* FCF + Cash Deployment stacked */}
      <div className="h-56">
        <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Cash Deployment — Capex / Dividends / Buybacks</h4>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ left: 5, right: 10, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
            <XAxis dataKey="period" fontSize={10} />
            <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} fontSize={10} />
            <Tooltip
              formatter={(value: number) => [`${unit} ${value?.toLocaleString("en-IN")}`, ""]}
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Capex" stackId="deploy" fill="#6366f1" fillOpacity={0.85} radius={[0, 0, 0, 0]} />
            <Bar dataKey="Dividends" stackId="deploy" fill="#a855f7" fillOpacity={0.85} radius={[0, 0, 0, 0]} />
            <Bar dataKey="Buybacks" stackId="deploy" fill="#ec4899" fillOpacity={0.85} radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey="CFO" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4 }} name="CFO (line)" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
