import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from "recharts";
import type { RecastPeriod } from "../../engine/types";

interface Props {
  data: RecastPeriod[];
}

/**
 * Cash Flow & FCF Trend chart.
 * Bars: CFO and -Capex (capital intensity visible as red bars).
 * Line: FCF (CFO - |Capex|) — the actual cash returned to the firm.
 * Reveals capex-heavy years, FCF inflection points, dividend coverage.
 */
export default function CashFlowChart({ data }: Props) {
  if (!data || data.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Cash Flow Trend</h3>
        <p className="text-xs text-slate-500 mt-2">Need at least 2 periods of data.</p>
      </div>
    );
  }

  const series = data.map(p => {
    const cfo = p.cf?.CFO ?? 0;
    const capex = -Math.abs(p.cf?.Capex ?? 0);
    const fcf = cfo + capex;
    const dividends = -Math.abs(p.cf?.DividendPaid ?? 0);
    return {
      period: p.period_end.slice(0, 7),
      CFO: +cfo.toFixed(0),
      Capex: +capex.toFixed(0),
      FCF: +fcf.toFixed(0),
      Dividends: +dividends.toFixed(0),
    };
  });

  // Aggregate stats
  const totalCFO = series.reduce((s, r) => s + r.CFO, 0);
  const totalCapex = series.reduce((s, r) => s + Math.abs(r.Capex), 0);
  const totalFCF = series.reduce((s, r) => s + r.FCF, 0);
  const totalDiv = series.reduce((s, r) => s + Math.abs(r.Dividends), 0);
  const fcfDivCoverage = totalDiv > 0 ? totalFCF / totalDiv : null;
  const capexIntensity = totalCFO > 0 ? totalCapex / totalCFO : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Cash Flow &amp; FCF Trend</h3>
        <p className="text-xs text-slate-500">
          CFO and Capex bars with FCF overlay. Reveals capital intensity and FCF inflection points.
        </p>
      </div>

      {/* Aggregate stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Total CFO</div>
          <div className="font-bold text-slate-900 dark:text-slate-100">₹{totalCFO.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr</div>
        </div>
        <div className="rounded-lg bg-red-50 dark:bg-red-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-red-700 dark:text-red-300">Total Capex</div>
          <div className="font-bold text-slate-900 dark:text-slate-100">₹{totalCapex.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr</div>
        </div>
        <div className="rounded-lg bg-blue-50 dark:bg-blue-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-blue-700 dark:text-blue-300">Capex Intensity</div>
          <div className="font-bold text-slate-900 dark:text-slate-100">
            {capexIntensity != null ? `${(capexIntensity * 100).toFixed(0)}%` : "—"}
            <span className="text-[10px] font-normal text-slate-500 ml-1">of CFO</span>
          </div>
        </div>
        <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/30 p-2">
          <div className="text-[10px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300">FCF / Dividends</div>
          <div className={`font-bold ${
            fcfDivCoverage != null && fcfDivCoverage > 1.5 ? "text-emerald-600" :
            fcfDivCoverage != null && fcfDivCoverage > 1.0 ? "text-blue-600" :
            "text-amber-600"
          }`}>
            {fcfDivCoverage != null ? `${fcfDivCoverage.toFixed(1)}x` : "—"}
          </div>
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ left: 5, right: 10, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
            <XAxis dataKey="period" fontSize={10} />
            <YAxis fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={((value: any, name: any) => [`₹${(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`, name]) as any}
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Bar dataKey="CFO" name="Operating Cash Flow" fill="#10b981" />
            <Bar dataKey="Capex" name="Capex (negative)" fill="#ef4444" />
            <Bar dataKey="Dividends" name="Dividends Paid" fill="#94a3b8" />
            <Line type="monotone" dataKey="FCF" name="Free Cash Flow" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
