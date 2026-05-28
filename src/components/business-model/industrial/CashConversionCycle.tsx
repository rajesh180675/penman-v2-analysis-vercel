/**
 * Cash Conversion Cycle (Industrial)
 *
 * CCC = Days Inventory Outstanding (DIO)
 *     + Days Sales Outstanding (DSO)
 *     − Days Payable Outstanding (DPO)
 *
 *   DIO = Inventory / (COGS / 365)
 *   DSO = Receivables / (Sales / 365)
 *   DPO = Payables / (COGS / 365)
 *
 * Negative CCC (Amazon, Costco) = supplier-financed growth = wonderful.
 * Rising CCC = working capital eating cash even when profits look fine.
 */
import { useMemo } from "react";
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import type { RecastPeriod } from "../../../engine/types";

interface Props { recastData: RecastPeriod[] }

export default function CashConversionCycle({ recastData }: Props) {
  const rows = useMemo(() => {
    return recastData.map((p) => {
      const sales = p.is?.Sales ?? 0;
      const cogs = p.is?.COGS ?? 0;
      const inventory = p.bs?.Inventory ?? 0;
      const receivables = p.bs?.TradeReceivables ?? 0;
      const payables = p.bs?.TradePayables ?? 0;

      const dio = cogs > 0 ? (inventory / cogs) * 365 : null;
      const dso = sales > 0 ? (receivables / sales) * 365 : null;
      const dpo = cogs > 0 ? (payables / cogs) * 365 : null;
      const ccc = dio != null && dso != null && dpo != null ? dio + dso - dpo : null;

      return {
        period: p.period_end.slice(0, 7),
        dio: dio != null ? +dio.toFixed(1) : null,
        dso: dso != null ? +dso.toFixed(1) : null,
        dpo: dpo != null ? -dpo.toFixed(1) : null, // negative for stacking
        ccc: ccc != null ? +ccc.toFixed(1) : null,
      };
    });
  }, [recastData]);

  const latest = rows[rows.length - 1];
  const first = rows.find((r) => r.ccc != null);

  const cccTrend = useMemo(() => {
    if (!first || !latest || first.ccc == null || latest.ccc == null) return null;
    return latest.ccc - first.ccc;
  }, [first, latest]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KPI label="DIO" value={latest?.dio != null ? `${latest.dio.toFixed(0)} days` : "—"} subline="inventory days" accent="blue" />
        <KPI label="DSO" value={latest?.dso != null ? `${latest.dso.toFixed(0)} days` : "—"} subline="receivables days" accent="emerald" />
        <KPI label="DPO" value={latest?.dpo != null ? `${(-latest.dpo).toFixed(0)} days` : "—"} subline="payables days (subtracted)" accent="amber" />
        <KPI label="CCC" value={latest?.ccc != null ? `${latest.ccc.toFixed(0)} days` : "—"}
             subline={latest?.ccc != null && latest.ccc < 0 ? "negative — supplier-financed" : "working capital intensity"}
             accent={latest?.ccc != null && latest.ccc < 0 ? "emerald" : latest?.ccc != null && latest.ccc > 90 ? "rose" : "slate"} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Cash Conversion Components Over Time</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">DIO + DSO − DPO. Bars stack to the CCC line.</p>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={rows} stackOffset="sign">
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: "Days", angle: -90, position: "left", fontSize: 11 }} />
            <Tooltip
              formatter={(v: number | undefined, name: string | undefined) => {
                const val = v ?? 0;
                if (name === "DPO") return [`${Math.abs(val).toFixed(0)} days (subtracted)`, name ?? ""];
                return [`${val.toFixed(0)} days`, name ?? ""];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#64748b" />
            <Bar dataKey="dio" name="DIO" stackId="a" fill="#3b82f6" />
            <Bar dataKey="dso" name="DSO" stackId="a" fill="#10b981" />
            <Bar dataKey="dpo" name="DPO" stackId="a" fill="#f59e0b" />
            <Line dataKey="ccc" name="CCC" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {cccTrend != null && (
        <div className={`rounded-xl border p-4 ${
          cccTrend < -10 ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20" :
          cccTrend > 10 ? "border-rose-200 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/20" :
          "border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/40"
        }`}>
          <h3 className={`text-sm font-semibold ${
            cccTrend < -10 ? "text-emerald-900 dark:text-emerald-300" :
            cccTrend > 10 ? "text-rose-900 dark:text-rose-300" :
            "text-slate-700 dark:text-slate-300"
          }`}>
            CCC trend ({first?.period} → {latest?.period}): {cccTrend > 0 ? "+" : ""}{cccTrend.toFixed(0)} days
          </h3>
          <p className="text-xs mt-1 text-slate-600 dark:text-slate-400">
            {cccTrend < -10
              ? "Working capital intensity improving — cash being released. Either better collections, lower inventory, or supplier financing."
              : cccTrend > 10
              ? "Working capital intensity worsening — cash trapped. Could be channel stuffing, slowing collections, or inventory build-up."
              : "Working capital roughly stable — operations consistent."}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-2">Reading the cash cycle</h4>
        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <li><span className="font-semibold">CCC &lt; 0</span> — supplier-financed business (Costco, Amazon retail). Best in the world.</li>
          <li><span className="font-semibold">CCC 0–60 days</span> — efficient, capital-light operations.</li>
          <li><span className="font-semibold">CCC 60–120 days</span> — normal manufacturing, distribution.</li>
          <li><span className="font-semibold">CCC &gt; 120 days</span> — capital-intensive, working-capital-heavy. Real estate, capital goods.</li>
          <li><span className="font-semibold">Rising DSO</span> with flat sales → quality of revenue declining (channel stuffing, weak collections).</li>
          <li><span className="font-semibold">Rising DIO</span> with flat sales → demand slowing or inventory obsolescence risk.</li>
        </ul>
      </div>
    </div>
  );
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
