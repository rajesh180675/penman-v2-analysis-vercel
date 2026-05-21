/**
 * Earning Power — DuPont decomposition for financial institutions.
 *
 * Banks earn through SPREAD on LEVERAGED balance sheets. The classic DuPont
 * needs adaptation:
 *
 *   ROE = NIM × Asset Leverage × (1 − Cost-to-Income) × (1 − Tax Rate)
 *
 *   Or equivalently:
 *   ROE = (NIM/Avg Assets × Earning Asset Yield − Funding Cost) × (Assets/Equity)
 *
 * For NBFCs: NIM is replaced by SPREAD (Yield on Advances − Cost of Borrowings).
 * Insurance: Float Yield × Float/Equity is the parallel.
 *
 * The ROE of a bank ≠ ROE of an industrial. A 15% bank ROE on 10x leverage
 * is fundamentally riskier than 15% industrial ROE on 1.5x leverage.
 */
import { useMemo } from "react";
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import type { FinancialInstitutionAnalysisResult } from "../../../engine/analysisFamily";

interface Props { bankResult: FinancialInstitutionAnalysisResult; }

export default function EarningPower({ bankResult }: Props) {
  const metrics = bankResult.bankMetrics ?? [];
  const subtype = bankResult.subtype;

  const rows = useMemo(() => {
    return metrics.map((m, i) => {
      const prev = metrics[i - 1];
      const avgAssets = prev?.totalAssets != null && m.totalAssets != null
        ? (prev.totalAssets + m.totalAssets) / 2 : m.totalAssets;
      const avgEquity = prev?.totalEquity != null && m.totalEquity != null
        ? (prev.totalEquity + m.totalEquity) / 2 : m.totalEquity;
      const leverage = avgAssets != null && avgEquity != null && avgEquity > 0
        ? avgAssets / avgEquity : null;
      return {
        period: m.period_end.slice(0, 7),
        nim: m.nim != null ? +(m.nim * 100).toFixed(2) : null,
        spread: m.spread != null ? +(m.spread * 100).toFixed(2) : null,
        roa: m.roa != null ? +(m.roa * 100).toFixed(2) : null,
        roe: m.roe != null ? +(m.roe * 100).toFixed(2) : null,
        leverage: leverage != null ? +leverage.toFixed(1) : null,
        costToIncome: m.costToIncome != null ? +(m.costToIncome * 100).toFixed(1) : null,
        creditCost: m.creditCost != null ? +(m.creditCost * 100).toFixed(2) : null,
      };
    });
  }, [metrics]);

  const latest = rows[rows.length - 1];
  const isNBFC = subtype === "nbfc";
  const isInsurance = subtype === "insurance";
  const spreadLabel = isNBFC ? "Spread" : "NIM";
  const spreadValue = isNBFC ? latest?.spread : latest?.nim;

  // 5y average for stability
  const last5 = rows.slice(-5);
  const avg5 = (key: keyof typeof rows[number]) => {
    const vals = last5.map((r) => r[key] as number | null).filter((v): v is number => v != null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KPI label="ROE" value={latest?.roe != null ? `${latest.roe.toFixed(1)}%` : "—"}
             subline={`5y avg ${avg5("roe")?.toFixed(1) ?? "—"}%`}
             accent={(latest?.roe ?? 0) >= 15 ? "emerald" : (latest?.roe ?? 0) >= 10 ? "blue" : "amber"} />
        <KPI label={spreadLabel} value={spreadValue != null ? `${spreadValue.toFixed(2)}%` : "—"}
             subline="net spread on assets" accent="blue" />
        <KPI label="Asset Leverage" value={latest?.leverage != null ? `${latest.leverage.toFixed(1)}x` : "—"}
             subline="assets / equity"
             accent={(latest?.leverage ?? 0) > 12 ? "rose" : (latest?.leverage ?? 0) > 8 ? "amber" : "emerald"} />
        <KPI label="Cost / Income" value={latest?.costToIncome != null ? `${latest.costToIncome.toFixed(0)}%` : "—"}
             subline="OpEx / NII+Other"
             accent={(latest?.costToIncome ?? 100) < 40 ? "emerald" : (latest?.costToIncome ?? 100) < 50 ? "blue" : "amber"} />
        <KPI label="ROA" value={latest?.roa != null ? `${latest.roa.toFixed(2)}%` : "—"}
             subline={isInsurance ? "vs 0.7-1.5% target" : isNBFC ? "vs 2-3.5% target" : "vs 1-1.8% target"} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          Earning Power Components
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          {spreadLabel} (left) drives spread income; ROE (right) is the equity return after leverage.
          ROE = {spreadLabel} × Leverage × Efficiency × Tax — banks compound spread through balance sheet leverage.
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={rows}>
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="L" tick={{ fontSize: 11 }} label={{ value: "%", angle: -90, position: "left", fontSize: 11 }} />
            <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 11 }} label={{ value: "Leverage x", angle: 90, position: "right", fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="L" dataKey={isNBFC ? "spread" : "nim"} name={spreadLabel} fill="#3b82f6" />
            <Bar yAxisId="L" dataKey="roa" name="ROA" fill="#0ea5e9" />
            <Line yAxisId="L" dataKey="roe" name="ROE" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 4 }} />
            <Line yAxisId="R" dataKey="leverage" name="Leverage x" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 4" />
            <ReferenceLine yAxisId="L" y={15} stroke="#10b981" strokeDasharray="3 3" label={{ value: "ROE 15%", fontSize: 10 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
        <h4 className="text-xs font-semibold text-blue-900 dark:text-blue-300 uppercase mb-2">
          Buffett's Bank Earning Power Test
        </h4>
        <ul className="text-xs text-blue-900 dark:text-blue-200 space-y-1">
          <li><span className="font-semibold">ROA &gt; 1.2% sustained</span> (banks) → low-cost deposit franchise. Wells Fargo's historic edge.</li>
          <li><span className="font-semibold">{spreadLabel} stable across cycles</span> → pricing power. Volatile spread = commodity lender.</li>
          <li><span className="font-semibold">Leverage &lt; 10x</span> → conservative balance sheet. {">"}15x = recipe for blow-ups.</li>
          <li><span className="font-semibold">Cost-to-Income &lt; 40%</span> → operational excellence. HDFC, Kotak operate near 38-42%.</li>
          <li><span className="font-semibold">ROE &gt; 15% with leverage &lt; 10x</span> → real spread economics, not fake-leverage ROE.</li>
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
