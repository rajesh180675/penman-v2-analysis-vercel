/**
 * Operating Efficiency (Financial)
 *
 * Cost-to-Income = OpEx / (NII + Other Income).
 * Below 40% = wonderful (HDFC, Kotak). 50-60% = average. >65% = bloated.
 *
 * Banks are operationally similar — branches, technology, staff. The
 * efficient ones compound capital through the franchise; the bloated ones
 * give it back to operations.
 */
import { useMemo } from "react";
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import type { FinancialInstitutionAnalysisResult } from "../../../engine/analysisFamily";

interface Props { bankResult: FinancialInstitutionAnalysisResult; }

export default function OperatingEfficiency({ bankResult }: Props) {
  const metrics = bankResult.bankMetrics ?? [];

  const rows = useMemo(() => {
    return metrics.map((m) => {
      const totalIncome = (m.nii ?? 0) + (m.otherIncome ?? 0);
      const opex = m.operatingExpenses ?? 0;
      return {
        period: m.period_end.slice(0, 7),
        opex,
        totalIncome,
        c2i: m.costToIncome != null ? +(m.costToIncome * 100).toFixed(1) : null,
        nii: m.nii ?? 0,
        other: m.otherIncome ?? 0,
      };
    });
  }, [metrics]);

  const latest = rows[rows.length - 1];
  const valid = rows.map((r) => r.c2i).filter((v): v is number => v != null);
  const avg = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  const min = valid.length > 0 ? Math.min(...valid) : null;
  const max = valid.length > 0 ? Math.max(...valid) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KPI label="Latest C/I" value={latest?.c2i != null ? `${latest.c2i.toFixed(1)}%` : "—"}
             accent={(latest?.c2i ?? 100) < 40 ? "emerald" : (latest?.c2i ?? 100) < 50 ? "blue" : (latest?.c2i ?? 100) < 60 ? "amber" : "rose"} />
        <KPI label="Avg C/I" value={avg != null ? `${avg.toFixed(1)}%` : "—"} subline="through cycle" />
        <KPI label="Best year" value={min != null ? `${min.toFixed(1)}%` : "—"} accent="emerald" />
        <KPI label="Worst year" value={max != null ? `${max.toFixed(1)}%` : "—"} accent="rose" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Cost-to-Income Trend</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">OpEx as % of total operating income. Lower is better.</p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={rows}>
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="L" tick={{ fontSize: 11 }} label={{ value: "%", angle: -90, position: "left", fontSize: 11 }} />
            <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 11 }} label={{ value: "Cr", angle: 90, position: "right", fontSize: 11 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="R" dataKey="nii" name="NII" stackId="a" fill="#3b82f6" />
            <Bar yAxisId="R" dataKey="other" name="Other Income" stackId="a" fill="#0ea5e9" />
            <Bar yAxisId="R" dataKey="opex" name="OpEx" fill="#f87171" />
            <Line yAxisId="L" dataKey="c2i" name="Cost / Income %" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 4 }} />
            <ReferenceLine yAxisId="L" y={40} stroke="#10b981" strokeDasharray="3 3" label={{ value: "40% best-in-class", fontSize: 10 }} />
            <ReferenceLine yAxisId="L" y={50} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "50% average", fontSize: 10 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-2">Reading the cost line</h4>
        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <li><span className="font-semibold">Trending down →</span> operating leverage at work; technology paying off</li>
          <li><span className="font-semibold">Trending up →</span> branch expansion, salary inflation, or new product launches eating margin</li>
          <li><span className="font-semibold">Flat near 40%</span> → mature, well-run franchise (Kotak, HDFC profile)</li>
          <li><span className="font-semibold">Flat near 50%+</span> → public-sector or regional bank profile; structural drag</li>
          <li><span className="font-semibold">Volatile</span> → either restructuring charges or growth-investment phase</li>
        </ul>
      </div>
    </div>
  );
}

function KPI({ label, value, subline, accent = "slate" }: { label: string; value: string; subline?: string; accent?: "slate" | "blue" | "emerald" | "amber" | "rose" }) {
  const map = {
    slate: "text-slate-900 dark:text-slate-100",
    blue: "text-blue-700 dark:text-blue-400",
    emerald: "text-emerald-700 dark:text-emerald-400",
    amber: "text-amber-700 dark:text-amber-400",
    rose: "text-rose-700 dark:text-rose-400",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-base font-semibold tabular-nums mt-0.5 ${map[accent]}`}>{value}</div>
      {subline && <div className="text-[10px] text-slate-500 mt-0.5">{subline}</div>}
    </div>
  );
}
