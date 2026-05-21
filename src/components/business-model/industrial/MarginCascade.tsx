/**
 * Margin Cascade — Revenue → Net Income waterfall.
 *
 * Shows how every rupee of revenue gets eaten as it cascades through:
 *   Revenue
 *   − COGS                  → Gross Profit
 *   − OpEx                  → EBITDA
 *   − Depreciation          → EBIT (= Operating Income)
 *   − Net Finance Cost      → PBT
 *   − Tax                   → Net Income (PAT)
 *
 * Each step shows: absolute Cr, % of revenue, and YoY change in margin.
 * Reveals where competitive pressure or cost pressure is hitting.
 */
import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } from "recharts";
import type { RecastPeriod } from "../../../engine/types";

interface Props { recastData: RecastPeriod[]; }

interface Step {
  label: string;
  value: number;
  pctOfRevenue: number;
  isLeak: boolean;
  cumulative: number;
}

export default function MarginCascade({ recastData }: Props) {
  const latest = recastData[recastData.length - 1];

  // Build the waterfall for the latest period
  const steps: Step[] = useMemo(() => {
    if (!latest) return [];
    const sales = latest.is?.Sales ?? 0;
    if (sales <= 0) return [];

    const cogs = latest.is?.COGS ?? 0;
    const ebitda = latest.cf?.EBITDA ?? null;
    const ebit = latest.is?.OI ?? 0;
    const pat = latest.is?.PAT ?? 0;
    const taxExpense = latest.is?.TaxExpense ?? 0;
    const financeCost = latest.is?.FinanceCost ?? 0;
    const financeIncome = latest.is?.FinanceIncome ?? 0;
    const netFinance = financeCost - financeIncome;

    const grossProfit = sales - cogs;
    const opex = ebitda != null ? grossProfit - ebitda : null;
    const dep = ebitda != null ? ebitda - ebit : null;
    const pbt = pat + taxExpense;

    const arr: Step[] = [];
    let cum = sales;
    arr.push({ label: "Revenue", value: sales, pctOfRevenue: 1, isLeak: false, cumulative: cum });

    if (cogs > 0) {
      cum -= cogs;
      arr.push({ label: "− COGS", value: -cogs, pctOfRevenue: -cogs / sales, isLeak: true, cumulative: cum });
      arr.push({ label: "Gross Profit", value: grossProfit, pctOfRevenue: grossProfit / sales, isLeak: false, cumulative: cum });
    }
    if (opex != null && opex > 0) {
      cum -= opex;
      arr.push({ label: "− OpEx", value: -opex, pctOfRevenue: -opex / sales, isLeak: true, cumulative: cum });
      arr.push({ label: "EBITDA", value: ebitda!, pctOfRevenue: ebitda! / sales, isLeak: false, cumulative: cum });
    }
    if (dep != null && dep > 0) {
      cum -= dep;
      arr.push({ label: "− D&A", value: -dep, pctOfRevenue: -dep / sales, isLeak: true, cumulative: cum });
    }
    arr.push({ label: "EBIT", value: ebit, pctOfRevenue: ebit / sales, isLeak: false, cumulative: ebit });
    if (netFinance !== 0) {
      arr.push({ label: "− Net Finance", value: -netFinance, pctOfRevenue: -netFinance / sales, isLeak: netFinance > 0, cumulative: ebit - netFinance });
    }
    arr.push({ label: "PBT", value: pbt, pctOfRevenue: pbt / sales, isLeak: false, cumulative: pbt });
    if (taxExpense > 0) {
      arr.push({ label: "− Tax", value: -taxExpense, pctOfRevenue: -taxExpense / sales, isLeak: true, cumulative: pbt - taxExpense });
    }
    arr.push({ label: "Net Income", value: pat, pctOfRevenue: pat / sales, isLeak: false, cumulative: pat });

    return arr;
  }, [latest]);

  // Margin trend across periods
  const marginHistory = useMemo(() => {
    return recastData.map((p) => {
      const sales = p.is?.Sales ?? 0;
      if (sales <= 0) return null;
      return {
        period: p.period_end.slice(0, 7),
        gross: ((sales - (p.is?.COGS ?? 0)) / sales) * 100,
        ebitda: p.cf?.EBITDA != null ? (p.cf.EBITDA / sales) * 100 : null,
        ebit: ((p.is?.OI ?? 0) / sales) * 100,
        net: ((p.is?.PAT ?? 0) / sales) * 100,
      };
    }).filter((x): x is NonNullable<typeof x> => x != null);
  }, [recastData]);

  if (!latest) {
    return <div className="text-sm text-slate-500 p-8 text-center">No periods available.</div>;
  }

  const latestSales = latest.is?.Sales ?? 0;

  return (
    <div className="space-y-4">
      {/* KPI strip — current margins */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KPI label="Revenue" value={fmtCr(latestSales)} subline={latest.period_end.slice(0, 7)} />
        <KPI label="Gross Margin" value={`${(((latestSales - (latest.is?.COGS ?? 0)) / latestSales) * 100).toFixed(1)}%`} accent="blue" />
        <KPI label="EBIT Margin" value={`${((latest.is?.OI ?? 0) / latestSales * 100).toFixed(1)}%`} accent="emerald" />
        <KPI label="Net Margin" value={`${((latest.is?.PAT ?? 0) / latestSales * 100).toFixed(1)}%`} accent="amber" />
      </div>

      {/* Waterfall — bar chart with reference */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          Latest Period Cascade · {latest.period_end.slice(0, 7)}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Where each rupee of revenue ends up.</p>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={steps.map((s) => ({ name: s.label, value: s.value, leak: s.isLeak, pct: s.pctOfRevenue * 100 }))}>
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={70} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtCr(v ?? 0)} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as { name: string; value: number; pct: number; leak: boolean };
                return (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-xl">
                    <div className="font-semibold">{d.name}</div>
                    <div className="font-mono tabular-nums">{fmtCr(d.value)} · {d.pct.toFixed(1)}% of revenue</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="value">
              {steps.map((s, i) => (
                <Cell key={i} fill={s.isLeak ? "#f87171" : s.label.includes("Income") || s.label === "PBT" || s.label === "EBIT" || s.label === "EBITDA" || s.label === "Gross Profit" ? "#10b981" : "#3b82f6"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Margin history line trend */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Margin Profile Over Time</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={marginHistory}>
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v: number | undefined) => `${(v ?? 0).toFixed(1)}%`} />
            <Bar dataKey="gross" name="Gross Margin" fill="#3b82f6" />
            <Bar dataKey="ebitda" name="EBITDA Margin" fill="#0ea5e9" />
            <Bar dataKey="ebit" name="EBIT Margin" fill="#10b981" />
            <Bar dataKey="net" name="Net Margin" fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Reading guide */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-2">What to look for</h4>
        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <li><span className="font-semibold">Gross margin compression →</span> input cost pressure or pricing weakness — most concerning</li>
          <li><span className="font-semibold">EBITDA → EBIT gap widening →</span> rising D&A from heavy CapEx — check capital allocation tab</li>
          <li><span className="font-semibold">EBIT → PBT gap widening →</span> rising debt cost or finance squeeze</li>
          <li><span className="font-semibold">PBT → Net gap →</span> tax rate change, usually one-off (rate cut, exemption)</li>
          <li><span className="font-semibold">Stable cascade YoY →</span> mature business with predictable economics — Buffett's preferred profile</li>
        </ul>
      </div>
    </div>
  );
}

function fmtCr(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e5) return `${(n / 1e3).toFixed(1)}k Cr`;
  if (abs >= 1e3) return `${(n).toFixed(0)} Cr`;
  return `${n.toFixed(1)} Cr`;
}

function KPI({ label, value, subline, accent = "slate" }: { label: string; value: string; subline?: string; accent?: "slate" | "blue" | "emerald" | "amber" }) {
  const map = {
    slate: "text-slate-900 dark:text-slate-100",
    blue: "text-blue-700 dark:text-blue-400",
    emerald: "text-emerald-700 dark:text-emerald-400",
    amber: "text-amber-700 dark:text-amber-400",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-base font-semibold tabular-nums mt-0.5 ${map[accent]}`}>{value}</div>
      {subline && <div className="text-[10px] text-slate-500 mt-0.5">{subline}</div>}
    </div>
  );
}
