import { useMemo } from "react";
import { RecastPeriod, EngineConfig, ke_from_config } from "../../engine/types";
import { AnalysisTraceabilityEnvelope } from "../../engine/analysisTraceability";
import { computeEPV } from "../../engine/grahamDoddEPV";
import { computeMoatScore } from "../../engine/moatScoring";
import { scoreCapitalAllocation } from "../../engine/capitalAllocationScoring";
import { detectDistress } from "../../engine/distressDetector";
import { buildValuationCommandCenter } from "../../engine/valuationCommandCenter";
import { resolveShareBasis } from "../../engine/shareCountTools";
import type { SanityAssessment } from "../../engine/ratioSanity";
import type { SegmentData } from "../../engine/segmentParser";
import type { LiveMarketDataSnapshot } from "../../engine/marketData";
import CompanyHeaderCard from "./CompanyHeaderCard";
import KPITile from "./KPITile";
import ValuationTriangulation from "./ValuationTriangulation";
import QualitySignalPanel from "./QualitySignalPanel";
import PenmanDecompositionChart from "./PenmanDecompositionChart";
import MoatPanel from "./MoatPanel";
import CapitalAllocationPanel from "./CapitalAllocationPanel";
import InvestmentThesisCard from "./InvestmentThesisCard";
import NarrativeCard from "./NarrativeCard";
import ValuationRangeGauge from "../charts/ValuationRangeGauge";

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
  traceability?: AnalysisTraceabilityEnvelope | null;
  ratioSanity?: SanityAssessment | null;
  segmentData?: SegmentData | null;
  marketData?: LiveMarketDataSnapshot | null;
  onNavigate?: (tab: string) => void;
}

export default function DashboardView({ data, config, traceability = null, ratioSanity = null, segmentData = null, marketData = null, onNavigate }: Props) {
  if (!data || data.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center dark:border-slate-700 dark:bg-slate-900/40">
        <p className="text-lg font-semibold text-slate-600 dark:text-slate-300">Load company data to see the dashboard</p>
        <p className="text-sm text-slate-500 mt-2">Upload a Capitaline ZIP or select from the library</p>
      </div>
    );
  }

  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  const ke = ke_from_config(config);
  const shareBasis = resolveShareBasis(data, config);
  const shares = shareBasis.shares;
  const price = marketData?.price ?? config.market_price ?? null;
  const marketCap = price != null && shares > 0 ? (price * shares) / 1e7 : null; // ₹ Cr

  // ── KPI computations ──────────────────────────────────────────────────────
  const roce = latest.ratios?.ROCE ?? null;
  const pm = latest.ratios?.PM ?? null;
  const ato = latest.ratios?.ATO ?? null;
  const flev = latest.ratios?.FLEV ?? null;
  const rnoa = latest.ratios?.RNOA ?? null;

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
  const pmHistory = data.map(p => ({ period: p.period_end.slice(0, 4), value: p.ratios?.PM ?? null }));
  const revenueHistory = data.map(p => ({ period: p.period_end.slice(0, 4), value: p.is.Sales }));
  const fcfHistory = data.map(p => ({
    period: p.period_end.slice(0, 4),
    value: (p.cf?.CFO ?? 0) - Math.abs(p.cf?.Capex ?? 0),
  }));

  // EPV
  const epv = useMemo(() => computeEPV(data, config), [data, config]);
  const epvPerShare = epv && shares > 0 ? (epv.epvEquity / shares) * 1e7 : null; // ₹ Cr → per share

  // Moat scorer (5-dimension Buffett/Munger framework)
  const moat = useMemo(() => computeMoatScore(data, config), [data, config]);

  // Capital Allocation scorer (5-dimension management quality)
  const capAlloc = useMemo(() => scoreCapitalAllocation(data, config), [data, config]);

  // Distress detector
  const distress = useMemo(() => detectDistress(data), [data]);

  // Authoritative valuation — use the same command center as the Valuation tab
  // so the Dashboard verdict and Valuation tab agree.
  const commandCenter = useMemo(
    () => buildValuationCommandCenter({ data, config, marketData, analysisStatus: null, segmentData }),
    [data, config, marketData, segmentData],
  );

  // Intrinsic value range — from authoritative command center (matches Valuation tab)
  const intrinsicRange = useMemo(() => {
    const floor = commandCenter.range?.floorPerShare ?? null;
    const ceiling = commandCenter.range?.ceilingPerShare ?? null;
    if (floor == null && ceiling == null) return null;
    const f = floor ?? ceiling ?? 0;
    const c = ceiling ?? floor ?? 0;
    return {
      floor: f,
      ceiling: c,
      mid: (f + c) / 2,
    };
  }, [commandCenter.range]);

  return (
    <div className="space-y-6">
      {/* Company Header */}
      <CompanyHeaderCard
        companyId={config.ticker ?? config.quality_data_folder ?? "—"}
        companyType={config.company_type ?? "auto"}
        price={price}
        marketCap={marketCap}
        traceability={traceability}
        ratioSanity={ratioSanity}
        segmentCount={segmentData?.segments?.length ?? 0}
      />

      {/* Investment Thesis — single buy/hold/avoid verdict */}
      <InvestmentThesisCard
        moat={moat}
        capAlloc={capAlloc}
        distress={distress}
        marginOfSafety={
          price != null && intrinsicRange?.mid != null && price > 0
            ? (intrinsicRange.mid - price) / price
            : null
        }
        price={price}
        intrinsic={intrinsicRange?.mid ?? null}
      />

      {/* Narrative Card — plain-English synthesis */}
      <NarrativeCard
        data={data}
        companyId={config.ticker ?? config.quality_data_folder ?? "This company"}
        moat={moat}
        capAlloc={capAlloc}
        distress={distress}
        marginOfSafety={
          price != null && intrinsicRange?.mid != null && price > 0
            ? (intrinsicRange.mid - price) / price
            : null
        }
        revenueGrowth={revenueGrowth}
        fcfYield={fcfYield}
      />

      {/* KPI Tiles Row */}
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

      {/* Economic Moat Panel — Buffett/Munger 5-dimension framework */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MoatPanel moat={moat} />
        <CapitalAllocationPanel result={capAlloc} />
      </div>

      {/* Quality + Ratio Sanity Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <QualitySignalPanel
          traceability={traceability}
          ratioSanity={ratioSanity}
          segmentData={segmentData}
          marketData={marketData}
        />
        {/* Additional KPI row */}
        <div className="grid grid-cols-2 gap-4">
          <KPITile label="Profit Margin" value={pm} format="pct" history={pmHistory} />
          <KPITile label="Asset Turnover" value={ato} format="mult" />
          <KPITile label="Fin. Leverage" value={flev} format="mult" />
          <KPITile
            label="Earnings Quality"
            value={traceability?.parserFidelity?.fidelityPct != null ? traceability.parserFidelity.fidelityPct / 100 : null}
            format="pct"
          />
        </div>
      </div>
    </div>
  );
}
