import { CompanyRegistry, EngineConfig, NP_BENCHMARKS, ke_from_config } from "../engine/types";
import { computeValuation, deriveKwFromStructure } from "../engine/PenmanNissimEngine";
import { useCallback, useMemo, useState } from "react";
import { buildValuationTraceabilitySurfaceSummary } from "../engine/valuationTraceabilitySummary";
import TraceabilityTrustPanel from "./TraceabilityTrustPanel";
import { buildComparisonPublicationSnapshot, type ComparisonPublicationSnapshot } from "../lib/publication/comparisonPublicationSnapshot";
import { resolveNseSymbol } from "../engine/nseSymbolRegistry";
import PeerScatterPlot from "./charts/PeerScatterPlot";
import PercentileBar from "./charts/PercentileBar";
import SectorHeatmap from "./charts/SectorHeatmap";
import { computePeerRelativeValuation } from "../engine/peerRelativeValuation";

interface Props {
  registry: CompanyRegistry;
  config: EngineConfig;
  weakestTraceabilitySummary?: ReturnType<typeof buildValuationTraceabilitySurfaceSummary> | null;
  publication?: ComparisonPublicationSnapshot | null;
}

const METRICS = ["ROCE", "RNOA", "PM", "ATO", "FLEV", "SPREAD"] as const;

function percentileRank(values: number[], x: number) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const lessEq = s.filter((v) => v <= x).length;
  return lessEq / s.length;
}

export default function ComparisonReport({ registry, config, weakestTraceabilitySummary: precomputedWeakestSummary = null, publication = null }: Props) {
  const companies = Object.values(registry.companies).filter((c) => c.recastData.length > 0);
  if (companies.length < 2) {
    return <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-800">Load at least 2 companies to enable peer comparison.</div>;
  }

  const comparisonPublication = publication ?? buildComparisonPublicationSnapshot(registry);
  const comparisonSummary = precomputedWeakestSummary
    ? { ...comparisonPublication.comparisonSummary, ...precomputedWeakestSummary }
    : comparisonPublication.comparisonSummary;
  const blockedCount = comparisonPublication.blockedCount;
  const guardedCount = comparisonPublication.guardedCount;
  const weakestCompany = comparisonPublication.weakestCompanyId
    ? companies.find((company) => company.id === comparisonPublication.weakestCompanyId) ?? null
    : null;
  const latestByCo = companies.map((c) => ({ company: c.label || c.id, id: c.id, latest: c.recastData[c.recastData.length - 1], series: c.recastData }));
  const [marketInputs, setMarketInputs] = useState<Record<string, { price: number; shares: number }>>({});
  const [sortByUpside, setSortByUpside] = useState(true);
  const [nseLoading, setNseLoading] = useState(false);

  // Peer relative valuation (Phase G)
  const peerRelative = useMemo(() => {
    const firstCompanyId = latestByCo[0]?.id;
    if (!firstCompanyId) return null;
    return computePeerRelativeValuation(firstCompanyId, registry, config);
  }, [latestByCo, registry, config]);

  const fetchNsePrices = useCallback(async () => {
    setNseLoading(true);
    const updates: Record<string, { price: number; shares: number }> = { ...marketInputs };
    for (const c of latestByCo) {
      const symbol = resolveNseSymbol(c.id) ?? resolveNseSymbol(c.company);
      if (!symbol) continue;
      try {
        const res = await fetch(`/api/market-data/snapshot?provider=nse&symbol=${encodeURIComponent(symbol)}`);
        if (!res.ok) continue;
        const payload = await res.json();
        const snapshot = payload?.snapshot;
        if (snapshot?.price != null) {
          const shares = snapshot.sharesOutstanding != null
            ? snapshot.sharesOutstanding / 1e7  // NSE returns absolute count, we need Cr
            : updates[c.id]?.shares ?? 0;
          updates[c.id] = { price: snapshot.price, shares };
        }
      } catch { /* skip failures */ }
    }
    setMarketInputs(updates);
    setNseLoading(false);
  }, [latestByCo, marketInputs]);

  const baseValuationRows = useMemo(() => {
    const ke = ke_from_config(config);
    const g = 0.05;
    return latestByCo.map((c) => {
      const n = c.series.length;
      const kw = n >= 2
        ? deriveKwFromStructure(c.series[n - 1], c.series[n - 2], ke, config.risk_free_rate, config)
        : config.risk_free_rate;
      const localCfg: EngineConfig = { ...config };
      const v = computeValuation(c.series, ke, kw, g, localCfg);
      const re = v.V_RE_CV3;
      const reoi = v.V_ReOI_CV03;
      const fcff = v.fcf ? v.fcf.EV_FCFF - v.NFO_latest : null;
      const fcfe = v.fcf?.V_FCFE ?? null;
      const ddmPerShare = v.perShare?.intrinsic_ddm_per_share ?? null;
      const aeg = v.aeg?.V_AEG ?? null;
      const intrinsicPerShare = v.perShare?.intrinsic_re_per_share ?? null;
      return { id: c.id, company: c.company, re, reoi, fcff, fcfe, ddmPerShare, aeg, intrinsicPerShare };
    });
  }, [latestByCo, config]);

  const valuationRows = useMemo(() => {
    return baseValuationRows.map((base) => {
      const inp = marketInputs[base.id] ?? { price: 0, shares: 0 };
      const ddm = base.ddmPerShare != null && inp.shares > 0 ? base.ddmPerShare * inp.shares : null;
      const upside = base.intrinsicPerShare != null && inp.price > 0 ? (base.intrinsicPerShare / inp.price - 1) : null;
      return { ...base, ddm, price: inp.price, shares: inp.shares, upside };
    }).sort((a, b) => {
      if (!sortByUpside) return a.company.localeCompare(b.company);
      const av = a.upside ?? -Infinity;
      const bv = b.upside ?? -Infinity;
      return bv - av;
    });
  }, [baseValuationRows, marketInputs, sortByUpside]);

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
      {comparisonSummary && (
        <TraceabilityTrustPanel
          title="Comparison Trust Gate"
          summary={comparisonSummary}
          confidenceStatus={weakestCompany?.traceability?.confidence.status ?? null}
          rigorLabel={weakestCompany?.traceability?.rigor.currentLabel ?? null}
          parserStatus={weakestCompany?.traceability?.parserFidelity.status ?? null}
          reconciliationStatus={weakestCompany?.traceability?.reconciliation.status ?? null}
          cautionHeading="Review these peer-level trust blockers before using the comparison output as a ranking or valuation decision surface."
          aside={(
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
              <div className="font-semibold uppercase tracking-wide text-slate-500">Peer trust counts</div>
              <div className="mt-2 space-y-1">
                <div>{companies.length} peers loaded</div>
                <div>{companies.length - comparisonPublication.missingTraceabilityCount} with persisted traceability</div>
                <div>{blockedCount} blocked</div>
                <div>{guardedCount} guarded</div>
              </div>
            </div>
          )}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-2">Per-Company Trust State</h2>
        <p className="text-xs text-slate-500 mb-4">Cross-company rankings inherit the trust level of each loaded peer. Review parser fidelity, reconciliation status, and the next unresolved gate before comparing upside or percentile ranks.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Company</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Confidence</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Rigor level</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Parser fidelity</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Reconciliation</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Next unresolved gate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((company) => {
                const traceability = company.traceability ?? null;
                const summary = comparisonPublication.companySummaries[company.id] ?? null;
                return (
                  <tr key={company.id}>
                    <td className="px-3 py-2 font-medium text-slate-700">{company.label || company.id}</td>
                    <td className="px-3 py-2">
                      <StatusPill tone={traceability?.confidence.tone ?? "amber"}>{traceability?.confidence.status ?? "missing"}</StatusPill>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{traceability?.rigor.currentLabel ?? "Traceability missing"}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {traceability ? `${traceability.parserFidelity.status} · ${traceability.parserFidelity.score}/100` : "Traceability missing"}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {traceability ? `${traceability.reconciliation.status} · ${formatPct(traceability.reconciliation.maxResidualRatio)}` : "Traceability missing"}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{summary?.nextGateLine ?? "Reprocess this company in the current rigor-aware flow."}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={fetchNsePrices} disabled={nseLoading} className="px-4 py-2 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 disabled:opacity-50">
          {nseLoading ? "Fetching NSE…" : "Auto-fill from NSE"}
        </button>
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
                  <td className="px-3 py-2 text-right font-mono">₹{Number.isFinite(r.re) ? (r.re as number).toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}</td>
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
      {/* Sector Heatmap — companies x ratios matrix, color-coded by quartile */}
      {(() => {
        const heatmapCompanies = latestByCo.map(c => ({
          companyId: c.id,
          label: c.company,
          metrics: {
            ROCE: c.latest?.ratios?.ROCE ?? null,
            RNOA: c.latest?.ratios?.RNOA ?? null,
            PM: c.latest?.ratios?.PM ?? null,
            ATO: c.latest?.ratios?.ATO ?? null,
            FLEV: c.latest?.ratios?.FLEV ?? null,
            CoreSalesPM: c.latest?.ratios?.CoreSalesPM ?? null,
          },
        }));
        return (
          <SectorHeatmap
            companies={heatmapCompanies}
            metrics={[
              { key: "ROCE", label: "ROCE", direction: "higher-better", format: "pct" },
              { key: "RNOA", label: "RNOA", direction: "higher-better", format: "pct" },
              { key: "PM", label: "PM", direction: "higher-better", format: "pct" },
              { key: "ATO", label: "ATO", direction: "higher-better", format: "mult" },
              { key: "FLEV", label: "FLEV", direction: "lower-better", format: "mult" },
              { key: "CoreSalesPM", label: "Core PM", direction: "higher-better", format: "pct" },
            ]}
          />
        );
      })()}

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

      {/* Visual Peer Charts */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Peer Relative Valuation Panel (Phase G) */}
        {peerRelative && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Peer Relative Valuation</h2>
                <p className="text-xs text-slate-500 mt-1">{peerRelative.peerCount} peers · Multiple-implied fair values from sector medians</p>
              </div>
              {peerRelative.compositeMarginOfSafety != null && (
                <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${peerRelative.compositeMarginOfSafety > 0.15 ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : peerRelative.compositeMarginOfSafety > 0 ? "bg-amber-50 text-amber-700 border border-amber-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  }`}>
                  Composite MoS: {(peerRelative.compositeMarginOfSafety * 100).toFixed(1)}%
                </span>
              )}
            </div>
            {peerRelative.multipleImplied.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {peerRelative.multipleImplied.map((m, i) => (
                  <div key={i} className="rounded-xl bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">{m.metric} implied</div>
                    <div className="text-lg font-bold text-slate-900">
                      {m.impliedFairValue != null ? `₹${m.impliedFairValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}
                    </div>
                    <div className="text-[10px] text-slate-400">Peer median: {m.peerMedianMultiple?.toFixed(1) ?? "—"}×</div>
                  </div>
                ))}
              </div>
            )}
            {peerRelative.compositeFairValue != null && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800">
                Composite fair value (median of implied): <strong>₹{peerRelative.compositeFairValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</strong>
              </div>
            )}
          </div>
        )}
        <PeerScatterPlot
          companies={latestByCo.map((c, i) => ({
            name: c.company,
            x: c.latest?.ratios?.ROCE ?? 0,
            y: (() => {
              const inp = marketInputs[c.id];
              if (!inp?.price || !inp?.shares || inp.shares <= 0) return 0;
              const cse = c.latest?.bs?.CSE ?? 0;
              return (inp.price * inp.shares * 1e7) / (cse > 0 ? cse : 1);
            })(),
            isTarget: i === 0,
          }))}
          xLabel="ROCE"
          yLabel="P/B"
          xFormat="pct"
          yFormat="mult"
        />
        <PeerScatterPlot
          companies={latestByCo.map((c, i) => ({
            name: c.company,
            x: c.latest?.ratios?.PM ?? 0,
            y: c.latest?.ratios?.ATO ?? 0,
            isTarget: i === 0,
          }))}
          xLabel="Profit Margin"
          yLabel="Asset Turnover"
          xFormat="pct"
          yFormat="mult"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PercentileBar
          title="ROCE Ranking"
          format="pct"
          entries={latestByCo.map((c, i) => {
            const vals = latestByCo.map(x => x.latest?.ratios?.ROCE).filter((v): v is number => v != null && Number.isFinite(v));
            const v = c.latest?.ratios?.ROCE ?? 0;
            return { label: c.company, value: v, percentile: (percentileRank(vals, v) ?? 0) * 100, isTarget: i === 0 };
          })}
        />
        <PercentileBar
          title="Upside Ranking"
          format="pct"
          entries={valuationRows.map((r, i) => ({
            label: r.company,
            value: r.upside ?? 0,
            percentile: (() => {
              const upsides = valuationRows.map(x => x.upside).filter((v): v is number => v != null);
              return (percentileRank(upsides, r.upside ?? -Infinity) ?? 0) * 100;
            })(),
            isTarget: i === 0,
          }))}
        />
      </div>
    </div>
  );
}

function formatPct(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}


function StatusPill({ children, tone }: { children: string; tone: string }) {
  const className = tone === "red"
    ? "border-red-200 bg-red-50 text-red-700"
    : tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-amber-200 bg-amber-50 text-amber-700";
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${className}`}>{children}</span>;
}
