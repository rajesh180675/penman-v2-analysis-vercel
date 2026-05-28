/**
 * Capital Cushion / Float Economics (Financial)
 *
 * Banks/NBFCs: CRAR (Capital to Risk-Weighted Assets) vs RBI floor (9-11.5%).
 *   Headroom = CRAR - regulatory minimum. The buffer that absorbs losses
 *   without requiring dilutive equity raise. The franchise is only as
 *   valuable as the cushion that protects it.
 *
 * Insurance: Float = Policyholder Funds / Equity. The free leverage from
 *   premiums collected before claims paid. Solvency Ratio = available
 *   capital / required capital (regulatory minimum 1.50x in India).
 *   Buffett's empire: GEICO float compounded into Berkshire's investments.
 */
import { useMemo } from "react";
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import type { FinancialInstitutionAnalysisResult } from "../../../engine/analysisFamily";

interface Props { bankResult: FinancialInstitutionAnalysisResult; subtype?: "bank" | "nbfc" | "insurance" | "generic-financial" | undefined; }

export default function CapitalCushion({ bankResult, subtype }: Props) {
  const metrics = bankResult.bankMetrics ?? [];
  const isInsurance = subtype === "insurance";

  if (isInsurance) {
    return <InsuranceFloat metrics={metrics} />;
  }

  const rows = useMemo(() => {
    return metrics.map((m) => ({
      period: m.period_end.slice(0, 7),
      crar: m.quality?.crar_pct != null ? +m.quality.crar_pct.toFixed(2) : null,
      tier1: m.quality?.tier1_pct != null ? +m.quality.tier1_pct.toFixed(2) : null,
    }));
  }, [metrics]);

  const latest = rows[rows.length - 1];
  const floor = subtype === "nbfc" ? 15 : 11.5;
  const headroom = latest?.crar != null ? latest.crar - floor : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KPI label="Latest CRAR" value={latest?.crar != null ? `${latest.crar.toFixed(2)}%` : "—"}
             accent={(latest?.crar ?? 0) > floor + 5 ? "emerald" : (latest?.crar ?? 0) > floor + 2 ? "blue" : "amber"} />
        <KPI label="Tier-1 CRAR" value={latest?.tier1 != null ? `${latest.tier1.toFixed(2)}%` : "—"} subline="core capital" />
        <KPI label="Regulatory Floor" value={`${floor}%`} subline={subtype === "nbfc" ? "NBFC minimum" : "Basel III"} />
        <KPI label="Headroom" value={headroom != null ? `${headroom > 0 ? "+" : ""}${headroom.toFixed(2)}pp` : "—"}
             subline="above floor" accent={(headroom ?? 0) > 5 ? "emerald" : (headroom ?? 0) > 2 ? "blue" : "amber"} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Capital Adequacy</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">CRAR vs regulatory floor. Wider gap = more growth runway without dilution.</p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={rows}>
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: "%", angle: -90, position: "left", fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="crar" name="Total CRAR" fill="#3b82f6" />
            <Bar dataKey="tier1" name="Tier-1 CRAR" fill="#10b981" />
            <ReferenceLine y={floor} stroke="#dc2626" strokeWidth={2} label={{ value: `Floor ${floor}%`, fontSize: 10, fill: "#dc2626" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-2">What capital tells you</h4>
        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <li><span className="font-semibold">CRAR &gt; floor + 5pp</span> → ample headroom; can grow 20-30% without raising equity</li>
          <li><span className="font-semibold">CRAR within 2pp of floor</span> → constrained; either slow growth or imminent dilution</li>
          <li><span className="font-semibold">Tier-1 / Total &gt; 80%</span> → high-quality capital base (mostly common equity)</li>
          <li><span className="font-semibold">CRAR declining despite ROE &gt; 0</span> → growing faster than internal accruals; dilution coming</li>
          <li><span className="font-semibold">Stable CRAR with high ROE</span> → wonderful economic engine; equity compounding while supporting growth</li>
        </ul>
      </div>
    </div>
  );
}

function InsuranceFloat({ metrics }: { metrics: NonNullable<FinancialInstitutionAnalysisResult["bankMetrics"]> }) {
  const rows = useMemo(() => {
    return metrics.map((m) => ({
      period: m.period_end.slice(0, 7),
      float: m.policyholderFunds ?? null,
      equity: m.totalEquity ?? null,
      floatLeverage: m.floatToEquity ?? null,
      solvency: m.quality?.solvency_ratio != null ? +m.quality.solvency_ratio.toFixed(2) : null,
      yield_: m.investmentYield != null ? +(m.investmentYield * 100).toFixed(2) : null,
    }));
  }, [metrics]);

  const latest = rows[rows.length - 1];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KPI label="Float (latest)" value={latest?.float != null ? fmtCr(latest.float) : "—"} subline="policyholder funds" accent="blue" />
        <KPI label="Float Leverage" value={latest?.floatLeverage != null ? `${latest.floatLeverage.toFixed(1)}x` : "—"} subline="float / equity"
             accent={(latest?.floatLeverage ?? 0) > 8 ? "emerald" : "blue"} />
        <KPI label="Solvency Ratio" value={latest?.solvency != null ? `${latest.solvency.toFixed(2)}x` : "—"} subline="reg min 1.50x"
             accent={(latest?.solvency ?? 0) > 1.8 ? "emerald" : (latest?.solvency ?? 0) > 1.5 ? "blue" : "amber"} />
        <KPI label="Investment Yield" value={latest?.yield_ != null ? `${latest.yield_.toFixed(2)}%` : "—"} subline="on float" accent="emerald" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Float Economics</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Float (left) is the policyholder pool the insurer invests. Leverage (right) is float/equity — Buffett's GEICO compounder lever.
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={rows}>
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="L" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtCr(v)} />
            <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 11 }} label={{ value: "x", angle: 90, position: "right", fontSize: 11 }} />
            <Tooltip formatter={(v: number | undefined, name: string | undefined) => { const val = v ?? 0; return name === "Float" || name === "Equity" ? fmtCr(val) : `${val.toFixed(2)}${name === "Investment Yield %" ? "%" : "x"}`; }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="L" dataKey="float" name="Float" fill="#3b82f6" />
            <Bar yAxisId="L" dataKey="equity" name="Equity" fill="#0ea5e9" />
            <Line yAxisId="R" dataKey="floatLeverage" name="Float Leverage x" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4 }} />
            <Line yAxisId="R" dataKey="solvency" name="Solvency x" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
        <h4 className="text-xs font-semibold text-blue-900 dark:text-blue-300 uppercase mb-2">Buffett's float framework</h4>
        <ul className="text-xs text-blue-900 dark:text-blue-200 space-y-1">
          <li><span className="font-semibold">Float &gt; 5x equity</span> → meaningful leverage; "free money" if combined ratio &lt;100%</li>
          <li><span className="font-semibold">Float growing &gt; equity growth</span> → franchise expanding; underwriting capacity scaling</li>
          <li><span className="font-semibold">Investment yield &gt; cost of float</span> (combined ratio &lt; 100%) → profitable underwriting on top of float income</li>
          <li><span className="font-semibold">Solvency &gt; 1.80x</span> → comfortable buffer above 1.50x regulatory floor</li>
          <li><span className="font-semibold">Float consistent across cycles</span> → premium retention; sticky customer base</li>
        </ul>
      </div>
    </div>
  );
}

function fmtCr(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e5) return `${(n / 1e5).toFixed(2)} L Cr`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k Cr`;
  return `${n.toFixed(0)} Cr`;
}

function KPI({ label, value, subline, accent = "slate" }: { label: string; value: string; subline?: string | undefined; accent?: "slate" | "blue" | "emerald" | "amber" | "rose" }) {
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
