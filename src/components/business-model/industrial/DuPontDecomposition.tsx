/**
 * DuPont 5-Step Decomposition (Industrial)
 *
 * ROE = Tax Burden × Interest Burden × EBIT Margin × Asset Turnover × Leverage
 *
 *   Tax Burden     = Net Income / PBT          (1 − effective tax rate)
 *   Interest Burden= PBT / EBIT                (1 − interest drag share)
 *   EBIT Margin    = EBIT / Sales              (operating profitability)
 *   Asset Turnover = Sales / Avg Assets        (capital efficiency)
 *   Leverage       = Avg Assets / Avg Equity   (financial gearing)
 *
 * The product equals ROE. This view shows each multiplier's evolution
 * so you can see WHICH component drives ROE up or down across years.
 */
import { useMemo } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import type { RecastPeriod } from "../../../engine/types";

interface Props { recastData: RecastPeriod[] }

interface Row {
  period: string;
  taxBurden: number | null;
  interestBurden: number | null;
  ebitMargin: number | null;
  assetTurnover: number | null;
  leverage: number | null;
  roe: number | null;
  roeProduct: number | null;
}

export default function DuPontDecomposition({ recastData }: Props) {
  const rows: Row[] = useMemo(() => {
    return recastData.map((p, i) => {
      const prev = recastData[i - 1];
      const sales = p.is?.Sales ?? null;
      const pat = p.is?.PAT ?? null;
      const pbt = pat != null && p.is?.taxRate != null && p.is.taxRate < 1
        ? pat / (1 - p.is.taxRate)
        : null;
      const ebit = (p.is?.OI ?? null);
      const avgAssets = prev ? ((p.bs?.TA ?? 0) + (prev.bs?.TA ?? 0)) / 2 : p.bs?.TA ?? null;
      const avgEquity = prev ? ((p.bs?.CSE ?? 0) + (prev.bs?.CSE ?? 0)) / 2 : p.bs?.CSE ?? null;

      const taxBurden = pat != null && pbt != null && pbt > 0 ? pat / pbt : null;
      const interestBurden = pbt != null && ebit != null && ebit > 0 ? pbt / ebit : null;
      const ebitMargin = ebit != null && sales && sales > 0 ? ebit / sales : null;
      const assetTurnover = sales != null && avgAssets && avgAssets > 0 ? sales / avgAssets : null;
      const leverage = avgAssets != null && avgEquity && avgEquity > 0 ? avgAssets / avgEquity : null;

      const roe = pat != null && avgEquity && avgEquity > 0 ? pat / avgEquity : null;
      const roeProduct = [taxBurden, interestBurden, ebitMargin, assetTurnover, leverage]
        .every((x) => x != null)
        ? (taxBurden! * interestBurden! * ebitMargin! * assetTurnover! * leverage!)
        : null;

      return {
        period: p.period_end.slice(0, 7),
        taxBurden, interestBurden, ebitMargin, assetTurnover, leverage, roe, roeProduct,
      };
    });
  }, [recastData]);

  const latest = rows[rows.length - 1];
  const first = rows.find((r) => r.roe != null);

  // Driver ranking: which component changed most between first and latest?
  const drivers = useMemo(() => {
    if (!first || !latest) return [];
    const fields: { key: keyof Row; label: string; format: (v: number) => string }[] = [
      { key: "taxBurden",      label: "Tax Burden",      format: (v) => v.toFixed(2) },
      { key: "interestBurden", label: "Interest Burden", format: (v) => v.toFixed(2) },
      { key: "ebitMargin",     label: "EBIT Margin",     format: (v) => `${(v * 100).toFixed(1)}%` },
      { key: "assetTurnover",  label: "Asset Turnover",  format: (v) => `${v.toFixed(2)}x` },
      { key: "leverage",       label: "Leverage",        format: (v) => `${v.toFixed(2)}x` },
    ];
    return fields
      .map((f) => {
        const a = first[f.key] as number | null;
        const b = latest[f.key] as number | null;
        if (a == null || b == null || a === 0) return null;
        const pctChange = (b - a) / Math.abs(a);
        return { ...f, from: a, to: b, pctChange };
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange));
  }, [first, latest]);

  return (
    <div className="space-y-4">
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <KPI label="ROE (latest)" value={latest.roe != null ? `${(latest.roe * 100).toFixed(1)}%` : "—"} accent="emerald" />
          <KPI label="Tax Burden" value={latest.taxBurden?.toFixed(2) ?? "—"} subline="NI/PBT" />
          <KPI label="Interest Burden" value={latest.interestBurden?.toFixed(2) ?? "—"} subline="PBT/EBIT" />
          <KPI label="EBIT Margin" value={latest.ebitMargin != null ? `${(latest.ebitMargin * 100).toFixed(1)}%` : "—"} subline="EBIT/Sales" />
          <KPI label="Asset Turnover" value={latest.assetTurnover != null ? `${latest.assetTurnover.toFixed(2)}x` : "—"} subline="Sales/Assets" />
          <KPI label="Leverage" value={latest.leverage != null ? `${latest.leverage.toFixed(2)}x` : "—"} subline="Assets/Equity" />
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Five Multipliers Over Time</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Bars show each component (margin/turnover/leverage). Line shows ROE actual.
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={rows.map((r) => ({
            period: r.period,
            "EBIT Margin %": r.ebitMargin != null ? +(r.ebitMargin * 100).toFixed(2) : null,
            "Asset Turnover x": r.assetTurnover != null ? +r.assetTurnover.toFixed(2) : null,
            "Leverage x": r.leverage != null ? +r.leverage.toFixed(2) : null,
            "ROE %": r.roe != null ? +(r.roe * 100).toFixed(2) : null,
          }))}>
            <CartesianGrid stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="L" tick={{ fontSize: 11 }} label={{ value: "% / x", angle: -90, position: "left", fontSize: 11 }} />
            <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 11 }} label={{ value: "ROE %", angle: 90, position: "right", fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="L" dataKey="EBIT Margin %" fill="#10b981" />
            <Bar yAxisId="L" dataKey="Asset Turnover x" fill="#3b82f6" />
            <Bar yAxisId="L" dataKey="Leverage x" fill="#f59e0b" />
            <Line yAxisId="R" dataKey="ROE %" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 4 }} />
            <ReferenceLine yAxisId="R" y={15} stroke="#94a3b8" strokeDasharray="3 3" label={{ value: "15% benchmark", fontSize: 10 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {drivers.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-300 mb-3">
            What's driving ROE change ({first?.period} → {latest?.period})
          </h3>
          <div className="space-y-1.5">
            {drivers.map((d, i) => (
              <div key={d.key} className="flex items-center gap-2 text-xs">
                <span className="text-[10px] font-mono w-4 text-slate-500">#{i + 1}</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300 w-32">{d.label}</span>
                <span className="text-slate-500 font-mono">{d.format(d.from)} → {d.format(d.to)}</span>
                <span className={`ml-auto font-mono tabular-nums font-semibold ${
                  d.pctChange > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                }`}>
                  {d.pctChange > 0 ? "+" : ""}{(d.pctChange * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-2">Reading the decomposition</h4>
        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <li><span className="font-semibold">Margin-driven ROE</span> (rising EBIT margin) → pricing power, scale, mix improvement. Most durable.</li>
          <li><span className="font-semibold">Turnover-driven ROE</span> (rising asset turnover) → operating leverage on existing assets. Real productivity.</li>
          <li><span className="font-semibold">Leverage-driven ROE</span> (rising assets/equity) → buybacks or debt-funded growth. Often unsustainable; raises risk.</li>
          <li><span className="font-semibold">Tax/interest changes</span> → one-offs (tax holidays, refinancing). Strip these to see operational reality.</li>
        </ul>
      </div>
    </div>
  );
}

function KPI({ label, value, subline, accent = "slate" }: { label: string; value: string; subline?: string | undefined; accent?: "slate" | "emerald" }) {
  const tone = accent === "emerald" ? "text-emerald-700 dark:text-emerald-400" : "text-slate-900 dark:text-slate-100";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-base font-semibold tabular-nums mt-0.5 ${tone}`}>{value}</div>
      {subline && <div className="text-[10px] text-slate-500 mt-0.5">{subline}</div>}
    </div>
  );
}
