import { useEffect, useMemo, useRef, useState } from "react";
import { RecastPeriod, EngineConfig } from "../engine/types";
import { INRAbsolute } from "../engine/types/units";
import { buildCyclicalNormalization } from "../engine/cyclicalNormalization";
import { detectDistress } from "../engine/distressDetector";
import { computeValuation, deriveKwFromStructure } from "../engine/PenmanNissimEngine";
import { resolveCostOfCapitalFromConfig } from "../engine/costOfCapital";
import { ACTIVE_MARKET_PACKS, analysisAsOfToday } from "../engine/marketPacks";
import { buildRegimeContext } from "../engine/regimeModel";
import { calibrateSignalBacktest } from "../engine/signalBacktest";
import { buildTerminalEconomics } from "../engine/terminalEconomics";
import { resolveValuationReadiness } from "../engine/valuationPolicy";
import { resolveShareBasis } from "../engine/shareCountTools";
import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { buildValuationCommandCenter, type ValuationCommandCenterOutput } from "../engine/valuationCommandCenter";
import { summarizeAntiTautology } from "../engine/valuationEvidence";
import { SignalPill } from "./valuation/atoms";
import { resolveNseSymbol } from "../engine/nseSymbolRegistry";
import type { LiveMarketDataSnapshot } from "../engine/marketData";
import { AuditSubmissionMeta, persistAuditEvent } from "../lib/audit";
import { computeMoatScore } from "../engine/moatScoring";
import { rememberWorkspaceValuation } from "../lib/researchWorkspace";
import { syncWorkspaceAlert, syncWorkspaceValuation } from "../lib/sharedResearchApi";
import { AnalysisTraceabilityEnvelope } from "../engine/analysisTraceability";
import { buildValuationTraceabilitySurfaceSummary } from "../engine/valuationTraceabilitySummary";
import { evaluateAnalyticalDepth } from "../engine/analyticalDepth";
import TraceabilityTrustPanel from "./TraceabilityTrustPanel";
import type { AnalysisPublicationSnapshot } from "../lib/publication/analysisPublicationSnapshot";
import type { LossMakerValuationResult } from "../engine/lossMakerValuation";
import type { SanityAssessment } from "../engine/ratioSanity";
import type { AllSegmentData } from "../engine/segmentParser";
import type { ITServicesSignal } from "../engine/itServicesDetector";
import { EmptyState } from "./shared/Primitives";
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
  /** Authoritative run output. Legacy tests/callers may omit it temporarily. */
  commandCenter?: ValuationCommandCenterOutput | null | undefined;
  marketData?: LiveMarketDataSnapshot | null | undefined;
  marketDataLoading?: boolean | undefined;
  marketDataError?: string | null | undefined;
  onMarketRefresh?: (() => Promise<void>) | undefined;
  /**
   * Phase E3 — IT-services fingerprint. Required, though `null` is valid, so
   * that a call site cannot omit it silently: `AnchorAnalysisGrid` renders the
   * moat scorer's own skip-reason, and without the signal an IT-services
   * company gets a confident moat width computed on inflated RNOA.
   */
  itServices: ITServicesSignal | null;
}

export default function ValuationReport({
  data,
  config,
  analysisStatus,
  auditMeta,
  traceability,
  publication = null,
  lossMaker = null,
  ratioSanity = null,
  segmentData = null,
  commandCenter: runCommandCenter = null,
  marketData: liveMarketData = null,
  marketDataLoading = false,
  marketDataError = null,
  onMarketRefresh,
  itServices,
}: Props) {
  const derivedValuationReadiness = useMemo(() => resolveValuationReadiness(data), [data]);
  const valuationReadiness = publication?.valuationReadiness ?? derivedValuationReadiness;
  const resolvedTraceability = publication?.traceability ?? traceability;
  const resolvedNseSymbol = useMemo(() => resolveNseSymbol(config.market_data_symbol ?? config.ticker ?? config.quality_data_folder ?? null), [config.market_data_symbol, config.ticker, config.quality_data_folder]);
  const marketSymbol = config.market_data_symbol ?? config.ticker ?? resolvedNseSymbol ?? null;
  const effectiveConfig = useMemo<EngineConfig>(() => ({
    ...config,
    market_price: liveMarketData?.price != null ? INRAbsolute(liveMarketData.price) : config.market_price,
    risk_free_rate: liveMarketData?.riskFreeRate ?? config.risk_free_rate,
  }), [config, liveMarketData]);
  // S-9.4C: one cost-of-equity derivation for the whole app, replacing the
  // parallel `ke_from_config` implementation.
  //
  // Still `effectiveConfig`, not `config`: the live risk-free rate and market
  // price are already folded into it above, and the reviewer's ke override below
  // is layered on top. Deliberately not read off `commandCenter.costOfCapital`
  // even though this surface has one — that build also passes the selected
  // periods and the live market snapshot, so its ke is a different (better-
  // evidenced) number, and adopting it here would move the displayed discount
  // rate rather than just unify how it is derived.
  //
  // The packs are supplied here for the same reason: a resolver called without
  // them derives the *unpinned* rate from the same config, so omitting them on
  // this surface while the run receives them would print one discount rate
  // against a run that recorded another.
  const keFromConfig = resolveCostOfCapitalFromConfig({
    config: effectiveConfig,
    ...ACTIVE_MARKET_PACKS,
    analysisAsOf: analysisAsOfToday(),
  }).ke;
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

  // S-9.4C structural baseline: kw recomputed at the UN-overridden config ke.
  // When the analyst moves ke (keOverride), kwDerived drifts from this baseline;
  // the InputsPanel surfaces the delta as a read-only badge. This is intentional
  // sensitivity exploration — it does NOT touch the rigor ladder (kw stays
  // structurally derived). When keOverride is null, ke === keFromConfig so the
  // two coincide and the badge is hidden.
  const kwStructuralBaseline = useMemo(() => {
    const cur = valuationData[valuationData.length - 1]!;
    const prev = valuationData[valuationData.length - 2]!;
    return deriveKwFromStructure(cur, prev, keFromConfig, effectiveConfig.risk_free_rate, effectiveConfig);
  }, [valuationData, keFromConfig, effectiveConfig]);

  const cyclicalNormalization = useMemo(() => buildCyclicalNormalization(data), [data]);

  const cyclicalTerminalREAnchor = useMemo(() => {
    return deriveCyclicalTerminalREAnchor(cyclicalNormalization, valuationData);
  }, [cyclicalNormalization, valuationData]);

  const val = useMemo(() =>
    computeValuation(valuationData, ke, kwDerived, gRate, valuationConfig, cyclicalTerminalREAnchor),
    [valuationData, ke, kwDerived, gRate, valuationConfig, cyclicalTerminalREAnchor]
  );
  // The fallback build, for legacy callers that pass no run-backed command
  // center. It needs the packs for the same reason the `keFromConfig` resolve
  // above does — and this is the call the first version of the census missed,
  // because it only checked that the *file* named `ACTIVE_MARKET_PACKS`
  // somewhere. `runCommandCenter` (the native path) already carries the run's
  // pinned ke, so only this branch had to change.
  const commandCenter = useMemo(
    () => runCommandCenter ?? buildValuationCommandCenter({
      data,
      config: effectiveConfig,
      marketData: liveMarketData,
      analysisStatus,
      segmentData: segmentData?.business ?? null,
      ...ACTIVE_MARKET_PACKS,
      analysisAsOf: analysisAsOfToday(),
    }),
    [analysisStatus, data, effectiveConfig, liveMarketData, runCommandCenter, segmentData],
  );

  // Native runs arrive with finalized analytical-depth and anti-tautology
  // evidence. The fallback remains only for legacy component callers that do
  // not yet supply a run-backed envelope.
  const enrichedTraceability = useMemo(
    () => {
      if (!resolvedTraceability) return resolvedTraceability;
      if (resolvedTraceability.analyticalDepth && resolvedTraceability.antiTautology) return resolvedTraceability;
      return {
        ...resolvedTraceability,
        analyticalDepth: evaluateAnalyticalDepth(commandCenter, { modelKe: ke }),
        antiTautology: summarizeAntiTautology(commandCenter),
      };
    },
    [resolvedTraceability, commandCenter, ke],
  );
  const traceabilitySummary = useMemo(
    () => buildValuationTraceabilitySurfaceSummary(enrichedTraceability),
    [enrichedTraceability],
  );

  // Moat scorer (5-dimension Buffett/Munger framework)
  // Phase E3: `null` kw override preserves the existing resolution order; the
  // fourth argument is the IT-services signal this surface never used to pass,
  // so `AnchorAnalysisGrid` could not render the scorer's own skip-reason.
  const moatScore = useMemo(() => computeMoatScore(data, effectiveConfig, null, itServices), [data, effectiveConfig, itServices]);
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
    return <EmptyState
      icon="currency"
      title="Need ≥ 2 periods"
      body="Upload more years of data to compute residual-income valuation."
    />;
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
        onRefresh={onMarketRefresh ?? (() => Promise.resolve())}
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
        kwStructuralBaseline={kwStructuralBaseline}
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
