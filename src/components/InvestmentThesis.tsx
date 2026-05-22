import { useMemo } from "react";
import type { RecastPeriod, EngineConfig } from "../engine/types";
import { computeMoatScore } from "../engine/moatScoring";
import { scoreCapitalAllocation } from "../engine/capitalAllocationScoring";
import { detectDistress } from "../engine/distressDetector";
import { computeEPV } from "../engine/grahamDoddEPV";
import { SectionHeader } from "./shared/DesignSystem";

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
}

function pct(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
}

function crFmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(1)}L Cr`;
  if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(1)}K Cr`;
  return `₹${v.toFixed(0)} Cr`;
}

/**
 * Investment Thesis — one-page summary suitable for a pitch deck or IC memo.
 * Structured as: Thesis Statement → Why Buy/Avoid → Key Numbers → Risks → What to Watch.
 */
export default function InvestmentThesis({ data, config }: Props) {
  const latest = data[data.length - 1];
  const prior = data.length >= 2 ? data[data.length - 2] : latest;
  const ticker = config.ticker ?? config.quality_data_folder ?? "Company";

  const moat = useMemo(() => computeMoatScore(data), [data]);
  const capAlloc = useMemo(() => scoreCapitalAllocation(data), [data]);
  const distress = useMemo(() => detectDistress(data), [data]);
  const epv = useMemo(() => {
    try { return computeEPV(data, config); } catch { return null; }
  }, [data, config]);

  // Core metrics
  const roce = latest.ratios?.ROCE;
  const rnoa = latest.ratios?.RNOA;
  const spread = latest.ratios?.SPREAD;
  const flev = latest.ratios?.FLEV;
  const salesGrowth = prior.is.Sales > 0 ? (latest.is.Sales - prior.is.Sales) / prior.is.Sales : null;
  const patGrowth = prior.is.PAT > 0 ? (latest.is.PAT - prior.is.PAT) / prior.is.PAT : null;
  const ccr = latest.ratios?.cash_conversion_ratio;
  const cfo = latest.cf?.CFO;
  const fcf = cfo != null && latest.cf?.Capex != null ? cfo - Math.abs(latest.cf.Capex) : null;

  // Thesis generation
  const isHighQuality = (moat?.compositeScore ?? 0) >= 60 && (capAlloc?.score ?? 0) >= 60;
  const isDistressed = distress?.severity === "critical" || distress?.severity === "severe";
  const hasMarginOfSafety = config.market_price != null && epv?.epvPerShare != null
    ? ((epv.epvPerShare - config.market_price) / config.market_price) > 0.15
    : false;

  const thesisVerdict = isDistressed ? "avoid" : isHighQuality && hasMarginOfSafety ? "buy" : isHighQuality ? "hold" : "watch";
  const thesisColors = {
    buy: "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700",
    hold: "border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700",
    watch: "border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700",
    avoid: "border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700",
  };

  // Generate thesis sentences
  const thesisSentences: string[] = [];
  if (isHighQuality) {
    thesisSentences.push(`${ticker} demonstrates durable competitive advantages with a moat score of ${moat?.compositeScore}/100 and capital allocation score of ${capAlloc?.score}/100.`);
  } else {
    thesisSentences.push(`${ticker} shows ${(moat?.compositeScore ?? 0) >= 40 ? "moderate" : "limited"} evidence of competitive moat (score: ${moat?.compositeScore ?? "—"}/100).`);
  }
  if (roce != null && rnoa != null) {
    thesisSentences.push(`Returns on equity of ${pct(roce)} are driven by operating returns (RNOA ${pct(rnoa)}) ${spread != null && spread > 0 ? "amplified" : "offset"} by financial leverage.`);
  }
  if (hasMarginOfSafety && epv?.epvPerShare != null && config.market_price != null) {
    const mos = ((epv.epvPerShare - config.market_price) / config.market_price * 100).toFixed(0);
    thesisSentences.push(`At ₹${config.market_price}, the stock trades at a ${mos}% discount to normalized earnings power (EPV ₹${epv.epvPerShare.toFixed(0)}).`);
  }
  if (isDistressed) {
    thesisSentences.push(`However, financial distress indicators are elevated — equity models may be unreliable.`);
  }

  // Strengths and risks
  const strengths: string[] = [];
  const risks: string[] = [];

  if ((moat?.compositeScore ?? 0) >= 70) strengths.push("Wide economic moat — sustainable competitive position");
  if ((capAlloc?.score ?? 0) >= 70) strengths.push("Strong capital allocation discipline");
  if (roce != null && roce > 0.20) strengths.push(`High ROCE (${pct(roce)}) well above cost of capital`);
  if (ccr != null && ccr > 0.8) strengths.push(`Strong cash conversion (${(ccr * 100).toFixed(0)}% of earnings to cash)`);
  if (salesGrowth != null && salesGrowth > 0.10) strengths.push(`Revenue momentum (+${pct(salesGrowth, 0)} YoY)`);
  if (flev != null && flev < 0) strengths.push("Net cash balance sheet — zero financial leverage risk");

  if (isDistressed) risks.push("Financial distress detected — going-concern risk");
  if (flev != null && flev > 2) risks.push(`High financial leverage (FLEV ${flev.toFixed(1)}×) — amplifies downside`);
  if (ccr != null && ccr < 0.5) risks.push("Weak cash conversion — earnings quality concern");
  if (salesGrowth != null && salesGrowth < -0.05) risks.push(`Revenue decline (${pct(salesGrowth, 0)} YoY) — demand pressure`);
  if (spread != null && spread < 0) risks.push("Negative SPREAD — borrowing costs exceed operating returns");
  if ((moat?.compositeScore ?? 0) < 40) risks.push("Limited moat evidence — vulnerable to competition");

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Investment Thesis"
        subtitle="One-page summary for IC memo or pitch deck — auto-generated from fundamental analysis"
        icon="📋"
      />

      {/* Thesis Statement */}
      <div className={`rounded-2xl border-2 p-6 ${thesisColors[thesisVerdict]}`}>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">{thesisVerdict === "buy" ? "✅" : thesisVerdict === "hold" ? "⏸️" : thesisVerdict === "watch" ? "👀" : "🛑"}</span>
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              {ticker} — {thesisVerdict === "buy" ? "Buy" : thesisVerdict === "hold" ? "Hold / Accumulate" : thesisVerdict === "watch" ? "Watchlist" : "Avoid"}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Moat {moat?.compositeScore ?? "—"}/100 · Cap Alloc {capAlloc?.score ?? "—"}/100 · {data.length} periods analyzed
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          {thesisSentences.join(" ")}
        </p>
      </div>

      {/* Key Numbers Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "ROCE", value: pct(roce), sub: "Return on equity" },
          { label: "RNOA", value: pct(rnoa), sub: "Operating return" },
          { label: "Sales Growth", value: pct(salesGrowth, 0), sub: "YoY revenue" },
          { label: "PAT Growth", value: pct(patGrowth, 0), sub: "YoY net income" },
          { label: "FLEV", value: flev != null ? `${flev.toFixed(2)}×` : "—", sub: "Financial leverage" },
          { label: "Cash Conv.", value: ccr != null ? `${(ccr * 100).toFixed(0)}%` : "—", sub: "CFO/PAT ratio" },
          { label: "FCF", value: crFmt(fcf), sub: "Free cash flow" },
          { label: "EPV/Share", value: epv?.epvPerShare != null ? `₹${epv.epvPerShare.toFixed(0)}` : "—", sub: "Earnings power" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="card-base p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">{value}</div>
            <div className="text-[10px] text-slate-400">{sub}</div>
          </div>
        ))}
      </div>

      {/* Strengths & Risks two-column */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-base p-5">
          <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 mb-3 flex items-center gap-2">
            <span>💪</span> Strengths
          </h4>
          {strengths.length === 0 ? (
            <p className="text-xs text-slate-400">No standout strengths identified from quantitative analysis</p>
          ) : (
            <ul className="space-y-1.5">
              {strengths.map((s, i) => (
                <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5">●</span> {s}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card-base p-5">
          <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-3 flex items-center gap-2">
            <span>⚠️</span> Risks
          </h4>
          {risks.length === 0 ? (
            <p className="text-xs text-slate-400">No material risks flagged from quantitative analysis</p>
          ) : (
            <ul className="space-y-1.5">
              {risks.map((r, i) => (
                <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
                  <span className="text-red-500 mt-0.5">●</span> {r}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* What to Watch */}
      <div className="card-base p-5">
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
          <span>🔭</span> What to Watch Next
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-start gap-2">
            <span className="text-indigo-500">1.</span>
            <span>Track RNOA trend — {rnoa != null && rnoa > 0.15 ? "currently strong, watch for mean reversion" : "needs improvement for re-rating"}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-indigo-500">2.</span>
            <span>Monitor cash conversion — {ccr != null && ccr > 0.8 ? "healthy, maintain" : "gap between earnings and cash needs narrowing"}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-indigo-500">3.</span>
            <span>{flev != null && flev > 1 ? "Deleverage trajectory — watch for debt reduction" : "Capital deployment — watch for ROIC on incremental investments"}</span>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-slate-400 text-center">
        Auto-generated from {data.length}-period Penman-Nissim analysis. Not investment advice. Verify with qualitative research.
      </p>
    </div>
  );
}
