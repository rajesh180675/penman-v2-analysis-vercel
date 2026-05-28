/**
 * Capital Allocation (Industrial)
 *
 * Of every rupee of operating cash flow, where does it go?
 *   - CapEx              (reinvestment in business)
 *   - Acquisitions       (M&A, when reported separately)
 *   - Dividends Paid     (to shareholders)
 *   - Buybacks           (return via reduction)
 *   - Debt Repaid        (deleveraging)
 *   - Cash retained      (treasury build-up)
 *
 * Buffett's #1 management evaluation: "What does the CEO do with cash?"
 * Best capital allocators: high-IRR reinvestment, opportunistic buybacks
 * (only at low P/B), modest dividends, debt-shy.
 */
import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import type { RecastPeriod } from "../../../engine/types";

interface Props { recastData: RecastPeriod[] }

export default function CapitalAllocation({ recastData }: Props) {
  const rows = useMemo(() => {
    return recastData.map((p) => {
      const cfo = p.cf?.CFO ?? 0;
      const capex = Math.abs(p.cf?.Capex ?? 0);
      const dividends = Math.abs(p.cf?.DividendPaid ?? 0);
      const buybacks = Math.abs(p.cf?.ShareBuybacks ?? 0);
      const equityRaised = Math.abs(p.cf?.EquityIssued ?? 0);
      const totalDeployed = capex + dividends + buybacks;
      const retained = cfo - totalDeployed;
      return {
        period: p.period_end.slice(0, 7),
        cfo,
        capex,
        dividends,
        buybacks,
        equityRaised,
        retained: retained > 0 ? retained : 0,
        debtRaised: retained < 0 ? -retained : 0,
        capexPct: cfo > 0 ? (capex / cfo) * 100 : 0,
        divPct: cfo > 0 ? (dividends / cfo) * 100 : 0,
        bbPct: cfo > 0 ? (buybacks / cfo) * 100 : 0,
      };
    });
  }, [recastData]);

  // 5-year totals for context
  const last5 = rows.slice(-5);
  const totals = useMemo(() => {
    const sum = (k: keyof typeof rows[number]) => last5.reduce((s, r) => s + (r[k] as number), 0);
    return {
      cfo: sum("cfo"),
      capex: sum("capex"),
      dividends: sum("dividends"),
      buybacks: sum("buybacks"),
      retained: sum("retained"),
    };
  }, [last5]);

  const reinvestmentRate = totals.cfo > 0 ? (totals.capex / totals.cfo) * 100 : 0;
  const payoutRatio = totals.cfo > 0 ? ((totals.dividends + totals.buybacks) / totals.cfo) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KPI label="5y CFO" value={fmtCr(totals.cfo)} subline={`${last5.length} periods`} accent="blue" />
        <KPI label="Reinvestment %" value={`${reinvestmentRate.toFixed(0)}%`}
             subline={reinvestmentRate > 80 ? "very high reinvestment" : reinvestmentRate > 50 ? "growth phase" : reinvestmentRate > 30 ? "balanced" : "harvest phase"}
             accent={reinvestmentRate > 80 ? "amber" : "emerald"} />
        <KPI label="Payout %" value={`${payoutRatio.toFixed(0)}%`} subline="dividends + buybacks" accent="emerald" />
        <KPI label="Net Retained" value={fmtCr(totals.retained)} subline="treasury build-up" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          Where Operating Cash Flow Went (₹ Cr)
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Stacked usage of CFO each year. The shape tells you the management style.
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={rows}>
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtCr(v ?? 0)} />
            <Tooltip formatter={(v: number | undefined) => fmtCr(v ?? 0)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="capex" name="CapEx" stackId="a" fill="#3b82f6" />
            <Bar dataKey="dividends" name="Dividends" stackId="a" fill="#10b981" />
            <Bar dataKey="buybacks" name="Buybacks" stackId="a" fill="#8b5cf6" />
            <Bar dataKey="retained" name="Retained" stackId="a" fill="#94a3b8" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <h4 className="text-xs font-semibold text-emerald-900 dark:text-emerald-300 uppercase mb-2">
          Buffett's capital allocator scorecard (5y aggregate)
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          <div className="rounded-md bg-white dark:bg-slate-900/40 p-2 border border-emerald-200 dark:border-emerald-900/40">
            <div className="text-[10px] uppercase font-mono text-slate-500">CapEx / CFO</div>
            <div className="text-lg font-semibold tabular-nums text-blue-700 dark:text-blue-400">{reinvestmentRate.toFixed(0)}%</div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {reinvestmentRate > 80 ? "Heavy reinvestment — verify ROIC justifies it" :
               reinvestmentRate > 50 ? "Growth phase — check if returns scale" :
               reinvestmentRate > 25 ? "Mature reinvestment — typical for compounder" :
               "Light reinvestment — high cash return profile"}
            </div>
          </div>
          <div className="rounded-md bg-white dark:bg-slate-900/40 p-2 border border-emerald-200 dark:border-emerald-900/40">
            <div className="text-[10px] uppercase font-mono text-slate-500">Buybacks / Total Payout</div>
            <div className="text-lg font-semibold tabular-nums text-violet-700 dark:text-violet-400">
              {totals.dividends + totals.buybacks > 0 ? ((totals.buybacks / (totals.dividends + totals.buybacks)) * 100).toFixed(0) : 0}%
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Buybacks should dominate when share price &lt; intrinsic value
            </div>
          </div>
          <div className="rounded-md bg-white dark:bg-slate-900/40 p-2 border border-emerald-200 dark:border-emerald-900/40">
            <div className="text-[10px] uppercase font-mono text-slate-500">Cash Sufficiency</div>
            <div className={`text-lg font-semibold tabular-nums ${totals.retained > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
              {totals.cfo > 0 ? ((totals.retained / totals.cfo) * 100).toFixed(0) : 0}%
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {totals.retained > 0 ? "CFO funds all uses internally" : "Must raise external capital"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtCr(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e5) return `${sign}${(abs / 1e3).toFixed(1)}k Cr`;
  if (abs >= 1e3) return `${sign}${abs.toFixed(0)} Cr`;
  return `${sign}${abs.toFixed(1)} Cr`;
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
