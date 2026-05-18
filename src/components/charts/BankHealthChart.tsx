import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from "recharts";
import type { BankPeriodMetrics } from "../../engine/bankPipeline";

interface Props {
  metrics: BankPeriodMetrics[];
  /** Cost of equity for ROE benchmark line */
  ke?: number | null;
}

/**
 * Bank Profitability Trends — NIM, ROA, ROE over time.
 * Reference line at ke shows whether ROE earns above cost of equity.
 */
export default function BankHealthChart({ metrics, ke }: Props) {
  if (!metrics || metrics.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Profitability Trends</h3>
        <p className="text-xs text-slate-500 mt-2">Need at least 2 periods of bank metrics.</p>
      </div>
    );
  }

  const data = metrics.map(m => ({
    period: m.period_end.slice(0, 7),
    NIM: m.nim != null ? +(m.nim * 100).toFixed(2) : null,
    ROA: m.roa != null ? +(m.roa * 100).toFixed(2) : null,
    ROE: m.roe != null ? +(m.roe * 100).toFixed(2) : null,
    CreditCost: m.creditCost != null ? +(m.creditCost * 100).toFixed(2) : null,
    CostIncome: m.costToIncome != null ? +(m.costToIncome * 100).toFixed(1) : null,
  }));

  const latest = data[data.length - 1];
  const keePct = ke != null ? +(ke * 100).toFixed(1) : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Bank Profitability Trends</h3>
        <p className="text-xs text-slate-500">NIM, ROA, ROE over time. ROE benchmarked against cost of equity (ke).</p>
      </div>

      {/* Latest period summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div className="rounded-lg bg-blue-50 dark:bg-blue-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-blue-700 dark:text-blue-300">NIM</div>
          <div className="text-base font-bold text-slate-900 dark:text-slate-100">{latest.NIM?.toFixed(2) ?? "—"}%</div>
        </div>
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">ROA</div>
          <div className="text-base font-bold text-slate-900 dark:text-slate-100">{latest.ROA?.toFixed(2) ?? "—"}%</div>
        </div>
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">ROE</div>
          <div className={`text-base font-bold ${
            latest.ROE != null && keePct != null && latest.ROE > keePct ? "text-emerald-600" : "text-slate-900 dark:text-slate-100"
          }`}>{latest.ROE?.toFixed(1) ?? "—"}%</div>
        </div>
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">Credit Cost</div>
          <div className="text-base font-bold text-slate-900 dark:text-slate-100">{latest.CreditCost?.toFixed(2) ?? "—"}%</div>
        </div>
        <div className="rounded-lg bg-slate-100 dark:bg-slate-800/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-400">Cost / Income</div>
          <div className="text-base font-bold text-slate-900 dark:text-slate-100">{latest.CostIncome?.toFixed(0) ?? "—"}%</div>
        </div>
      </div>

      {/* Returns chart: NIM, ROA, ROE */}
      <div className="h-56">
        <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Returns Trend (NIM / ROA / ROE)</h4>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 5, right: 10, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
            <XAxis dataKey="period" fontSize={10} />
            <YAxis tickFormatter={(v) => `${v}%`} fontSize={10} />
            <Tooltip
              formatter={((value: any, name: any) => [`${(value || 0).toFixed(2)}%`, name]) as any}
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {keePct != null && (
              <ReferenceLine y={keePct} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: `ke ${keePct}%`, position: "right", fontSize: 9, fill: "#f59e0b" }} />
            )}
            <Line type="monotone" dataKey="NIM" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="ROA" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="ROE" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Credit cost chart */}
      <div className="h-44">
        <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Credit Cost &amp; Cost-to-Income</h4>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 5, right: 10, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
            <XAxis dataKey="period" fontSize={10} />
            <YAxis tickFormatter={(v) => `${v}%`} fontSize={10} />
            <Tooltip
              formatter={((value: any, name: any) => [`${(value || 0).toFixed(2)}%`, name]) as any}
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="CreditCost" name="Credit Cost" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="CostIncome" name="Cost / Income" stroke="#94a3b8" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
