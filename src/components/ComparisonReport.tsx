import { CompanyRegistry, EngineConfig, NP_BENCHMARKS, ke_from_config } from "../engine/types";
import { computeValuation, deriveKwFromStructure } from "../engine/PenmanNissimEngine";
import { useMemo, useState } from "react";

interface Props {
  registry: CompanyRegistry;
  config: EngineConfig;
}

const METRICS = ["ROCE", "RNOA", "PM", "ATO", "FLEV", "SPREAD"] as const;

function percentileRank(values: number[], x: number) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const lessEq = s.filter((v) => v <= x).length;
  return lessEq / s.length;
}

export default function ComparisonReport({ registry, config }: Props) {
  const companies = Object.values(registry.companies);
  if (companies.length < 2) {
    return <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-800">Load at least 2 companies to enable peer comparison.</div>;
  }

  const latestByCo = companies.map((c) => ({ company: c.label || c.id, id: c.id, latest: c.recastData[c.recastData.length - 1], series: c.recastData }));
  const [marketInputs, setMarketInputs] = useState<Record<string, { price: number; shares: number }>>({});
  const [sortByUpside, setSortByUpside] = useState(true);

  const valuationRows = useMemo(() => {
    const ke = ke_from_config(config);
    const g = 0.05;
    return latestByCo.map((c) => {
      const n = c.series.length;
      const kw = n >= 2
        ? deriveKwFromStructure(c.series[n - 1], c.series[n - 2], ke, config.risk_free_rate, config)
        : config.risk_free_rate;
      const inp = marketInputs[c.id] ?? { price: 0, shares: 0 };
      const localCfg: EngineConfig = { ...config, market_price: inp.price || undefined, shares_outstanding: inp.shares || undefined };
      const v = computeValuation(c.series, ke, kw, g, localCfg);
      const re = v.V_RE_CV3;
      const reoi = v.V_ReOI_CV03;
      const fcff = v.fcf ? v.fcf.EV_FCFF - v.NFO_latest : null;
      const fcfe = v.fcf?.V_FCFE ?? null;
      const ddm = v.perShare?.intrinsic_ddm_per_share != null && inp.shares > 0 ? v.perShare.intrinsic_ddm_per_share * inp.shares : null;
      const aeg = v.aeg?.V_AEG ?? null;
      const intrinsicPerShare = v.perShare?.intrinsic_re_per_share ?? null;
      const upside = intrinsicPerShare != null && inp.price > 0 ? (intrinsicPerShare / inp.price - 1) : null;
      return { id: c.id, company: c.company, re, reoi, fcff, fcfe, ddm, aeg, price: inp.price, shares: inp.shares, intrinsicPerShare, upside };
    }).sort((a, b) => {
      if (!sortByUpside) return a.company.localeCompare(b.company);
      const av = a.upside ?? -Infinity;
      const bv = b.upside ?? -Infinity;
      return bv - av;
    });
  }, [latestByCo, marketInputs, sortByUpside, config]);

  const exportPanelCsv = () => {
    const header = ["company_id", "company_label", "period_end", "ROCE", "RNOA", "PM", "ATO", "FLEV", "SPREAD", "NBC", "OLLEV", "OLSPREAD", "current_ratio", "quick_ratio"];
    const rows: string[] = [header.join(",")];
    for (const c of companies) {
      for (const p of c.recastData) {
        const r = p.ratios;
        rows.push([
          c.id,
          `"${(c.label || c.id).replace(/"/g, '""')}"`,
          p.period_end,
          r?.ROCE ?? "",
          r?.RNOA ?? "",
          r?.PM ?? "",
          r?.ATO ?? "",
          r?.FLEV ?? "",
          r?.SPREAD ?? "",
          r?.NBC ?? "",
          r?.OLLEV ?? "",
          r?.OLSPREAD ?? "",
          r?.current_ratio ?? "",
          r?.quick_ratio ?? "",
        ].join(","));
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "panel_timeseries_cross_section.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2">
        <button onClick={() => setSortByUpside((v) => !v)} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50">
          Sort: {sortByUpside ? "Upside ↓" : "Company A→Z"}
        </button>
        <button onClick={exportPanelCsv} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
          Export Panel CSV (F-06)
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-2">Valuation Comparison Panel (F-04)</h2>
        <p className="text-xs text-slate-500 mb-4">All 6 model outputs per company (₹ Cr). Enter market price + shares to compute implied upside from RE-CV3 per-share value.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Company</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Market Price</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Shares (Cr)</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">RE (CV3)</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">ReOI (CV03)</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">FCFF</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">FCFE</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">DDM</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">AEG</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Intrinsic / Share</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Upside</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {valuationRows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-medium text-slate-700">{r.company}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.1"
                      value={marketInputs[r.id]?.price ?? ""}
                      onChange={(e) => setMarketInputs((prev) => ({ ...prev, [r.id]: { price: Number(e.target.value), shares: prev[r.id]?.shares ?? 0 } }))}
                      className="w-24 px-2 py-1 border border-slate-300 rounded text-xs text-right"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={marketInputs[r.id]?.shares ?? ""}
                      onChange={(e) => setMarketInputs((prev) => ({ ...prev, [r.id]: { price: prev[r.id]?.price ?? 0, shares: Number(e.target.value) } }))}
                      className="w-24 px-2 py-1 border border-slate-300 rounded text-xs text-right"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">₹{Number.isFinite(r.re) ? r.re.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">₹{Number.isFinite(r.reoi) ? r.reoi.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.fcff != null ? `₹${r.fcff.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.fcfe != null ? `₹${r.fcfe.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.ddm != null ? `₹${r.ddm.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.aeg != null ? `₹${r.aeg.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.intrinsicPerShare != null ? `₹${r.intrinsicPerShare.toFixed(2)}` : "—"}</td>
                  <td className={`px-3 py-2 text-right font-mono ${r.upside != null ? (r.upside >= 0 ? "text-emerald-700" : "text-red-700") : "text-slate-400"}`}>
                    {r.upside != null ? `${(r.upside * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-2">Peer Ratio Comparison (Cross-Section)</h2>
        <p className="text-xs text-slate-500 mb-4">Rows are core Nissim–Penman ratios; columns are loaded companies. N&P median shown for anchor context.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Metric</th>
                {latestByCo.map((c) => (
                  <th key={c.company} className="px-3 py-2 text-right text-xs uppercase text-slate-500">{c.company}</th>
                ))}
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">N&P Median</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {METRICS.map((m) => {
                const vals = latestByCo
                  .map((c) => c.latest?.ratios?.[m as keyof NonNullable<typeof c.latest.ratios>] as number | null)
                  .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
                return (
                  <tr key={m}>
                    <td className="px-3 py-2 font-medium text-slate-700">{m}</td>
                    {latestByCo.map((c) => {
                      const v = c.latest?.ratios?.[m as keyof NonNullable<typeof c.latest.ratios>] as number | null;
                      const p = v != null ? percentileRank(vals, v) : null;
                      const bg = p == null ? "" : p >= 0.75 ? "bg-emerald-50" : p <= 0.25 ? "bg-red-50" : "bg-amber-50";
                      return (
                        <td key={c.company + m} className={`px-3 py-2 text-right font-mono ${bg}`}>
                          {v == null ? "—" : m === "ATO" || m === "FLEV" ? `${v.toFixed(2)}x` : `${(v * 100).toFixed(1)}%`}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right text-slate-500 font-mono">
                      {m === "ATO" || m === "FLEV"
                        ? `${NP_BENCHMARKS[m].median.toFixed(2)}x`
                        : `${(NP_BENCHMARKS[m].median * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h3 className="text-base font-bold text-slate-800 mb-2">Cross-Section Percentile Ranking (latest period)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Company</th>
                {METRICS.map((m) => (
                  <th key={m} className="px-3 py-2 text-right text-xs uppercase text-slate-500">{m} pctile</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {latestByCo.map((c) => (
                <tr key={c.company}>
                  <td className="px-3 py-2 font-medium text-slate-700">{c.company}</td>
                  {METRICS.map((m) => {
                    const vals = latestByCo
                      .map((x) => x.latest?.ratios?.[m as keyof NonNullable<typeof x.latest.ratios>] as number | null)
                      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
                    const v = c.latest?.ratios?.[m as keyof NonNullable<typeof c.latest.ratios>] as number | null;
                    const p = v != null ? percentileRank(vals, v) : null;
                    return <td key={c.company + m} className="px-3 py-2 text-right font-mono">{p == null ? "—" : `${(p * 100).toFixed(0)}%`}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
