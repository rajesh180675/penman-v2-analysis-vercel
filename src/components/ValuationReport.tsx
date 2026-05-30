import { useEffect, useMemo, useRef, useState } from "react";
import { RecastPeriod, EngineConfig } from "../engine/types";
import { INRAbsolute } from "../engine/types/units";
import { buildCyclicalNormalization } from "../engine/cyclicalNormalization";
import { detectDistress } from "../engine/distressDetector";
import { computeValuation, deriveKwFromStructure } from "../engine/PenmanNissimEngine";
import { ke_from_config } from "../engine/types";
import { buildRegimeContext } from "../engine/regimeModel";
import { calibrateSignalBacktest } from "../engine/signalBacktest";
import { buildTerminalEconomics } from "../engine/terminalEconomics";
import { resolveValuationReadiness } from "../engine/valuationPolicy";
import { resolveShareBasis } from "../engine/shareCountTools";
import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { buildValuationCommandCenter } from "../engine/valuationCommandCenter";
import { SignalPill } from "./valuation/atoms";
import { useLiveMarketData } from "../hooks/useLiveMarketData";
import { resolveNseSymbol } from "../engine/nseSymbolRegistry";
import { AuditSubmissionMeta, persistAuditEvent } from "../lib/audit";
import { computeMoatScore } from "../engine/moatScoring";
import { rememberWorkspaceValuation } from "../lib/researchWorkspace";
import { syncWorkspaceAlert, syncWorkspaceValuation } from "../lib/sharedResearchApi";
import { AnalysisTraceabilityEnvelope } from "../engine/analysisTraceability";
import { buildValuationTraceabilitySurfaceSummary } from "../engine/valuationTraceabilitySummary";
import TraceabilityTrustPanel from "./TraceabilityTrustPanel";
import type { AnalysisPublicationSnapshot } from "../lib/publication/analysisPublicationSnapshot";
import type { LossMakerValuationResult } from "../engine/lossMakerValuation";
import type { SanityAssessment } from "../engine/ratioSanity";
import type { AllSegmentData } from "../engine/segmentParser";
import { type CVMethod, fmt, makeCvSel } from "./valuation/ValuationReport.formatters";
import {
  buildAlertAuditPayload,
  buildManifestAuditPayload,
  buildReSeriesBarData,
  buildSignalAuditPayload,
  buildSparklineData,
  deriveCyclicalTerminalREAnchor,
} from "./valuation/ValuationReport.hooks";
import ValuationCommandCenterHero from "./valuation/ValuationCommandCenterHero";
import SensitivityGrid from "./valuation/SensitivityGrid";
import DistressBanner from "./valuation/DistressBanner";
import RatioSanityPanel from "./valuation/RatioSanityPanel";
import LossMakerPanel from "./valuation/LossMakerPanel";
import SignalEngineSection from "./valuation/SignalEngineSection";
import ScenarioCardsSection from "./valuation/ScenarioCardsSection";
import AnchorAnalysisGrid from "./valuation/AnchorAnalysisGrid";
import BusinessModelSection from "./valuation/BusinessModelSection";
import DcfLensSection from "./valuation/DcfLensSection";
import CyclicalRegimeSection from "./valuation/CyclicalRegimeSection";
import ChecklistMarketSection from "./valuation/ChecklistMarketSection";
import SotpSection from "./valuation/SotpSection";
import BacktestSection from "./valuation/BacktestSection";
import ValuationInputsPanel from "./valuation/ValuationInputsPanel";
import ValuationCardsSection from "./valuation/ValuationCardsSection";
import TriangulationSection from "./valuation/TriangulationSection";
import ReSeriesSection from "./valuation/ReSeriesSection";
import ContinuingValueFormulae from "./valuation/ContinuingValueFormulae";

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
  analysisStatus?: AnalysisStatusSummary | null | undefined;
  auditMeta?: AuditSubmissionMeta | null | undefined;
  traceability?: AnalysisTraceabilityEnvelope | null | undefined;
  publication?: AnalysisPublicationSnapshot | null | undefined;
  /** Phase I3 — loss-maker anchors. Populated when ≥50% of periods have CNI ≤ 0. */
  lossMaker?: LossMakerValuationResult | null | undefined;
  /** Phase 9 — anchor ratio bands. Surfaces economically implausible outputs. */
  ratioSanity?: SanityAssessment | null | undefined;
  /** Phase C5 — parsed segment data for SOTP valuation. */
  segmentData?: AllSegmentData | null | undefined;
}

export default function ValuationReport({ data, config, analysisStatus, auditMeta, traceability, publication = null, lossMaker = null, ratioSanity = null, segmentData = null }: Props) {
  const derivedValuationReadiness = useMemo(() => resolveValuationReadiness(data), [data]);
  const valuationReadiness = publication?.valuationReadiness ?? derivedValuationReadiness;
  const resolvedTraceability = publication?.traceability ?? traceability;
  const derivedTraceabilitySummary = useMemo(
    () => buildValuationTraceabilitySurfaceSummary(resolvedTraceability),
    [resolvedTraceability],
  );
  const traceabilitySummary = publication?.traceabilitySummary ?? derivedTraceabilitySummary;
  const resolvedNseSymbol = useMemo(() => resolveNseSymbol(config.market_data_symbol ?? config.ticker ?? config.quality_data_folder ?? null), [config.market_data_symbol, config.ticker, config.quality_data_folder]);
  const marketProvider = config.market_data_provider ?? (resolvedNseSymbol ? "nse" : "manual");
  const marketSymbol = config.market_data_symbol ?? config.ticker ?? resolvedNseSymbol ?? null;
  const { snapshot: liveMarketData, loading: marketDataLoading, error: marketDataError, refresh } = useLiveMarketData({
    provider: marketProvider,
    symbol: marketSymbol,
    instrumentKey: config.market_data_instrument_key ?? null,
    fallbackPrice: config.market_price ?? null,
    fallbackRiskFreeRate: config.risk_free_rate ?? null,
    refreshSeconds: config.market_data_refresh_seconds ?? 300,
  });
  const effectiveConfig = useMemo<EngineConfig>(() => ({
    ...config,
    market_price: liveMarketData?.price != null ? INRAbsolute(liveMarketData.price) : config.market_price,
    risk_free_rate: liveMarketData?.riskFreeRate ?? config.risk_free_rate,
  }), [config, liveMarketData]);
  const keFromConfig = ke_from_config(effectiveConfig);
  const [keOverride, setKeOverride] = useState<number | null>(null);
  const [g, setG] = useState(effectiveConfig.g_terminal_override != null ? effectiveConfig.g_terminal_override * 100 : 4.0);
  const [cv, setCv] = useState<CVMethod>("CV3");
  const lastMarketAuditRef = useRef<string | null>(null);
  const lastSignalAuditRef = useRef<string | null>(null);
  const lastManifestAuditRef = useRef<string | null>(null);
  const lastAlertAuditRef = useRef<string | null>(null);

  const insufficientData = data.length < 2;

  const ke = keOverride != null ? keOverride / 100 : keFromConfig;
  const gRate = g / 100;
  const shareBasis = useMemo(() => insufficientData ? { shares: null, source: "N/A", confidence: "LOW" as const, dilution_note: "", valuationConfig: effectiveConfig } : resolveShareBasis(data, effectiveConfig), [data, effectiveConfig, insufficientData]);
  const valuationData = useMemo(
    () => data.slice(0, Math.max(2, valuationReadiness.anchorIndex + 1)),
    [data, valuationReadiness.anchorIndex]
  );
  const valuationConfig = useMemo(
    () => shareBasis.valuationConfig,
    [shareBasis]
  );
  const kwDerived = useMemo(() => {
    const cur = valuationData[valuationData.length - 1]!;
    const prev = valuationData[valuationData.length - 2]!;
    return deriveKwFromStructure(cur, prev, ke, effectiveConfig.risk_free_rate, effectiveConfig);
  }, [valuationData, ke, effectiveConfig]);

  const cyclicalNormalization = useMemo(() => buildCyclicalNormalization(data), [data]);

  const cyclicalTerminalREAnchor = useMemo(() => {
    return deriveCyclicalTerminalREAnchor(cyclicalNormalization, valuationData);
  }, [cyclicalNormalization, valuationData]);

  const val = useMemo(() =>
    computeValuation(valuationData, ke, kwDerived, gRate, valuationConfig, cyclicalTerminalREAnchor),
    [valuationData, ke, kwDerived, gRate, valuationConfig, cyclicalTerminalREAnchor]
  );
  const commandCenter = useMemo(
    () => buildValuationCommandCenter({
      data,
      config: effectiveConfig,
      marketData: liveMarketData,
      analysisStatus,
      segmentData: segmentData?.business ?? null,
    }),
    [analysisStatus, data, effectiveConfig, liveMarketData, segmentData],
  );

  // Moat scorer (5-dimension Buffett/Munger framework)
  const moatScore = useMemo(() => computeMoatScore(data, effectiveConfig), [data, effectiveConfig]);
  const regimeContext = useMemo(
    () => buildRegimeContext(commandCenter.riskFreeRate, liveMarketData?.history?.currentPricePercentile ?? null),
    [commandCenter.riskFreeRate, liveMarketData?.history?.currentPricePercentile],
  );
  const terminalEconomics = useMemo(
    () => buildTerminalEconomics({
      latest: data[data.length - 1]!,
      normalized: cyclicalNormalization,
      requiredReturn: ke,
      sectorTerminalGrowth: commandCenter.scenarios.find((item) => item.key === "base")?.assumptions.g ?? gRate,
    }),
    [commandCenter.scenarios, cyclicalNormalization, data, gRate, ke],
  );
  const calibration = useMemo(() => calibrateSignalBacktest(commandCenter.backtest), [commandCenter.backtest]);

  useEffect(() => {
    if (!auditMeta || !liveMarketData) return;
    const signature = JSON.stringify({
      symbol: liveMarketData.symbol,
      fetchedAt: liveMarketData.fetchedAt,
      price: liveMarketData.price,
      riskFreeRate: liveMarketData.riskFreeRate,
      freshness: liveMarketData.freshness,
    });
    if (signature === lastMarketAuditRef.current) return;
    lastMarketAuditRef.current = signature;
    void persistAuditEvent({
      runId: auditMeta.runId,
      eventType: "market-data-refreshed",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: liveMarketData,
    });
  }, [auditMeta, liveMarketData]);

  useEffect(() => {
    if (!auditMeta) return;
    const signalPayload = buildSignalAuditPayload(commandCenter);
    const signature = JSON.stringify(signalPayload);
    if (signature === lastSignalAuditRef.current) return;
    lastSignalAuditRef.current = signature;
    void persistAuditEvent({
      runId: auditMeta.runId,
      eventType: "valuation-signal-updated",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: signalPayload,
    });
  }, [auditMeta, commandCenter]);

  useEffect(() => {
    const companyId = auditMeta?.companyId ?? config.ticker ?? null;
    if (!companyId) return;
    rememberWorkspaceValuation({
      companyId,
      commandCenter,
      marketSymbol,
      runId: auditMeta?.runId ?? null,
    });
    void syncWorkspaceValuation(companyId, {
      id: `${auditMeta?.runId ?? "workspace"}:${commandCenter.asOf ?? "latest"}`,
      runId: auditMeta?.runId ?? null,
      recordedAt: new Date().toISOString(),
      asOf: commandCenter.asOf,
      marketPrice: commandCenter.marketPrice,
      signalState: commandCenter.signal.state,
      signalLabel: commandCenter.signal.label,
      confidenceState: commandCenter.signal.confidenceState,
      opportunityScore: commandCenter.opportunity.opportunityScore,
      qualityScore: commandCenter.opportunity.qualityScore,
      expectedCagrStress: commandCenter.opportunity.expectedCagrStress,
      expectedCagrBase: commandCenter.opportunity.expectedCagrBase,
      stressUpsidePct: commandCenter.signal.stressUpsidePct,
      baseUpsidePct: commandCenter.signal.baseUpsidePct,
      requiredMarginOfSafetyPct: commandCenter.opportunity.requiredMarginOfSafetyPct,
      convictionBucket: commandCenter.opportunity.convictionBucket,
      sectorTemplate: commandCenter.sectorTemplate.label,
      thesis: commandCenter.opportunity.thesis,
      persistenceNarrative: commandCenter.opportunity.persistenceNarrative,
      reverseDcfSummary: commandCenter.reverseDcf.expectationLabel,
      marketSymbol,
      forecastDiscipline: commandCenter.checklist.forecastDiscipline,
      businessModelEvidence: commandCenter.businessModel.evidence,
      persistenceScore: commandCenter.businessModel.persistenceScore,
      marginDurabilityScore: commandCenter.businessModel.marginDurabilityScore,
      workingCapitalDisciplineScore: commandCenter.businessModel.workingCapitalDisciplineScore,
    });
  }, [auditMeta?.runId, auditMeta?.companyId, commandCenter, config.ticker, marketSymbol]);

  useEffect(() => {
    if (!auditMeta) return;
    const manifestPayload = buildManifestAuditPayload(commandCenter);
    const signature = JSON.stringify(manifestPayload);
    if (signature === lastManifestAuditRef.current) return;
    lastManifestAuditRef.current = signature;
    void persistAuditEvent({
      runId: auditMeta.runId,
      eventType: "valuation-manifest-updated",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: manifestPayload,
    });
  }, [auditMeta, commandCenter]);

  useEffect(() => {
    if (!auditMeta) return;
    if (!["high-conviction", "screaming-buy"].includes(commandCenter.signal.state)) return;
    const alertPayload = buildAlertAuditPayload(commandCenter);
    const signature = JSON.stringify(alertPayload);
    if (signature === lastAlertAuditRef.current) return;
    lastAlertAuditRef.current = signature;
    void persistAuditEvent({
      runId: auditMeta.runId,
      eventType: "valuation-alert-triggered",
      companyId: auditMeta.companyId,
      sourceMode: auditMeta.sourceMode,
      payload: alertPayload,
    });
    void syncWorkspaceAlert(auditMeta.companyId, {
      id: `${auditMeta.runId}:${commandCenter.signal.state}:${commandCenter.asOf ?? "latest"}`,
      ...alertPayload,
    });
  }, [auditMeta, commandCenter]);

  const cvSel = makeCvSel(cv);
  const distressResult = useMemo(() => detectDistress(data), [data]);

  if (insufficientData) {
    return <div className="card-base p-8 text-center">
      <p className="font-semibold text-slate-600 dark:text-slate-300 text-lg">Need ≥ 2 periods</p>
      <p className="text-sm text-slate-500 mt-2">Upload more years of data to compute residual-income valuation.</p>
    </div>;
  }

  const V_RE = cvSel(val.V_RE_CV1, val.V_RE_CV2, val.V_RE_CV3);
  const V_ReOI = cvSel(val.V_ReOI_CV01, val.V_ReOI_CV02, val.V_ReOI_CV03);

  const sharesOut = shareBasis.shares ?? null;
  const barData = buildReSeriesBarData(val, sharesOut);
  const sparklineData = buildSparklineData(liveMarketData);

  return (
    <div className="space-y-8">
      {/* Phase J3: financial distress banner — surfaces negative net worth
          and going-concern stress at the top of the report so reviewers
          see it before reading any equity-side numbers. */}
      <DistressBanner distress={distressResult} />

      {/* Phase 9 — Ratio sanity (anchor ratio bands) */}
      {ratioSanity && ratioSanity.checks.length > 0 && ratioSanity.status !== "ok" && (
        <RatioSanityPanel ratioSanity={ratioSanity} />
      )}

      {/* Phase I3 — Loss-maker valuation anchors */}
      {lossMaker && <LossMakerPanel lossMaker={lossMaker} />}

      <ValuationCommandCenterHero
        marketSymbol={marketSymbol}
        commandCenter={commandCenter}
        liveMarketData={liveMarketData}
        marketDataLoading={marketDataLoading}
        marketDataError={marketDataError}
        onRefresh={refresh}
        config={effectiveConfig}
      />

      {traceabilitySummary && (
        <TraceabilityTrustPanel
          title="Valuation Trust Gate"
          summary={traceabilitySummary}
          confidenceStatus={traceability?.confidence.status}
          rigorLabel={traceability?.rigor.currentLabel}
          parserStatus={traceability?.parserFidelity.status}
          reconciliationStatus={traceability?.reconciliation.status}
          cautionHeading="Why this valuation should be trusted cautiously"
          aside={<SignalPill state={commandCenter.signal.state} label={commandCenter.signal.label} />}
        />
      )}

      <SignalEngineSection
        commandCenter={commandCenter}
        liveMarketData={liveMarketData}
        sparklineData={sparklineData}
      />

      <ScenarioCardsSection commandCenter={commandCenter} />

      <AnchorAnalysisGrid commandCenter={commandCenter} moatScore={moatScore} ke={ke} data={data} />

      <BusinessModelSection commandCenter={commandCenter} />

      <DcfLensSection commandCenter={commandCenter} fmt={fmt} />

      <CyclicalRegimeSection
        cyclicalNormalization={cyclicalNormalization}
        terminalEconomics={terminalEconomics}
        regimeContext={regimeContext}
        calibration={calibration}
      />

      <ChecklistMarketSection commandCenter={commandCenter} fmt={fmt} />

      <SotpSection commandCenter={commandCenter} />

      <BacktestSection commandCenter={commandCenter} />

      <ValuationInputsPanel
        keOverride={keOverride}
        setKeOverride={setKeOverride}
        keFromConfig={keFromConfig}
        effectiveConfig={effectiveConfig}
        kwDerived={kwDerived}
        g={g}
        setG={setG}
        cv={cv}
        setCv={setCv}
        commandCenter={commandCenter}
        liveMarketData={liveMarketData}
        config={config}
        sharesOut={sharesOut}
        shareBasis={shareBasis}
        val={val}
        valuationReadiness={valuationReadiness}
      />

      <ValuationCardsSection val={val} V_RE={V_RE} V_ReOI={V_ReOI} cv={cv} sharesOut={sharesOut} />

      <TriangulationSection val={val} sharesOut={sharesOut} />

      <ReSeriesSection
        val={val}
        data={data}
        sharesOut={sharesOut}
        ke={ke}
        kwDerived={kwDerived}
        barData={barData}
      />

      <SensitivityGrid ke={ke} gRate={gRate} val={val} sharesOut={sharesOut} fmt={fmt} />

      <ContinuingValueFormulae g={g} kwDerived={kwDerived} />
    </div>
  );
}
