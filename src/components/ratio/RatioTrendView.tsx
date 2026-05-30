import { RecastPeriod } from "../../engine/types";
import { Section, Th } from "./atoms";

export function RatioTrendView({rd}:{rd:RecastPeriod[]}) {
  return (
    <Section title="Horizontal & Trend Analysis (C-03)" subtitle="YoY % change | 3-year CAGR | N&P Table 3 context">
      <div className="overflow-x-auto mb-5">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 border-b border-slate-200">
            <Th left>Line Item</Th>
            {rd.slice(1).map(d => <Th key={d.period_end}>{d.period_end.slice(0,7)} YoY</Th>)}
            {rd.length >= 3 && <Th>3Y CAGR</Th>}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {[
              { label: "Sales", fn: (d: typeof rd[0]) => d.is.Sales },
              { label: "Operating Income (OI)", fn: (d: typeof rd[0]) => d.is.OI },
              { label: "Core OI", fn: (d: typeof rd[0]) => d.cu.CoreOI },
              { label: "CNI", fn: (d: typeof rd[0]) => d.is.CNI },
              { label: "CFO", fn: (d: typeof rd[0]) => d.cf.CFO },
              { label: "Total Assets", fn: (d: typeof rd[0]) => d.bs.TA },
              { label: "NOA", fn: (d: typeof rd[0]) => d.bs.NOA },
              { label: "CSE", fn: (d: typeof rd[0]) => d.bs.CSE },
              { label: "NFO", fn: (d: typeof rd[0]) => d.bs.NFO },
              { label: "Trade Receivables", fn: (d: typeof rd[0]) => d.bs.TradeReceivables },
              { label: "Inventories", fn: (d: typeof rd[0]) => d.bs.Inventory },
              { label: "PPE", fn: (d: typeof rd[0]) => d.bs.PPE },
            ].map(({ label, fn }) => {
              const vals = rd.map(fn);
              const yoys = rd.slice(1).map((_, i) => {
                const prev = vals[i], cur = vals[i + 1]!;
                if (!prev || prev === 0) return null;
                return (cur - prev) / Math.abs(prev);
              });
              const first = vals[0]!, last = vals[vals.length - 1]!;
              const years = rd.length - 1;
              const cagr3 = first > 0 && last > 0 && years >= 2
                ? Math.pow(last / first, 1 / years) - 1 : null;
              return (
                <tr key={label} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-xs text-slate-700 whitespace-nowrap">{label}</td>
                  {yoys.map((v, i) => (
                    <td key={i} className={`px-3 py-2 text-right font-mono text-xs ${v == null ? "text-slate-400" : v >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`}
                    </td>
                  ))}
                  {rd.length >= 3 && (
                    <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${cagr3 == null ? "text-slate-400" : cagr3 >= 0 ? "text-indigo-700" : "text-red-600"}`}>
                      {cagr3 == null ? "—" : `${cagr3 >= 0 ? "+" : ""}${(cagr3 * 100).toFixed(1)}%`}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 border">
        <strong>Reading Guide:</strong> YoY column shows (Current − Prior) / |Prior|. A consistently positive
        OI CAGR exceeding Sales CAGR suggests margin expansion. Rising NOA growth vs Sales growth may indicate
        asset-intensity risk (N&P 2001 §4 — high NOA growth dilutes RNOA if PM doesn't increase commensurately).
      </div>
    </Section>
  );
}
