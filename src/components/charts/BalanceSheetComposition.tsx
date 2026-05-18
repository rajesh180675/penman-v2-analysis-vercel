import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import type { RecastPeriod } from "../../engine/types";

interface Props {
  data: RecastPeriod[];
  mode?: "abs" | "common";
}

/**
 * Balance Sheet Composition — stacked bar showing how the asset/financing
 * mix has evolved year-over-year. Reveals structural shifts that are
 * invisible in tables (asset growth, leverage swings, working-capital build).
 */
export default function BalanceSheetComposition({ data, mode = "abs" }: Props) {
  if (!data || data.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Balance Sheet Composition</h3>
        <p className="text-xs text-slate-500 mt-2">Need at least 2 periods of data.</p>
      </div>
    );
  }

  const assetSeries = data.map(p => {
    const ta = p.bs.TA, oa = p.bs.OA, fa = p.bs.FA;
    if (mode === "common" && ta > 0) {
      return { period: p.period_end.slice(0, 7), OA: +(oa / ta * 100).toFixed(1), FA: +(fa / ta * 100).toFixed(1) };
    }
    return { period: p.period_end.slice(0, 7), OA: +oa.toFixed(0), FA: +fa.toFixed(0) };
  });

  const financingSeries = data.map(p => {
    const ta = p.bs.TA, cse = p.bs.CSE, nfo = p.bs.NFO, ol = p.bs.OL;
    if (mode === "common" && ta > 0) {
      return {
        period: p.period_end.slice(0, 7),
        CSE: +(cse / ta * 100).toFixed(1),
        NFO: +(nfo / ta * 100).toFixed(1),
        OL:  +(ol / ta * 100).toFixed(1),
      };
    }
    return {
      period: p.period_end.slice(0, 7),
      CSE: +cse.toFixed(0), NFO: +nfo.toFixed(0), OL: +ol.toFixed(0),
    };
  });

  const fmt = (v: number) =>
    mode === "common" ? `${v?.toFixed(1)}%` : `₹${v?.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;

  const latest = data[data.length - 1];
  const ta = latest.bs.TA;
  const showLatest = ta > 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Balance Sheet Composition</h3>
        <p className="text-xs text-slate-500">
          Asset and financing mix over time {mode === "common" ? "(% of Total Assets)" : "(₹ Cr)"}.
          Reveals structural shifts — leverage swings, asset growth, working-capital build-up.
        </p>
      </div>

      <div className="h-56">
        <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Asset Side: Operating vs Financial Assets</h4>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={assetSeries} margin={{ left: 5, right: 10, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
            <XAxis dataKey="period" fontSize={10} />
            <YAxis fontSize={10} tickFormatter={(v) => mode === "common" ? `${v}%` : `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(value: number, name: string) => [fmt(value), name]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="OA" name="Operating Assets" stackId="assets" fill="#10b981" />
            <Bar dataKey="FA" name="Financial Assets" stackId="assets" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="h-56">
        <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Financing Side: Equity vs Net Financial Debt vs Operating Liabilities</h4>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={financingSeries} margin={{ left: 5, right: 10, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
            <XAxis dataKey="period" fontSize={10} />
            <YAxis fontSize={10} tickFormatter={(v) => mode === "common" ? `${v}%` : `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(value: number, name: string) => [fmt(value), name]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="CSE" name="Common Shareholders' Equity" stackId="fin" fill="#6366f1" />
            <Bar dataKey="NFO" name="Net Financial Obligations" stackId="fin" fill="#ef4444" />
            <Bar dataKey="OL"  name="Operating Liabilities" stackId="fin" fill="#94a3b8" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {showLatest && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 p-2">
            <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Operating Asset %</div>
            <div className="font-bold text-slate-900 dark:text-slate-100">{((latest.bs.OA / ta) * 100).toFixed(0)}%</div>
          </div>
          <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/30 p-2">
            <div className="text-[10px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Equity %</div>
            <div className="font-bold text-slate-900 dark:text-slate-100">{((latest.bs.CSE / ta) * 100).toFixed(0)}%</div>
          </div>
          <div className="rounded-lg bg-red-50 dark:bg-red-900/30 p-2">
            <div className="text-[10px] uppercase tracking-wide text-red-700 dark:text-red-300">Net Fin. Debt %</div>
            <div className={`font-bold ${(latest.bs.NFO / ta) * 100 > 30 ? "text-red-700" : "text-slate-900 dark:text-slate-100"}`}>
              {((latest.bs.NFO / ta) * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
