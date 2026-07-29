import { useMemo } from "react";
import { RecastPeriod, EngineConfig } from "../../engine/types";
import { AnalysisTraceabilityEnvelope } from "../../engine/analysisTraceability";
import { computeEPV } from "../../engine/grahamDoddEPV";
import { computeMoatScore, decisiveMoat } from "../../engine/moatScoring";
import { scoreCapitalAllocation, decisiveCapAlloc } from "../../engine/capitalAllocationScoring";
import { detectDistress } from "../../engine/distressDetector";
import { buildValuationCommandCenter } from "../../engine/valuationCommandCenter";
import { ACTIVE_MARKET_PACKS, analysisAsOfToday } from "../../engine/marketPacks";
import { resolveShareBasis } from "../../engine/shareCountTools";
import { generateDashboardNarrative } from "../../engine/narrativeEngine";
import { formatMoatBannerMetric } from "./moatMetricLabel";
import { earningsQualityMetric } from "./earningsQualityMetric";
import type { SanityAssessment } from "../../engine/ratioSanity";
import type { AllSegmentData } from "../../engine/segmentParser";
import type { LiveMarketDataSnapshot } from "../../engine/marketData";
import type { ITServicesSignal } from "../../engine/itServicesDetector";

import { VerdictBanner, InsightBlock, RiskFlag } from "../shared/DesignSystem";
import { ContextHeader, Metric, EmptyState, EvidenceRail, EvidenceItem, Icon, type RigorLevel } from "../shared/Primitives";
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
import useAdvancedModels from "../../hooks/useAdvancedModels";
import FadeRatePanel from "./FadeRatePanel";
import PenmanExpectedReturnPanel from "./PenmanExpectedReturnPanel";
import ReverseDCFPanel from "./ReverseDCFPanel";
import AdvancedSegmentPanel from "./AdvancedSegmentPanel";

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
  traceability?: AnalysisTraceabilityEnvelope | null | undefined;
  ratioSanity?: SanityAssessment | null | undefined;
  segmentData?: AllSegmentData | null | undefined;
  marketData?: LiveMarketDataSnapshot | null | undefined;
  /** Optional peer count for Next Steps recommendations */
  peerCount?: number | undefined;
  onNavigate?: ((tab: string) => void) | undefined;
  /**
   * Phase E3 — IT-services fingerprint. Required, though `null` is valid: the
   * moat scorer disqualifies itself for an IT-services company and `MoatPanel`
   * renders that reason, but only if the signal reaches it. Optional would make
   * forgetting it silent, and this surface turns the moat score into a verdict.
   */
  itServices: ITServicesSignal | null;
}

export default function DashboardView({ data, config, traceability = null, ratioSanity = null, segmentData = null, marketData = null, peerCount = 0, onNavigate, itServices }: Props) {
  const insufficientData = !data || data.length < 2;

  const latest = !insufficientData ? data[data.length - 1] : null;
  const prev = !insufficientData ? data[data.length - 2] : null;
  const shareBasis = !insufficientData ? resolveShareBasis(data, config) : { shares: null, source: "N/A", confidence: "LOW" as const, dilution_note: "", valuationConfig: config };
  const shares = shareBasis.shares;
  const price = marketData?.price ?? config.market_price ?? null;
  const marketCap = price != null && shares != null && shares > 0 ? (price * shares) : null; // ₹ Cr (shares in Cr)

  // ── Advanced Models ────────────────────────────────────────────────────────
  const advanced = useAdvancedModels({ data, config, segmentData, marketData, shares });

  // ── KPI computations ──────────────────────────────────────────────────────
  const roce = latest?.ratios?.ROCE ?? null;
  const pm = latest?.ratios?.PM ?? null;
  const ato = latest?.ratios?.ATO ?? null;
  const flev = latest?.ratios?.FLEV ?? null;
  // Read off the envelope rather than rebuilt here: `useAuditAnalysis` already
  // projects the card through `buildEarningsQualitySummary`, and a second
  // derivation on this surface could disagree with the Quality tab about the
  // same company.
  const earningsQuality = earningsQualityMetric(traceability?.earningsQuality);

  // Revenue growth (CAGR over available periods)
  const revenueGrowth = useMemo(() => {
    if (insufficientData || !latest) return null;
    const first = data[0]!.is.Sales;
    const last = latest.is.Sales;
    if (first <= 0 || last <= 0) return null;
    const years = data.length - 1;
    return Math.pow(last / first, 1 / years) - 1;
  }, [data, latest, insufficientData]);

  // FCF yield
  const fcfYield = useMemo(() => {
    if (!marketCap || marketCap <= 0 || !latest) return null;
    const cfo = latest.cf?.CFO ?? 0;
    const capex = Math.abs(latest.cf?.Capex ?? 0);
    const fcf = cfo - capex;
    return fcf / marketCap;
  }, [latest, marketCap]);

  // EPV
  // Packs supplied for the same reason as the command center below: this EPV is
  // printed next to that build's numbers.
  const epv = useMemo(
    () => insufficientData
      ? null
      : computeEPV(data, config, { ...ACTIVE_MARKET_PACKS, analysisAsOf: analysisAsOfToday() }),
    [data, config, insufficientData],
  );
  const epvPerShare = epv && shares != null && shares > 0 ? epv.epvEquity / shares : null;

  // Moat scorer (5-dimension Buffett/Munger framework)
  // Phase E3: `null` kw override keeps the existing resolution order (period
  // kwStructural, then the config fallback); the fourth argument is the signal
  // this surface never used to pass, so `MoatPanel`'s caveat never rendered.
  const moat = useMemo(() => computeMoatScore(data, config, null, itServices), [data, config, itServices]);

  // Capital Allocation scorer (5-dimension management quality)
  const capAlloc = useMemo(() => scoreCapitalAllocation(data, config), [data, config]);

  // Distress detector
  const distress = useMemo(() => detectDistress(data), [data]);

  // Authoritative valuation — use the same command center as the Valuation tab
  const commandCenter = useMemo(
    () => buildValuationCommandCenter({
      data,
      config,
      marketData,
      analysisStatus: null,
      segmentData: segmentData?.business ?? null,
      // Same packs the run and the Valuation tab resolve against. The comment
      // above says this uses "the same command center as the Valuation tab";
      // without these it would build the same *function* from different inputs
      // and print a different discount rate on the landing surface.
      ...ACTIVE_MARKET_PACKS,
      analysisAsOf: analysisAsOfToday(),
    }),
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

    // A moat or a capital-allocation grade the scorer marked unreliable cannot
    // drive a buy or an avoid. `MoatPanel` and `CapitalAllocationPanel` still
    // render both scores with their skip reasons — displaying is fine, deciding
    // is not.
    const decisive = decisiveMoat(moat);
    const decisiveCapital = decisiveCapAlloc(capAlloc);
    const moatScore = decisive?.compositeScore ?? null;
    const capScore = decisiveCapital?.compositeScore ?? null;
    const greatBiz = (moatScore != null && moatScore >= 75) || decisive?.moatWidth === "wide";
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

  // Rigor ladder state from traceability envelope
  const rigorCurrent: RigorLevel = (traceability?.rigor?.currentLevel as RigorLevel | undefined) ?? "syntactically-valid";
  const rigorAchieved: RigorLevel[] = (traceability?.rigor?.achievedLevels as RigorLevel[] | undefined) ?? [];

  if (insufficientData) {
    return (
      <EmptyState
        icon="chart"
        title="Load company data to see the dashboard"
        body="Upload a Capitaline ZIP or select from the library to begin analysis."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* ═══ ZONE A: CONTEXT HEADER (persistent context + rigor ladder) ═══ */}
      <ContextHeader
        ticker={ticker}
        companyType={config.company_type}
        periodCount={data.length}
        latestPeriod={latest!.period_end}
        price={price}
        marketCap={marketCap}
        rigorCurrent={rigorCurrent}
        rigorAchieved={rigorAchieved}
        verdict={verdict}
        confidence={confidence}
      />

      {/* ═══ ZONE B: HERO (verdict + KPIs + ONE chart) ═══════════════════ */}

      {/* Risk flags — only show when distress detected */}
      {distress && distress.severity !== "none" && (
        <div className="flex flex-wrap gap-2">
          {distress.equityModelsBlocked && (
            <RiskFlag severity="high" label="Equity models blocked" detail="Negative equity or severe losses make residual income models unreliable" />
          )}
          {distress.severity === "critical" && (
            <RiskFlag severity="high" label="Critical distress" detail="Multiple going-concern indicators triggered" />
          )}
          {distress.severity === "severe" && !distress.equityModelsBlocked && (
            <RiskFlag severity="medium" label="Severe distress" detail="Significant financial stress — valuations should be treated with extreme caution" />
          )}
          {distress.severity === "warning" && (
            <RiskFlag severity="low" label="Elevated stress" detail="Some indicators suggest financial pressure but not critical" />
          )}
        </div>
      )}

      {/* Verdict banner */}
      <VerdictBanner
        verdict={verdict === "buy" ? "buy" : verdict === "hold" ? "hold" : verdict === "avoid" ? "avoid" : "insufficient-data"}
        headline={verdictHeadline}
        confidence={confidence}
        metrics={[
          // Not a display-only read, despite looking like one: this sits in the
          // banner directly above the verdict, with no room for the skip reason
          // beside it. Gating the verdict without gating this would print
          // "Moat 82/100" above a verdict saying the moat was not assessed.
          { label: "Moat", value: formatMoatBannerMetric(moat) },
          { label: "Quality", value: confidence === "high" ? "High" : confidence === "medium" ? "Med" : "Low" },
          { label: "Risk", value: distress?.severity === "none" ? "Low" : distress?.severity ?? "—" },
          ...(marginOfSafety != null ? [{ label: "MoS", value: `${(marginOfSafety * 100).toFixed(0)}%` }] : []),
        ]}
      />

      {/* KPI Tiles — key numbers at a glance */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric
          label="ROCE"
          value={roce}
          format="pct"
          trend={roce != null && prev?.ratios?.ROCE != null ? roce - prev.ratios.ROCE : null}
          onClick={() => onNavigate?.("ratios")}
        />
        <Metric
          label="Revenue Growth"
          value={revenueGrowth}
          format="pct"
          context={`${data.length - 1}Y CAGR`}
          onClick={() => onNavigate?.("statements")}
        />
        <Metric
          label="FCF Yield"
          value={fcfYield}
          format="pct"
          onClick={() => onNavigate?.("valuation")}
        />
        <Metric
          label="Intrinsic Value"
          value={intrinsicRange?.mid ?? null}
          format="currency"
          context={intrinsicRange ? `₹${intrinsicRange.floor.toFixed(0)}–${intrinsicRange.ceiling.toFixed(0)}` : undefined}
          onClick={() => onNavigate?.("valuation")}
        />
      </div>

      {/* ONE hero chart: Valuation Range Gauge */}
      <ValuationRangeGauge
        price={price}
        floor={epvPerShare ?? intrinsicRange?.floor ?? null}
        ceiling={intrinsicRange?.ceiling ?? null}
        midpoint={intrinsicRange?.mid ?? null}
      />

      {/* ═══ ZONE C: EVIDENCE RAIL (collapsed sections) ═══════════════════ */}
      <EvidenceRail title="Supporting Evidence">
        <EvidenceItem summary={`Narrative: ${narrative ? narrative.slice(0, 80) + "…" : "No narrative generated"}`}>
          {narrative && <InsightBlock text={narrative} icon="📖" />}
        </EvidenceItem>

        <EvidenceItem summary={`Period Delta: ${latest && prev ? `${latest.period_end.slice(0, 4)} vs ${prev.period_end.slice(0, 4)}` : "—"}`}>
          <PeriodDeltaStrip data={data} />
        </EvidenceItem>

        <EvidenceItem summary={`Penman Decomposition: ROCE ${roce != null ? (roce * 100).toFixed(1) + "%" : "—"}`}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PenmanDecompositionChart data={data} />
            <ValuationTriangulation
              price={price}
              epvPerShare={epvPerShare}
              intrinsicRange={intrinsicRange}
              marketCap={marketCap}
            />
          </div>
        </EvidenceItem>

        <EvidenceItem summary={`Investment Thesis: ${verdict.toUpperCase()}`}>
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
        </EvidenceItem>

        {/* `EvidenceItem` is `defaultOpen = false`, so this summary is visible
            while `MoatPanel` — and therefore the skip reason — is collapsed out
            of sight. Same slot shape as the banner metric, same gate. */}
        <EvidenceItem summary={`Economic Moat: ${formatMoatBannerMetric(moat)}`}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MoatPanel moat={moat} />
            <CapitalAllocationPanel result={capAlloc} />
          </div>
        </EvidenceItem>

        {segmentData && (segmentData.business?.segments?.length ?? 0) + (segmentData.geographic?.segments?.length ?? 0) + (segmentData.mixed?.segments?.length ?? 0) > 1 && (
          <EvidenceItem summary={`Segment Breakdown: ${(segmentData.business?.segments?.length ?? 0) + (segmentData.geographic?.segments?.length ?? 0)} segments`}>
            {segmentData.business && segmentData.business.segments.length > 1 && (
              <SegmentBreakdown segmentData={segmentData.business} />
            )}
            {segmentData.geographic && segmentData.geographic.segments.length > 1 && (
              <SegmentBreakdown segmentData={segmentData.geographic} />
            )}
            {segmentData.mixed && segmentData.mixed.segments.length > 1 && (
              <SegmentBreakdown segmentData={segmentData.mixed} />
            )}
          </EvidenceItem>
        )}

        <EvidenceItem summary={`Quality Signals: ${confidence} confidence`}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <QualitySignalPanel
              traceability={traceability}
              ratioSanity={ratioSanity}
              segmentData={segmentData}
              marketData={marketData}
            />
            <div className="grid grid-cols-2 gap-4">
              <Metric label="Profit Margin" value={pm} format="pct" />
              <Metric label="Asset Turnover" value={ato} format="mult" />
              <Metric label="Fin. Leverage" value={flev} format="mult" />
              {/* Was `traceability.parserFidelity.score / 100` — the syntactic
                  read-fidelity score, which `QualitySignalPanel` to the left of
                  this grid already renders under its own name. So one number
                  appeared twice on one screen, the second time as a different
                  analytical concept, and "Earnings Quality 96.0%" told a reviewer
                  the accruals had been checked when nothing had checked them. */}
              <Metric
                label="Earnings Quality"
                value={earningsQuality.value}
                context={earningsQuality.context}
              />
            </div>
          </div>
        </EvidenceItem>

        <EvidenceItem summary="Advanced Models: Penman E[R], Reverse DCF, Fade Rate, Segment Intelligence">
          <div className="space-y-6">
            <PenmanExpectedReturnPanel penmanReturn={advanced.penmanReturn} accountingAnchor={advanced.accountingAnchor} />
            <ReverseDCFPanel reverseDCF={advanced.reverseDCF} />
            <FadeRatePanel fadeRate={advanced.fadeRate} />
            <AdvancedSegmentPanel segmentRNOA={advanced.segmentRNOA} capitalAllocation={advanced.capitalAllocation} conglomerateDiscount={advanced.conglomerateDiscount} />
          </div>
        </EvidenceItem>
      </EvidenceRail>

      {/* Next Steps */}
      {(() => {
        const distressed = distress?.equityModelsBlocked || distress?.severity === "severe" || distress?.severity === "critical";
        // Same gate as the verdict memo above — Next Steps recommends actions
        // off this verdict, so it must not reach a conclusion the verdict won't.
        const decisive = decisiveMoat(moat);
        const decisiveCapital = decisiveCapAlloc(capAlloc);
        const moatScore = decisive?.compositeScore ?? null;
        const capScore = decisiveCapital?.compositeScore ?? null;
        const greatBiz = (moatScore != null && moatScore >= 75) || decisive?.moatWidth === "wide";
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

      {/* Print button */}
      <div className="flex items-center justify-end gap-2 no-print">
        <button
          type="button"
          onClick={() => window.print()}
          className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 font-medium border border-slate-200 dark:border-slate-700 transition-colors"
          title="Print or save as PDF"
        >
          <Icon name="printer" size={12} className="inline mr-1" />
          Print / Save as PDF
        </button>
      </div>
    </div>
  );
}
