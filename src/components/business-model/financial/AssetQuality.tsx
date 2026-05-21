/**
 * Asset Quality (Financial)
 *
 * For a bank, asset quality IS the franchise. A 0.5% deterioration in GNPA
 * compounds into 5x credit cost spike in a downturn. Buffett famously said
 * banks are easy to evaluate, except for the ~5% of assets that destroy 100%
 * of equity. This view tracks GNPA / NNPA / PCR / credit cost across cycles.
 */
import { useMemo } from "react";
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import type { FinancialInstitutionAnalysisResult } from "../../../engine/analysisFamily";

interface Props { bankResult: FinancialInstitutionAnalysisResult; }

export default function AssetQuality({ bankResult }: Props) {
  const metrics = bankResult.bankMetrics ?? [];

  const rows = useMemo(() => {
    return metrics.map((m) => ({
      period: m.period_end.slice(0, 7),
      gnpa: m.quality?.gnpa_pct != null ? +m.quality.gnpa_pct.toFixed(2) : null,
      nnpa: m.quality?.nnpa_pct != null ? +m.quality.nnpa_pct.toFixed(2) : null,
      pcr: m.quality?.pcr_pct != null ? +m.quality.pcr_pct.toFixed(1) : null,
      creditCost: m.creditCost != null ? +(m.creditCost * 100).toFixed(2) : null,
    }));
  }, [metrics]);

  const latest = rows[rows.length - 1];
  const validGNPA = rows.map((r) => r.gnpa).filter((v): v is number => v != null);
  const peakGNPA = validGNPA.length > 0 ? Math.max(...validGNPA) : null;
  const validCC = rows.map((r) => r.creditCost).filter((v): v is number => v != null);
  const peakCC = validCC.length > 0 ? Math.max(...validCC) : null;
  const avgCC = validCC.length > 0 ? validCC.reduce((a, b) => a + b, 0) / validCC.length : null;

  const grade = useMemo(() => {
    if (latest?.gnpa == null) return { letter: "?", color: "slate", reason: "GNPA data unavailable" };
    if (latest.gnpa < 1.5 && (latest.pcr ?? 0) > 70) return { letter: "A+", color: "emerald", reason: "Pristine asset quality with strong cushion" };
    if (latest.gnpa < 2.5 && (latest.pcr ?? 0) > 60) return { letter: "A", color: "emerald", reason: "Strong asset quality, well-provisioned" };
    if (latest.gnpa < 4) return { letter: "B", color: "blue", reason: "Acceptable, monitor trend" };
    if (latest.gnpa < 7) return { letter: "C", color: "amber", reason: "Stressed book; verify recovery trajectory" };
    return { letter: "D", color: "rose", reason: "Heavy NPL burden; equity at risk" };
  }, [latest]);

  const gc: Record<string, { bg: string; text: string; border: string }> = {
    emerald: { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-900 dark:text-emerald-200", border: "border-emerald-300 dark:border-emerald-700" },
    blue: { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-900 dark:text-blue-200", border: "border-blue-300 dark:border-blue-700" },
    amber: { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-900 dark:text-amber-200", border: "border-amber-300 dark:border-amber-700" },
    rose: { bg: "bg-rose-100 dark:bg-rose-900/40", text: "text-rose-900 dark:text-rose-200", border: "border-rose-300 dark:border-rose-700" },
    slate: { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-300", border: "border-slate-300 dark:border-slate-700" },
  };
  const g = gc[grade.color];

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border-2 p-5 ${g.bg} ${g.border}`}>
        <div className="flex items-start gap-4">
          <div className={`text-5xl font-bold ${g.text}`}>{grade.letter}</div>
          <div className="flex-1">
            <h2 className={`text-base font-semibold ${g.text}`}>Asset Quality Grade</h2>
            <p className={`text-sm mt-1 ${g.text} opacity-90`}>{grade.reason}</p>
            <div className="grid grid-cols-4 gap-3 mt-3">
              <Stat g={g} label="Latest GNPA" value={latest?.gnpa != null ? `${latest.gnpa.toFixed(2)}%` : "—"} />
              <Stat g={g} label="Latest NNPA" value={latest?.nnpa != null ? `${latest.nnpa.toFixed(2)}%` : "—"} />
              <Stat g={g} label="Peak GNPA" value={peakGNPA != null ? `${peakGNPA.toFixed(2)}%` : "—"} />
              <Stat g={g} label="Peak Credit Cost" value={peakCC != null ? `${peakCC.toFixed(2)}%` : "—"} />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Asset Quality Trend</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">GNPA and NNPA on left axis (%), PCR on right (%).</p>
        <ResponsiveContainer width="100%" height={350}>
          <ComposedChart data={rows}>
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="L" tick={{ fontSize: 11 }} label={{ value: "%", angle: -90, position: "left", fontSize: 11 }} />
            <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 11 }} label={{ value: "PCR %", angle: 90, position: "right", fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="L" dataKey="gnpa" name="GNPA %" fill="#f87171" />
            <Bar yAxisId="L" dataKey="nnpa" name="NNPA %" fill="#dc2626" />
            <Line yAxisId="L" dataKey="creditCost" name="Credit Cost %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            <Line yAxisId="R" dataKey="pcr" name="PCR %" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            <ReferenceLine yAxisId="L" y={3} stroke="#94a3b8" strokeDasharray="3 3" label={{ value: "3% threshold", fontSize: 10 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-2">What to watch</h4>
        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <li><span className="font-semibold">GNPA &lt; 1.5% sustained</span> → wonderful underwriting (HDFC, Kotak historically)</li>
          <li><span className="font-semibold">NNPA &lt; 0.5%</span> → fully provisioned; minimal residual risk</li>
          <li><span className="font-semibold">PCR &gt; 70%</span> → strong cushion against future shocks</li>
          <li><span className="font-semibold">Credit Cost &gt; 1.5% sustained</span> → underwriting failure or aggressive growth</li>
          <li><span className="font-semibold">GNPA spike &gt; 2pp YoY</span> → one of three: recession, reckless growth, restructuring transparency</li>
          <li><span className="font-semibold">5y avg credit cost</span> ({avgCC?.toFixed(2) ?? "—"}%) → through-the-cycle loss rate; subtract from NIM for true earning power</li>
        </ul>
      </div>
    </div>
  );
}

function Stat({ g, label, value }: { g: { text: string }; label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase font-mono text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${g.text}`}>{value}</div>
    </div>
  );
}
