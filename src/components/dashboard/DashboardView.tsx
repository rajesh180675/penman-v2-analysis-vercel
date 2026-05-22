import { useMemo } from "react";
import { RecastPeriod, EngineConfig } from "../../engine/types";
import { AnalysisTraceabilityEnvelope } from "../../engine/analysisTraceability";
import { computeEPV } from "../../engine/grahamDoddEPV";
import { computeMoatScore } from "../../engine/moatScoring";
import { scoreCapitalAllocation } from "../../engine/capitalAllocationScoring";
import { detectDistress } from "../../engine/distressDetector";
import { buildValuationCommandCenter } from "../../engine/valuationCommandCenter";
import { resolveShareBasis } from "../../engine/shareCountTools";
import { generateDashboardNarrative } from "../../engine/narrativeEngine";
import type { SanityAssessment } from "../../engine/ratioSanity";
import type { SegmentData } from "../../engine/segmentParser";
import type { LiveMarketDataSnapshot } from "../../engine/marketData";

import { VerdictBanner, InsightBlock, ExpandableSection, ConfidenceBadge } from "../shared/DesignSystem";
import KPITile from "./KPITile";
import ValuationTriangulation from "./ValuationTriangulation";
import QualitySignalPanel from "./QualitySignalPanel";
import PenmanDecompositionChart from "./PenmanDecompositionChart";
import MoatPanel from "./MoatPanel";
import CapitalAllocationPanel from "./CapitalAllocationPanel";
import InvestmentThesisCard from "./InvestmentThesisCard";
import NarrativeCard from "./NarrativeCard";
import SegmentBreakdown from "./SegmentBreakdown";
import PeriodDeltaStrip from "./PeriodDeltaStrip";
import NextStepsPanel from "./NextStepsPanel";
import ValuationRangeGauge from "../charts/ValuationRangeGauge";

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
  traceability?: AnalysisTraceabilityEnvelope | null;
  ratioSanity?: SanityAssessment | null;
  segmentData?: SegmentData | null;
  marketData?: LiveMarketDataSnapshot | null;
  /** Optional peer count for Next Steps recommendations */
  peerCount?: number;
  onNavigate?: (tab: string) => void;
}

export default function DashboardView({ data, config, traceability = null, ratioSanity = null, segmentData = null, marketData = null, peerCount = 0, onNavigate }: Props) {
  if (!data || data.length < 2) {
    return (
      <div className="card-base p-12 text-center">
        <div className="text-4xl mb-4">📊</div>
        <p className="text-lg font-semibold text-slate-600 dark:text-slate-300">Load company data to see the dashboard</p>
        <p className="text-sm text-slate-500 mt-2">Upload a Capitaline ZIP or select from the library</p>
      </div>
    );
  }

  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  const shareBasis = resolveShareBasis(data, config);
  const shares = shareBasis.shares;
  const price = marketData?.price ?? config.market_price ?? null;
  const marketCap = price != null && shares != null && shares > 0 ? (price * shares) / 1e7 : null; // ₹ Cr

  // ── KPI computations ──────────────────────────────────────────────────────
  const roce = latest.ratios?.ROCE ?? null;
  const pm = latest.ratios?.PM ?? null;
  const ato = latest.ratios?.ATO ?? null;
  const flev = latest.ratios?.FLEV ?? null;

  // Revenue growth (CAGR over available periods)
  const revenueGrowth = useMemo(() => {
    if (data.length < 2) return null;
    const first = data[0].is.Sales;
    const last = latest.is.Sales;
    if (first <= 0 || last <= 0) return null;
    const years = data.length - 1;
    return Math.pow(last / first, 1 / years) - 1;
  }, [data, latest]);

  // FCF yield
  const fcfYield = useMemo(() => {
    if (!marketCap || marketCap <= 0) return null;
    const cfo = latest.cf?.CFO ?? 0;
    const capex = Math.abs(latest.cf?.Capex ?? 0);
    const fcf = cfo - capex;
    return fcf / marketCap;
  }, [latest, marketCap]);

  // Sparkline data for key metrics
  const roceHistory = data.map(p => ({ period: p.period_end.slice(0, 4), value: p.ratios?.ROCE ?? null }));
  const revenueHistory = data.map(p => ({ period: p.period_end.slice(0, 4), value: p.is.Sales }));
  const fcfHistory = data.map(p => ({
    period: p.period_end.slice(0, 4),
    value: (p.cf?.CFO ?? 0) - Math.abs(p.cf?.Capex ?? 0),
  }));
  const pmHistory = data.map(p => ({ period: p.period_end.slice(0, 4), value: p.ratios?.PM ?? null }));

  // EPV
  const epv = useMemo(() => computeEPV(data, config), [data, config]);
  const epvPerShare = epv && shares != null && shares > 0 ? (epv.epvEquity / shares) * 1e7 : null;

  // Moat scorer (5-dimension Buffett/Munger framework)
  const moat = useMemo(() => computeMoatScore(data, config), [data, config]);

  // Capital Allocation scorer (5-dimension management quality)
  const capAlloc = useMemo(() => scoreCapitalAllocation(data, config), [data, config]);

  // Distress detector
  const distress = useMemo(() => detectDistress(data), [data]);

  // Authoritative valuation — use the same command center as the Valuation tab
  const commandCenter = useMemo(
    () => buildValuationCommandCenter({ data, config, marketData, analysisStatus: null, segmentData }),
    [data, config, marketData, segmentData],
  );

  // Intrinsic value range — from authoritative command center
  const intrinsicRange = useMemo(() => {
    const floor = commandCenter.range?.floorPerShare ?? null;
    const ceiling = commandCenter.range?.ceilingPerShare ?? null;
    if (floor == null && ceiling == null) return null;
    const f = floor ?? ceiling ?? 0;
    const c = ceiling ?? floor ?? 0;
    return { floor: f, ceiling: c, mid: (f + c) / 2 };
  }, [commandCenter.range]);

  // ── Verdict computation ───────────────────────────────────────────────────
  const marginOfSafety = price != null && intrinsicRange?.mid != null && price > 0
    ? (intrinsicRange.mid - price) / price
    : null;

  const verdict = useMemo(() => {
    const distressed = distress?.equityModelsBlocked || distress?.severity === "severe" || distress?.severity === "critical";
    if (distressed) return "avoid" as const;

    const moatScore = moat?.compositeScore ?? null;
    const capScore = capAlloc?.compositeScore ?? null;
    const greatBiz = (moatScore != null && moatScore >= 75) || moat?.moatWidth === "wide";
    const goodBiz = moatScore != null && moatScore >= 60;
    const greatMgmt = capScore != null && capScore >= 75;
    const goodMgmt = capScore != null && capScore >= 60;
    const cheap = marginOfSafety != null && marginOfSafety > 0.25;
    const fair = marginOfSafety != null && marginOfSafety > 0.0 && marginOfSafety <= 0.25;
    const expensive = marginOfSafety != null && marginOfSafety <= 0.0;

    if (greatBiz && greatMgmt && cheap) return "buy" as const;
    if (goodBiz && goodMgmt && (fair || cheap)) return "buy" as const;
    if (greatBiz && (cheap || fair)) return "buy" as const;
    if (moatScore != null && capScore != null && (moatScore < 35 || capScore < 35)) return "avoid" as const;
    if (expensive && !(greatBiz && greatMgmt)) return "avoid" as const;
    return "hold" as const;
  }, [distress, moat, capAlloc, marginOfSafety]);

  // ── Narrative generation ───────────────────────────────────────────────────
  const narrative = useMemo(() => {
    return generateDashboardNarrative(data, config);
  }, [data, config]);

  // ── Confidence level ──────────────────────────────────────────────────────
  const confidence: "high" | "medium" | "low" = useMemo(() => {
    const score = traceability?.parserFidelity?.score ?? 0;
    const fwCount = commandCenter.scenarios.length;
    if (score >= 85 && fwCount >= 3) return "high";
    if (score >= 60 || fwCount >= 2) return "medium";
    return "low";
  }, [traceability, commandCenter.scenarios.length]);

  // ── Verdict headline ──────────────────────────────────────────────────────
  const ticker = config.ticker ?? config.quality_data_folder ?? "Company";
  const verdictHeadline = useMemo(() => {
    if (verdict === "buy" && marginOfSafety != null) {
      return `${ticker} trades at ${(marginOfSafety * 100).toFixed(0)}% discount to intrinsic value (${intrinsicRange ? `₹${intrinsicRange.mid.toFixed(0)}` : "—"} vs ₹${price?.toFixed(0) ?? "—"})`;
    }
    if (verdict === "avoid" && distress?.equityModelsBlocked) {
      return `${ticker} shows signs of financial distress — equity valuation unreliable`;
    }
    if (verdict === "avoid" && marginOfSafety != null && marginOfSafety < 0) {
      return `${ticker} trades ${Math.abs(marginOfSafety * 100).toFixed(0)}% above intrinsic value — limited upside`;
    }
    if (verdict === "hold") {
      return `${ticker} trades near fair value — wait for a better entry or exit point`;
    }
    return `${ticker} — analysis complete`;
  }, [verdict, ticker, marginOfSafety, intrinsicRange, price, distress]);

  return (
    <div className="space-y-6">
      {/* ═══ TIER 1: VERDICT (always visible first) ═══════════════════════════ */}

      {/* Company context strip */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
            <span className="font-bold text-indigo-700 dark:text-indigo-300 text-sm">{ticker.slice(0, 3)}</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">{ticker}</h1>
            <p className="text-xs text-slate-500">
              {config.company_type ?? "Industrial"} · {data.length} periods · {latest.period_end.slice(0, 4)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {price != null && (
            <div className="text-right">
              <p className="font-mono text-lg font-bold text-slate-800 dark:text-slate-100">₹{price.toFixed(0)}</p>
              <p className="text-xs text-slate-500">{marketCap ? `₹${marketCap.toFixed(0)} Cr MCap` : "Market Price"}</p>
            </div>
          )}
          <ConfidenceBadge level={confidence} />
        </div>
      </div>

      {/* Verdict banner */}
      <VerdictBanner
        verdict={verdict === "buy" ? "buy" : verdict === "hold" ? "hold" : verdict === "avoid" ? "avoid" : "insufficient-data"}
        headline={verdictHeadline}
        confidence={confidence}
        metrics={[
          { label: "Moat", value: moat ? `${moat.compositeScore}/100` : "—" },
          { label: "Quality", value: confidence === "high" ? "High" : confidence === "medium" ? "Med" : "Low" },
          { label: "Risk", value: distress?.severity === "none" ? "Low" : distress?.severity ?? "—" },
          ...(marginOfSafety != null ? [{ label: "MoS", value: `${(marginOfSafety * 100).toFixed(0)}%` }] : []),
        ]}
      />

      {/* KPI Tiles — key numbers at a glance */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPITile
          label="ROCE"
          value={roce}
          format="pct"
          history={roceHistory}
          trend={roce != null && prev?.ratios?.ROCE != null ? roce - prev.ratios.ROCE : null}
          onClick={() => onNavigate?.("ratios")}
        />
        <KPITile
          label="Revenue Growth"
          value={revenueGrowth}
          format="pct"
          subtitle={`${data.length - 1}Y CAGR`}
          history={revenueHistory}
          onClick={() => onNavigate?.("statements")}
        />
        <KPITile
          label="FCF Yield"
          value={fcfYield}
          format="pct"
          history={fcfHistory}
          onClick={() => onNavigate?.("valuation")}
        />
        <KPITile
          label="Intrinsic Value"
          value={intrinsicRange?.mid ?? null}
          format="currency"
          subtitle={intrinsicRange ? `₹${intrinsicRange.floor.toFixed(0)}–${intrinsicRange.ceiling.toFixed(0)}` : undefined}
          onClick={() => onNavigate?.("valuation")}
        />
      </div>

      {/* ═══ TIER 2: WHY (supporting evidence) ════════════════════════════════ */}

      {/* Narrative insight — plain English explanation */}
      {narrative && <InsightBlock text={narrative} icon="📖" />}

      {/* Period delta — what changed since last year */}
      <PeriodDeltaStrip data={data} />

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PenmanDecompositionChart data={data} />
        <ValuationTriangulation
          price={price}
          epvPerShare={epvPerShare}
          intrinsicRange={intrinsicRange}
          marketCap={marketCap}
        />
      </div>

      {/* Value Range Gauge */}
      <ValuationRangeGauge
        price={price}
        floor={epvPerShare ?? intrinsicRange?.floor ?? null}
        ceiling={intrinsicRange?.ceiling ?? null}
        midpoint={intrinsicRange?.mid ?? null}
      />

      {/* Print button */}
      <div className="flex items-center justify-end gap-2 no-print">
        <button
          type="button"
          onClick={() => window.print()}
          className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 font-medium border border-slate-200 dark:border-slate-700 transition-colors"
          title="Print or save as PDF"
        >
          🖨️ Print / Save as PDF
        </button>
      </div>

      {/* ═══ TIER 3: DEEP DIVE (expandable sections) ══════════════════════════ */}

      {/* Investment Thesis — detailed buy/hold/avoid reasoning */}
      <ExpandableSection title="Investment Thesis" badge={verdict.toUpperCase()} defaultOpen={false}>
        <InvestmentThesisCard
          moat={moat}
          capAlloc={capAlloc}
          distress={distress}
          marginOfSafety={marginOfSafety}
          price={price}
          intrinsic={intrinsicRange?.mid ?? null}
        />
        <div className="mt-4">
          <NarrativeCard
            data={data}
            companyId={ticker}
            moat={moat}
            capAlloc={capAlloc}
            distress={distress}
            marginOfSafety={marginOfSafety}
            revenueGrowth={revenueGrowth}
            fcfYield={fcfYield}
          />
        </div>
      </ExpandableSection>

      {/* Economic Moat + Capital Allocation */}
      <ExpandableSection title="Economic Moat & Management Quality" badge={moat ? `${moat.compositeScore}/100` : undefined}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MoatPanel moat={moat} />
          <CapitalAllocationPanel result={capAlloc} />
        </div>
      </ExpandableSection>

      {/* Segment Breakdown — only shows if segment data is present */}
      {segmentData && segmentData.segments && segmentData.segments.length > 1 && (
        <ExpandableSection title="Segment Breakdown" badge={`${segmentData.segments.length} segments`}>
          <SegmentBreakdown segmentData={segmentData} />
        </ExpandableSection>
      )}

      {/* Quality + Additional KPIs */}
      <ExpandableSection title="Quality Signals & Supporting Ratios" badge={`${confidence} confidence`}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <QualitySignalPanel
            traceability={traceability}
            ratioSanity={ratioSanity}
            segmentData={segmentData}
            marketData={marketData}
          />
          <div className="grid grid-cols-2 gap-4">
            <KPITile label="Profit Margin" value={pm} format="pct" history={pmHistory} />
            <KPITile label="Asset Turnover" value={ato} format="mult" />
            <KPITile label="Fin. Leverage" value={flev} format="mult" />
            <KPITile
              label="Earnings Quality"
              value={traceability?.parserFidelity?.score != null ? traceability.parserFidelity.score / 100 : null}
              format="pct"
            />
          </div>
        </div>
      </ExpandableSection>

      {/* Next Steps */}
      {(() => {
        const distressed = distress?.equityModelsBlocked || distress?.severity === "severe" || distress?.severity === "critical";
        const moatScore = moat?.compositeScore ?? null;
        const capScore = capAlloc?.compositeScore ?? null;
        const greatBiz = (moatScore != null && moatScore >= 75) || moat?.moatWidth === "wide";
        const greatMgmt = capScore != null && capScore >= 75;
        const goodBiz = moatScore != null && moatScore >= 60;
        const goodMgmt = capScore != null && capScore >= 60;
        const cheap = marginOfSafety != null && marginOfSafety > 0.25;
        const fair = marginOfSafety != null && marginOfSafety > 0.0 && marginOfSafety <= 0.25;
        const expensive = marginOfSafety != null && marginOfSafety <= 0.0;

        let nextVerdict: "screaming-buy" | "buy" | "hold" | "avoid" | "distressed" = "hold";
        if (distressed) nextVerdict = "distressed";
        else if (greatBiz && greatMgmt && cheap) nextVerdict = "screaming-buy";
        else if (goodBiz && goodMgmt && (fair || cheap)) nextVerdict = "buy";
        else if (greatBiz && (cheap || fair)) nextVerdict = "buy";
        else if (moatScore != null && capScore != null && (moatScore < 35 || capScore < 35)) nextVerdict = "avoid";
        else if (expensive && !(greatBiz && greatMgmt)) nextVerdict = "avoid";

        return (
          <NextStepsPanel
            verdict={nextVerdict}
            hasPeers={peerCount > 1}
            onNavigate={onNavigate}
          />
        );
      })()}
    </div>
  );
}
