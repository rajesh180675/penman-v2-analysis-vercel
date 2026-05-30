/**
 * Book Value Compounder (Financial)
 *
 * Buffett's bank/insurer scoring: book value per share growth + dividends.
 *   - Banks: a 12-15% sustained BV CAGR = compounder
 *   - Insurers: BV + change-in-EV is the better metric (intrinsic value
 *     accumulating over float economics, not just GAAP earnings)
 *
 * The "see's candies of banking" test: does the bank earn high ROE on
 * RETAINED equity? If reinvested earnings produce 18% returns, BV
 * compounds at near-ROE rates and intrinsic value compounds with it.
 */
import { useMemo } from "react";
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import type { FinancialInstitutionAnalysisResult } from "../../../engine/analysisFamily";

interface Props { bankResult: FinancialInstitutionAnalysisResult; }

export default function BVCompounder({ bankResult }: Props) {
  const metrics = bankResult.bankMetrics ?? [];

  const rows = useMemo(() => {
    return metrics.map((m, i) => {
      const prev = metrics[i - 1];
      const bv = m.totalEquity ?? null;
      const prevBv = prev?.totalEquity ?? null;
      const bvGrowth = bv != null && prevBv != null && prevBv > 0 ? (bv - prevBv) / prevBv : null;
      const dividends = m.dividendPaid != null ? Math.abs(m.dividendPaid) : null;
      const payout = dividends != null && m.pat != null && m.pat > 0 ? dividends / m.pat : null;
      return {
        period: m.period_end.slice(0, 7),
        bv,
        bvGrowth: bvGrowth != null ? +(bvGrowth * 100).toFixed(2) : null,
        roe: m.roe != null ? +(m.roe * 100).toFixed(2) : null,
        dividends,
        payout: payout != null ? +(payout * 100).toFixed(1) : null,
      };
    });
  }, [metrics]);

  const validBv = rows.map((r) => r.bv).filter((v): v is number => v != null && v > 0);
  let bvCAGR: number | null = null;
  if (validBv.length >= 2) {
    const years = validBv.length - 1;
    bvCAGR = (Math.pow(validBv[validBv.length - 1]! / validBv[0]!, 1 / years) - 1) * 100;
  }
  const validROE = rows.map((r) => r.roe).filter((v): v is number => v != null);
  const avgROE = validROE.length > 0 ? validROE.reduce((a, b) => a + b, 0) / validROE.length : null;
  const validPayout = rows.map((r) => r.payout).filter((v): v is number => v != null);
  const avgPayout = validPayout.length > 0 ? validPayout.reduce((a, b) => a + b, 0) / validPayout.length : null;

  const grade = useMemo(() => {
    if (bvCAGR == null || avgROE == null) return { letter: "?", color: "slate", reason: "Insufficient data" };
    if (bvCAGR > 15 && avgROE > 17) return { letter: "A+", color: "emerald", reason: "Exceptional compounder — BV growing >15% with ROE >17%" };
    if (bvCAGR > 12 && avgROE > 14) return { letter: "A", color: "emerald", reason: "Strong compounder — BV growing >12%, sustained ROE" };
    if (bvCAGR > 9 && avgROE > 12) return { letter: "B", color: "blue", reason: "Decent compounder — solid mid-teen returns" };
    if (bvCAGR > 6) return { letter: "C", color: "amber", reason: "Average bank — BV growth slower than nominal GDP" };
    return { letter: "D", color: "rose", reason: "Failing compounder — BV growth below cost of equity" };
  }, [bvCAGR, avgROE]);

  const gc: Record<string, { bg: string; text: string; border: string }> = {
    emerald: { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-900 dark:text-emerald-200", border: "border-emerald-300 dark:border-emerald-700" },
    blue: { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-900 dark:text-blue-200", border: "border-blue-300 dark:border-blue-700" },
    amber: { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-900 dark:text-amber-200", border: "border-amber-300 dark:border-amber-700" },
    rose: { bg: "bg-rose-100 dark:bg-rose-900/40", text: "text-rose-900 dark:text-rose-200", border: "border-rose-300 dark:border-rose-700" },
    slate: { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-300", border: "border-slate-300 dark:border-slate-700" },
  };
  const g = gc[grade.color]!;

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border-2 p-5 ${g.bg} ${g.border}`}>
        <div className="flex items-start gap-4">
          <div className={`text-5xl font-bold ${g.text}`}>{grade.letter}</div>
          <div className="flex-1">
            <h2 className={`text-base font-semibold ${g.text}`}>BV Compounder Grade</h2>
            <p className={`text-sm mt-1 ${g.text} opacity-90`}>{grade.reason}</p>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <div className="text-[10px] uppercase font-mono text-slate-500 dark:text-slate-400">BV CAGR</div>
                <div className={`text-lg font-semibold tabular-nums ${g.text}`}>{bvCAGR != null ? `${bvCAGR.toFixed(1)}%` : "—"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-mono text-slate-500 dark:text-slate-400">Avg ROE</div>
                <div className={`text-lg font-semibold tabular-nums ${g.text}`}>{avgROE != null ? `${avgROE.toFixed(1)}%` : "—"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-mono text-slate-500 dark:text-slate-400">Avg Payout</div>
                <div className={`text-lg font-semibold tabular-nums ${g.text}`}>{avgPayout != null ? `${avgPayout.toFixed(0)}%` : "—"}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">BV Growth vs ROE</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          BV growth (left) tracks how fast equity is compounding. ROE (right) is the engine driving it. Gap = payout.
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={rows}>
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="L" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v: number | undefined) => `${(v ?? 0).toFixed(1)}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="L" dataKey="bvGrowth" name="BV YoY %" fill="#3b82f6" />
            <Line yAxisId="R" dataKey="roe" name="ROE %" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4 }} />
            <Line yAxisId="L" dataKey="payout" name="Payout %" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} />
            <ReferenceLine yAxisId="R" y={15} stroke="#10b981" strokeDasharray="3 3" label={{ value: "ROE 15%", fontSize: 10 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-2">Buffett's BV compounder framework</h4>
        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <li><span className="font-semibold">BV CAGR ≈ ROE × (1 - payout)</span> → identity. If they diverge, check for issuance/buybacks/OCI.</li>
          <li><span className="font-semibold">BV CAGR &gt; 12% sustained</span> → real long-term wealth creation; price will follow eventually.</li>
          <li><span className="font-semibold">ROE &gt; 15% on growing BV</span> → reinvested earnings producing high returns. The compounder profile.</li>
          <li><span className="font-semibold">Payout 20-30% of PAT</span> → balanced; retains majority for compounding while rewarding shareholders.</li>
          <li><span className="font-semibold">Payout {">"} 50%</span> → mature; can't reinvest at high enough returns. Treat as bond-like.</li>
        </ul>
      </div>
    </div>
  );
}
