import { useEffect, useMemo, useRef, useState } from "react";
import { RecastPeriod, EngineConfig } from "../engine/types";
import { buildCyclicalNormalization } from "../engine/cyclicalNormalization";
import { computeValuation, deriveKwFromStructure } from "../engine/PenmanNissimEngine";
import { ke_from_config } from "../engine/types";
import { buildRegimeContext } from "../engine/regimeModel";
import { calibrateSignalBacktest } from "../engine/signalBacktest";
import { buildTerminalEconomics } from "../engine/terminalEconomics";
import { resolveValuationReadiness } from "../engine/valuationPolicy";
import { resolveShareBasis, toPerShare } from "../engine/shareCountTools";
import { AnalysisStatusSummary } from "../engine/analysisStatus";
import {
  buildValuationCommandCenter,
  formatHistoricalPercentile,
  formatPct,
  formatPerShare,
  ValuationSignalState,
} from "../engine/valuationCommandCenter";
import { useLiveMarketData } from "../hooks/useLiveMarketData";
import { AuditSubmissionMeta, persistAuditEvent } from "../lib/audit";
import ExpectationBridgePanel from "./ExpectationBridgePanel";
import { rememberWorkspaceValuation } from "../lib/researchWorkspace";
import { syncWorkspaceAlert, syncWorkspaceValuation } from "../lib/sharedResearchApi";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell, LineChart, Line,
} from "recharts";

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
  analysisStatus?: AnalysisStatusSummary | null;
  auditMeta?: AuditSubmissionMeta | null;
}

type CVMethod = "CV1" | "CV2" | "CV3";

export default function ValuationReport({ data, config, analysisStatus, auditMeta }: Props) {
  const valuationReadiness = useMemo(() => resolveValuationReadiness(data), [data]);
  const marketSymbol = config.market_data_symbol ?? config.ticker ?? null;
  const { snapshot: liveMarketData, loading: marketDataLoading, error: marketDataError, refresh } = useLiveMarketData({
    provider: config.market_data_provider ?? "manual",
    symbol: marketSymbol,
    instrumentKey: config.market_data_instrument_key ?? null,
    fallbackPrice: config.market_price ?? null,
    fallbackRiskFreeRate: config.risk_free_rate ?? null,
    refreshSeconds: config.market_data_refresh_seconds ?? 300,
  });
  const effectiveConfig = useMemo<EngineConfig>(() => ({
    ...config,
    market_price: liveMarketData?.price ?? config.market_price,
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

  if (data.length < 2) {
    return <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
      <p className="font-semibold text-amber-800 text-lg">Need ≥ 2 periods</p>
      <p className="text-amber-600 mt-1 text-sm">Upload more years of data to compute residual-income valuation.</p>
    </div>;
  }

  const ke = keOverride != null ? keOverride / 100 : keFromConfig;
  const gRate = g / 100;
  const shareBasis = useMemo(() => resolveShareBasis(data, effectiveConfig), [data, effectiveConfig]);
  const valuationData = useMemo(
    () => data.slice(0, Math.max(2, valuationReadiness.anchorIndex + 1)),
    [data, valuationReadiness.anchorIndex]
  );
  const valuationConfig = useMemo(
    () => shareBasis.valuationConfig,
    [shareBasis]
  );
  const kwDerived = useMemo(() => {
    const cur = valuationData[valuationData.length - 1];
    const prev = valuationData[valuationData.length - 2];
    return deriveKwFromStructure(cur, prev, ke, effectiveConfig.risk_free_rate, effectiveConfig);
  }, [valuationData, ke, effectiveConfig]);
  const val = useMemo(() =>
    computeValuation(valuationData, ke, kwDerived, gRate, valuationConfig),
    [valuationData, ke, kwDerived, gRate, valuationConfig]
  );
  const commandCenter = useMemo(
    () => buildValuationCommandCenter({
      data,
      config: effectiveConfig,
      marketData: liveMarketData,
      analysisStatus,
    }),
    [analysisStatus, data, effectiveConfig, liveMarketData],
  );
  const cyclicalNormalization = useMemo(() => buildCyclicalNormalization(data), [data]);
  const regimeContext = useMemo(
    () => buildRegimeContext(commandCenter.riskFreeRate, liveMarketData?.history?.currentPricePercentile ?? null),
    [commandCenter.riskFreeRate, liveMarketData?.history?.currentPricePercentile],
  );
  const terminalEconomics = useMemo(
    () => buildTerminalEconomics({
      latest: data[data.length - 1],
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
    const signalPayload = {
      ...commandCenter.signal,
      marketPrice: commandCenter.marketPrice,
      asOf: commandCenter.asOf,
      scenarios: commandCenter.scenarios.map((scenario) => ({
        key: scenario.key,
        label: scenario.label,
        intrinsicPerShare: scenario.intrinsicPerShare,
        upsidePct: scenario.upsidePct,
        marginOfSafetyPct: scenario.marginOfSafetyPct,
        expectedCagr: scenario.expectedCagr,
      })),
    };
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
      reverseDcfSummary: commandCenter.reverseDcf.expectationLabel,
      marketSymbol,
    });
  }, [auditMeta?.runId, auditMeta?.companyId, commandCenter, config.ticker, marketSymbol]);

  useEffect(() => {
    if (!auditMeta) return;
    const manifestPayload = {
      asOf: commandCenter.asOf,
      marketPrice: commandCenter.marketPrice,
      riskFreeRate: commandCenter.riskFreeRate,
      sectorTemplate: commandCenter.sectorTemplate,
      diagnostics: commandCenter.diagnostics,
      reverseDcf: commandCenter.reverseDcf,
      opportunity: commandCenter.opportunity,
      checklist: commandCenter.checklist,
      marketContext: commandCenter.marketContext,
      backtest: {
        available: commandCenter.backtest.available,
        investableCount: commandCenter.backtest.investableCount,
        highConvictionCount: commandCenter.backtest.highConvictionCount,
        screamingBuyCount: commandCenter.backtest.screamingBuyCount,
        forwardWinRate1Y: commandCenter.backtest.forwardWinRate1Y,
        forwardWinRate3Y: commandCenter.backtest.forwardWinRate3Y,
        median1Y: commandCenter.backtest.median1Y,
        median3Y: commandCenter.backtest.median3Y,
        latestComparedToHistory: commandCenter.backtest.latestComparedToHistory,
        points: commandCenter.backtest.points,
      },
    };
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
    const alertPayload = {
      state: commandCenter.signal.state,
      label: commandCenter.signal.label,
      summary: commandCenter.signal.summary,
      opportunityScore: commandCenter.signal.opportunityScore,
      convictionBucket: commandCenter.signal.convictionBucket,
      expectedCagrStress: commandCenter.signal.expectedCagrStress,
      marketPrice: commandCenter.marketPrice,
      asOf: commandCenter.asOf,
    };
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

  const cvSel = (v1: number, v2: number, v3: number) => cv === "CV1" ? v1 : cv === "CV2" ? v2 : v3;
  const V_RE = cvSel(val.V_RE_CV1, val.V_RE_CV2, val.V_RE_CV3);
  const V_ReOI = cvSel(val.V_ReOI_CV01, val.V_ReOI_CV02, val.V_ReOI_CV03);

  const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const fmtPerShare = (n: number | null | undefined) => n == null ? "—" : `₹${n.toFixed(2)}`;
  const sharesOut = shareBasis.shares ?? null;
  const barData = val.reSeries.map((r) => ({
    period: r.period.slice(0, 7),
    RE: +(toPerShare(r.RE, sharesOut) ?? r.RE).toFixed(2),
    ReOI: +(toPerShare(r.ReOI, sharesOut) ?? r.ReOI).toFixed(2),
  }));
  const sparklineData = liveMarketData?.history?.points.slice(0, 90).reverse().map((point) => ({
    date: point.date.slice(5),
    close: point.close,
  })) ?? [];

  return (
    <div className="space-y-8">
      <ValuationCommandCenterHero
        marketSymbol={marketSymbol}
        commandCenter={commandCenter}
        liveMarketData={liveMarketData}
        marketDataLoading={marketDataLoading}
        marketDataError={marketDataError}
        onRefresh={refresh}
      />

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Signal Engine</h2>
              <p className="mt-1 text-sm text-slate-500">
                The tab leads with the stressed case and only elevates a buy state when both valuation and historical context are unusually strong.
              </p>
            </div>
            <SignalPill state={commandCenter.signal.state} label={commandCenter.signal.label} />
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why it qualifies</div>
              <div className="mt-2 text-sm font-medium text-slate-800">{commandCenter.signal.summary}</div>
              <div className="mt-4 space-y-2 text-sm text-slate-700">
                <div>Base upside: <strong>{formatPct(commandCenter.signal.baseUpsidePct)}</strong></div>
                <div>Stress upside: <strong>{formatPct(commandCenter.signal.stressUpsidePct)}</strong></div>
                <div>Historical setup: <strong>{formatHistoricalPercentile(commandCenter.signal.historicalPercentile)}</strong></div>
                <div>Reverse DCF implied growth: <strong>{formatPct(commandCenter.signal.reverseDcfImpliedGrowth, 2)}</strong></div>
                <div>Required margin of safety: <strong>{formatPct(commandCenter.signal.requiredMarginOfSafetyPct, 1)}</strong></div>
                <div>Quality score: <strong>{commandCenter.signal.qualityScore.toFixed(0)}/100</strong></div>
                <div>Opportunity score: <strong>{commandCenter.signal.opportunityScore.toFixed(0)}/100</strong></div>
                <div>Stress expected CAGR: <strong>{formatPct(commandCenter.signal.expectedCagrStress, 1)}</strong></div>
                <div>Sizing bucket: <strong>{commandCenter.signal.convictionBucket}</strong></div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kill Switches</div>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {commandCenter.signal.killSwitches.length ? commandCenter.signal.killSwitches.map((item) => (
                  <li key={item} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">{item}</li>
                )) : (
                  <li className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                    No active kill-switches are blocking the valuation command center.
                  </li>
                )}
              </ul>
              <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Supporting Flags</div>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {commandCenter.signal.supportingFlags.length ? commandCenter.signal.supportingFlags.map((item) => (
                  <li key={item} className="rounded-lg border border-slate-200 bg-white px-3 py-2">{item}</li>
                )) : (
                  <li className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-500">
                    No exceptional supporting flags are active yet.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Historical Dislocation</div>
          <div className="mt-3 grid gap-3">
            <StatTile label="Current price percentile" value={formatHistoricalPercentile(liveMarketData?.history?.currentPricePercentile)} />
            <StatTile label="52-week low" value={liveMarketData?.history?.low52Week != null ? `₹${liveMarketData.history.low52Week.toFixed(2)}` : "—"} />
            <StatTile label="52-week high" value={liveMarketData?.history?.high52Week != null ? `₹${liveMarketData.history.high52Week.toFixed(2)}` : "—"} />
            <StatTile label="Distance from 52-week low" value={formatPct(liveMarketData?.history?.distanceFrom52WeekLowPct)} />
            <StatTile label="Drawdown from 52-week high" value={formatPct(liveMarketData?.history?.drawdownFrom52WeekHighPct)} />
          </div>
          <div className="mt-5 h-40">
            {sparklineData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sparklineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" hide />
                  <YAxis tick={{ fontSize: 10 }} width={56} />
                  <Tooltip />
                  <Line dataKey="close" stroke="#0f172a" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">
                Historical price series unavailable for this symbol/provider.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        {commandCenter.scenarios.map((scenario) => (
          <ScenarioCard
            key={scenario.key}
            label={scenario.label}
            intrinsicPerShare={scenario.intrinsicPerShare}
            upsidePct={scenario.upsidePct}
            marginOfSafetyPct={scenario.marginOfSafetyPct}
            expectedCagr={scenario.expectedCagr}
            ke={scenario.assumptions.ke}
            kw={scenario.assumptions.kw}
            g={scenario.assumptions.g}
            salesGrowth={scenario.assumptions.salesGrowthYear1}
            corePm={scenario.assumptions.corePmYear1}
            reinvestmentRate={scenario.assumptions.reinvestmentRateYear1}
            incrementalRoic={scenario.assumptions.incrementalRoicYear1}
          />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sector Template</div>
          <div className="mt-2 text-xl font-bold text-slate-900">{commandCenter.sectorTemplate.label}</div>
          <div className="mt-2 text-sm text-slate-600">{commandCenter.sectorTemplate.description}</div>
          <div className="mt-4 grid gap-3 text-sm text-slate-700">
            <div>Selection source: <strong>{commandCenter.sectorTemplate.source}</strong></div>
            <div>Quality-adjusted margin of safety: <strong>{formatPct(commandCenter.opportunity.requiredMarginOfSafetyPct, 1)}</strong></div>
            <div>Quality score: <strong>{commandCenter.opportunity.qualityScore.toFixed(0)}/100</strong></div>
            <div>Opportunity score: <strong>{commandCenter.opportunity.opportunityScore.toFixed(0)}/100</strong></div>
            <div>Sizing bucket: <strong>{commandCenter.opportunity.convictionBucket}</strong></div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <ExpectationBridgePanel reverseDcf={commandCenter.reverseDcf} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Opportunity Protocol</div>
          <div className="mt-3 grid gap-3 text-sm text-slate-700">
            <div>Base margin of safety: <strong>{formatPct(commandCenter.opportunity.baseMarginOfSafetyPct, 1)}</strong></div>
            <div>Stress margin of safety: <strong>{formatPct(commandCenter.opportunity.stressMarginOfSafetyPct, 1)}</strong></div>
            <div>Base expected CAGR: <strong>{formatPct(commandCenter.opportunity.expectedCagrBase, 1)}</strong></div>
            <div>Stress expected CAGR: <strong>{formatPct(commandCenter.opportunity.expectedCagrStress, 1)}</strong></div>
            <div>Historical cheapness score: <strong>{commandCenter.opportunity.historicalCheapnessScore != null ? `${commandCenter.opportunity.historicalCheapnessScore.toFixed(0)}/100` : "—"}</strong></div>
            <div>Reverse-DCF pessimism score: <strong>{commandCenter.opportunity.reverseDcfPessimismScore != null ? `${commandCenter.opportunity.reverseDcfPessimismScore.toFixed(0)}/100` : "—"}</strong></div>
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
            {commandCenter.opportunity.thesis}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">DCF Cash-Flow Lens</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm text-slate-700">
            <StatTile label="Owner earnings / share" value={formatPerShare(commandCenter.diagnostics.ownerEarningsPerShare)} />
            <StatTile label="NOPAT" value={commandCenter.diagnostics.nopat != null ? `₹${fmt(commandCenter.diagnostics.nopat)} Cr` : "—"} />
            <StatTile label="Maintenance capex" value={`₹${fmt(commandCenter.diagnostics.maintenanceCapex)} Cr`} />
            <StatTile label="Growth capex" value={`₹${fmt(commandCenter.diagnostics.growthCapex)} Cr`} />
            <StatTile label="Working-capital investment" value={`₹${fmt(commandCenter.diagnostics.workingCapitalInvestment)} Cr`} />
            <StatTile label="Reinvestment rate" value={formatPct(commandCenter.diagnostics.reinvestmentRate, 1)} />
            <StatTile label="Incremental ROIC" value={formatPct(commandCenter.diagnostics.incrementalRoic, 1)} />
            <StatTile label="Maintenance share of capex" value={formatPct(commandCenter.diagnostics.maintenanceCapexShareOfCapex, 1)} />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Professional Decision Rules</div>
          <div className="mt-4 space-y-3 text-sm text-slate-700">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              `Truck-load zone` only appears when the stress case clears the required margin of safety, the current price is historically washed out, and the analysis is still production-ready.
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              Quality adjusts the hurdle: weaker accounting quality and more cyclical templates widen the required margin of safety before the buy signal is allowed to escalate.
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              Reverse DCF keeps the valuation honest by checking whether the market is already pricing an aggressive owner-earnings path.
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cyclical Normalization</div>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <div>Status: <strong>{cyclicalNormalization.label}</strong></div>
            <div>Volatility score: <strong>{cyclicalNormalization.volatilityScore.toFixed(0)}</strong></div>
            <div>Normalized sales growth: <strong>{formatPct(cyclicalNormalization.normalizedSalesGrowth, 1)}</strong></div>
            <div>Normalized margin: <strong>{formatPct(cyclicalNormalization.normalizedMargin, 1)}</strong></div>
            <div>Normalized ATO: <strong>{cyclicalNormalization.normalizedAto != null ? `${cyclicalNormalization.normalizedAto.toFixed(2)}x` : "—"}</strong></div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Terminal Economics</div>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <div>Terminal ROIC: <strong>{formatPct(terminalEconomics.terminalRoic, 1)}</strong></div>
            <div>Terminal growth: <strong>{formatPct(terminalEconomics.terminalGrowth, 1)}</strong></div>
            <div>Terminal reinvestment: <strong>{formatPct(terminalEconomics.terminalReinvestmentRate, 1)}</strong></div>
            <div>Fade years: <strong>{terminalEconomics.fadeYears}</strong></div>
            <div>Competition pressure: <strong>{terminalEconomics.competitionPressure}</strong></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">{terminalEconomics.summary}</div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Regime And Calibration</div>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <div>Regime: <strong>{regimeContext.label}</strong></div>
            <div>Discount-rate adj: <strong>{formatPct(regimeContext.discountRateAdjustment, 1)}</strong></div>
            <div>Strongest replay state: <strong>{calibration.strongestState ?? "—"}</strong></div>
            <div>Weakest replay state: <strong>{calibration.weakestState ?? "—"}</strong></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">{regimeContext.summary}</div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">{calibration.recommendation}</div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Thesis Checklist</div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 font-semibold text-slate-800">What Must Go Right</div>
              <ul className="space-y-2 text-sm text-slate-700">
                {commandCenter.checklist.whatMustGoRight.map((item) => (
                  <li key={item} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-2 font-semibold text-slate-800">What Breaks The Thesis</div>
              <ul className="space-y-2 text-sm text-slate-700">
                {commandCenter.checklist.thesisBreakers.map((item) => (
                  <li key={item} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Market Context</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm text-slate-700">
            <StatTile label="Expected return spread vs risk-free" value={formatPct(commandCenter.marketContext.expectedReturnSpreadVsRf, 1)} />
            <StatTile label="Price / stress value" value={commandCenter.marketContext.priceToStressValueRatio != null ? `${commandCenter.marketContext.priceToStressValueRatio.toFixed(2)}x` : "—"} />
            <StatTile label="Implied market cap" value={commandCenter.marketContext.marketCapFromPrice != null ? `₹${fmt(commandCenter.marketContext.marketCapFromPrice)} Cr` : "—"} />
            <StatTile label="Implied enterprise value" value={commandCenter.marketContext.enterpriseValueFromPrice != null ? `₹${fmt(commandCenter.marketContext.enterpriseValueFromPrice)} Cr` : "—"} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Historical Signal Replay</div>
              <div className="mt-1 text-sm text-slate-600">{commandCenter.backtest.latestComparedToHistory}</div>
            </div>
            <div className="text-right text-sm text-slate-700">
              <div>Investable points: <strong>{commandCenter.backtest.investableCount}</strong></div>
              <div>High-conviction+: <strong>{commandCenter.backtest.highConvictionCount}</strong></div>
            </div>
          </div>
          {commandCenter.backtest.available ? (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <StatTile label="1Y forward win rate" value={formatPct(commandCenter.backtest.forwardWinRate1Y, 0)} />
                <StatTile label="3Y forward win rate" value={formatPct(commandCenter.backtest.forwardWinRate3Y, 0)} />
                <StatTile label="Median 1Y return" value={formatPct(commandCenter.backtest.median1Y, 1)} />
                <StatTile label="Median 3Y CAGR" value={formatPct(commandCenter.backtest.median3Y, 1)} />
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b">
                      <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Period</th>
                      <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">State</th>
                      <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Stress CAGR</th>
                      <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Realized 1Y</th>
                      <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Realized 3Y</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {commandCenter.backtest.points.slice(-8).reverse().map((point) => (
                      <tr key={point.periodEnd}>
                        <td className="px-3 py-2 text-slate-700">{point.periodEnd.slice(0, 10)}</td>
                        <td className="px-3 py-2 text-slate-700">{point.state}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatPct(point.expectedCagrStress, 1)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatPct(point.realized1Y, 1)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatPct(point.realized3Y, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
              {commandCenter.backtest.latestComparedToHistory}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signal Distribution</div>
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            {Object.entries(commandCenter.backtest.countsByState).map(([state, count]) => (
              <div key={state} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <span>{state}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-5">Valuation Inputs (§6)</h2>
        <div className="flex flex-wrap gap-6 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Cost of Equity ke (%)</label>
            <div className="flex items-center gap-2">
              <input type="number" step={0.5}
                value={keOverride != null ? keOverride : +(keFromConfig * 100).toFixed(1)}
                onChange={(e) => setKeOverride(Number(e.target.value))}
                className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 bg-white" />
              {keOverride != null && (
                <button onClick={() => setKeOverride(null)}
                  className="text-xs text-slate-400 hover:text-indigo-600 underline">reset</button>
              )}
            </div>
            {keOverride == null && (
              <p className="text-xs text-slate-400 mt-0.5">
                {effectiveConfig.ke > 0 ? `explicit: ${(effectiveConfig.ke * 100).toFixed(1)}%` : `rf+erp = ${(keFromConfig * 100).toFixed(1)}%`}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">WACC kw — derived (S-9.4)</label>
            <div className="w-28 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-700 font-mono font-semibold">
              {(kwDerived * 100).toFixed(2)}%
            </div>
            <p className="text-xs text-slate-400 mt-0.5">NOA-weighted · kd_at=kd×(1−τ)</p>
          </div>

          <NumInput label="Growth g (%)" value={g} onChange={setG} />

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Continuing Value</label>
            <select value={cv} onChange={(e) => setCv(e.target.value as CVMethod)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="CV1">CV1 — Zero (conservative)</option>
              <option value="CV2">CV2 — Perpetuity, no growth</option>
              <option value="CV3">CV3 — Gordon growth</option>
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-700">Live market overlay</div>
            <div className="mt-1">Mode: <b>{config.market_data_provider ?? "manual"}</b></div>
            <div className="mt-1">Sector template: <b>{commandCenter.sectorTemplate.label}</b></div>
            <div className="mt-1">Price: <b>{commandCenter.marketPrice != null ? `₹${commandCenter.marketPrice.toFixed(2)}` : "—"}</b></div>
            <div>Risk-free: <b>{(commandCenter.riskFreeRate * 100).toFixed(2)}%</b></div>
            <div>Freshness: <b>{liveMarketData?.freshness ?? "fallback"}</b></div>
          </div>
        </div>

        {sharesOut != null && (
          <div className="mt-3 text-xs text-slate-500 space-y-1">
            <div>Share basis: <b>{sharesOut.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr shares</b></div>
            <div>Source: <b>{shareBasis.source}</b> · Confidence: <b>{shareBasis.confidence}</b></div>
          </div>
        )}

        {val.lowConfidence && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            Separation Confidence Score = {val.separationScore}/100 &lt; threshold.
            Operating/Financing separation may be unreliable. Prefer RE approach over ReOI-heavy conclusions.
          </div>
        )}

        {valuationReadiness.status !== "production-ready" && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
            <b>Guarded valuation mode.</b> {valuationReadiness.reasons[0]}
            <div className="mt-1">
              Anchor period: <b>{valuationReadiness.anchorPeriod?.slice(0, 10) ?? "n/a"}</b>
              {" "}· Latest source period: <b>{valuationReadiness.latestPeriod?.slice(0, 10) ?? "n/a"}</b>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ValCard color="indigo" title={`V (RE · ${cv})`} subtitle="Eq.(1a) · Clean surplus" value={V_RE}
          items={[
            { l: "CSE₀ (base book value)", v: val.CSE0 },
            { l: "PV of RE series", v: val.pvRE },
            { l: `CV PV (${cv})`, v: V_RE - val.CSE0 - val.pvRE },
          ]} fmt={fmt}
          perShare={toPerShare(V_RE, sharesOut)}
        />
        <ValCard color="emerald" title={`V (ReOI · ${cv === "CV1" ? "CV01" : cv === "CV2" ? "CV02" : "CV03"})`}
          subtitle="Eq.(9) · Ops-only · EV−NFO" value={V_ReOI}
          items={[
            { l: "EV (NOA₀ + PV ReOI + CV)", v: val.EV_ReOI },
            { l: "Less: NFO (latest)", v: -val.NFO_latest },
            { l: "PV ReOI", v: val.pvReOI },
          ]} fmt={fmt}
          perShare={toPerShare(V_ReOI, sharesOut)}
        />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">All CV Methods — RE</div>
          {[
            { label: "CV1 (zero)", v: val.V_RE_CV1 },
            { label: "CV2 (perp.)", v: val.V_RE_CV2 },
            { label: "CV3 (growth)", v: val.V_RE_CV3 },
          ].map((row) => (
            <div key={row.label} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
              <span className="text-slate-600">{row.label}</span>
              <span className="font-mono font-semibold text-indigo-700">
                {sharesOut ? `${fmtPerShare(toPerShare(row.v, sharesOut))} / share` : `₹${fmt(row.v)} Cr`}
              </span>
            </div>
          ))}
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-4 mb-3">All CV Methods — ReOI</div>
          {[
            { label: "CV01 (zero)", v: val.V_ReOI_CV01 },
            { label: "CV02 (perp.)", v: val.V_ReOI_CV02 },
            { label: "CV03 (growth)", v: val.V_ReOI_CV03 },
          ].map((row) => (
            <div key={row.label} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
              <span className="text-slate-600">{row.label}</span>
              <span className="font-mono font-semibold text-emerald-700">
                {sharesOut ? `${fmtPerShare(toPerShare(row.v, sharesOut))} / share` : `₹${fmt(row.v)} Cr`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">Valuation Triangulation (v3)</h2>
          <p className="text-xs text-slate-500 mt-0.5">Per-share value is primary. Company totals remain as context in ₹ Cr.</p>
        </div>
        <div className="p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Model</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Per Share (₹)</th>
                <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Value (₹ Cr)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ["RE (CV3)", val.V_RE_CV3, val.perShare?.intrinsic_re_per_share ?? null],
                ["ReOI (CV03)", val.V_ReOI_CV03, val.perShare?.intrinsic_reoi_per_share ?? null],
                ["FCFF", val.fcf?.EV_FCFF != null ? (val.fcf.EV_FCFF - val.NFO_latest) : null, val.perShare?.intrinsic_fcff_per_share ?? null],
                ["FCFE", val.fcf?.V_FCFE ?? null, val.perShare?.intrinsic_fcfe_per_share ?? null],
                ["DDM", val.perShare?.intrinsic_ddm_per_share != null && sharesOut ? val.perShare.intrinsic_ddm_per_share * sharesOut : null, val.perShare?.intrinsic_ddm_per_share ?? null],
                ["AEG", val.aeg?.V_AEG ?? null, val.perShare?.intrinsic_aeg_per_share ?? null],
              ].map(([name, v, ps]) => (
                <tr key={name as string}>
                  <td className="px-3 py-2 text-slate-700">{name as string}</td>
                  <td className="px-3 py-2 text-right font-mono">{typeof ps === "number" ? `₹${ps.toFixed(2)}` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{typeof v === "number" ? `₹${fmt(v)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {val.perShare?.implied_growth_rate != null && (
            <p className="text-xs text-slate-500 mt-3">
              Reverse DCF implied growth: <b>{(val.perShare.implied_growth_rate * 100).toFixed(2)}%</b>
            </p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">Residual Income Series</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            RE = CNI − ke×CSE₍t−1₎  |  ReOI = OI − kw×NOA₍t−1₎  |  §6.1–6.2
            {sharesOut ? ` · Rendered on a per-share basis using ${sharesOut.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr shares.` : " · Rendered in ₹ Cr until a share basis is available."}
          </p>
        </div>
        <div className="p-6">
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b">
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Period</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">{sharesOut ? "CNI / share" : "CNI"}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">{sharesOut ? "ke×CSE₋₁ / share" : "ke×CSE₋₁"}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-indigo-500 uppercase">{sharesOut ? "RE / share" : "RE"}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">{sharesOut ? "OI / share" : "OI"}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">{sharesOut ? "kw×NOA₋₁ / share" : "kw×NOA₋₁"}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-emerald-500 uppercase">{sharesOut ? "ReOI / share" : "ReOI"}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {val.reSeries.map((r, i) => {
                  const cur = data[i + 1];
                  const prev = data[i];
                  if (!cur || !prev) return null;
                  const cni = toPerShare(cur.is.CNI, sharesOut) ?? cur.is.CNI;
                  const equityCharge = toPerShare(ke * prev.bs.CSE, sharesOut) ?? (ke * prev.bs.CSE);
                  const re = toPerShare(r.RE, sharesOut) ?? r.RE;
                  const oi = toPerShare(cur.is.OI, sharesOut) ?? cur.is.OI;
                  const noaCharge = toPerShare(kwDerived * prev.bs.NOA, sharesOut) ?? (kwDerived * prev.bs.NOA);
                  const reoi = toPerShare(r.ReOI, sharesOut) ?? r.ReOI;
                  return (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-slate-600 text-sm">{r.period.slice(0, 7)}</td>
                      <td className="px-4 py-2 text-right font-mono text-sm">{sharesOut ? fmtPerShare(cni) : cur.is.CNI.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right font-mono text-sm text-slate-400">{sharesOut ? fmtPerShare(equityCharge) : (ke * prev.bs.CSE).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-indigo-700 text-sm">{sharesOut ? fmtPerShare(re) : fmt(r.RE)}</td>
                      <td className="px-4 py-2 text-right font-mono text-sm">{sharesOut ? fmtPerShare(oi) : cur.is.OI.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right font-mono text-sm text-slate-400">{sharesOut ? fmtPerShare(noaCharge) : (kwDerived * prev.bs.NOA).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700 text-sm">{sharesOut ? fmtPerShare(reoi) : fmt(r.ReOI)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { key: "RE" as const, label: "Residual Earnings (RE)", color: "#6366f1" },
              { key: "ReOI" as const, label: "Residual Op. Income (ReOI)", color: "#10b981" },
            ].map(({ key, label, color }) => (
              <div key={key} className="border border-slate-100 rounded-xl p-4">
                <div className="text-xs font-semibold text-slate-500 mb-3 uppercase">{label} {sharesOut ? "(₹ / share)" : "(₹ Cr)"}</div>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <ReferenceLine y={0} stroke="#94a3b8" />
                    <Bar dataKey={key}>
                      {barData.map((entry, i) => (
                        <Cell key={i} fill={entry[key] >= 0 ? color : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        </div>
      </div>

      <SensitivityGrid ke={ke} gRate={gRate} val={val} sharesOut={sharesOut} fmt={fmt} />

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-sm">
        <h3 className="font-semibold text-slate-800 mb-3">Continuing Value Formulae (§6.1–6.2)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs mb-3">
          {[
            { t: "CV1 / CV01 — Zero", f: "CV = 0", d: "Conservative. No terminal value." },
            { t: "CV2 / CV02 — Perpetuity", f: "CV = RE₍T₎ / (ρ−1)", d: "Steady state, zero growth." },
            { t: "CV3 / CV03 — Gordon Growth", f: "CV = RE₍T₎×(1+g) / (ρ−1−g)", d: `g = ${g.toFixed(1)}%` },
          ].map((c) => (
            <div key={c.t} className="bg-white p-3 rounded-lg border border-slate-100">
              <div className="font-bold text-slate-700 mb-1 font-sans text-xs">{c.t}</div>
              <div className="text-indigo-600">{c.f}</div>
              <div className="text-slate-400 mt-1 font-sans">{c.d}</div>
            </div>
          ))}
        </div>
        <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
          <b>S-9.4 — kw derivation:</b> kw = (NOA/EV)×ke + (NFO/EV)×kd_aftertax, where kd_aftertax = kd_pretax×(1−τ_kd).
          Derived kw = <b>{(kwDerived * 100).toFixed(2)}%</b>. kw is never a user input.
        </div>
      </div>
    </div>
  );
}

function ValuationCommandCenterHero({
  marketSymbol,
  commandCenter,
  liveMarketData,
  marketDataLoading,
  marketDataError,
  onRefresh,
}: {
  marketSymbol: string | null;
  commandCenter: ReturnType<typeof buildValuationCommandCenter>;
  liveMarketData: ReturnType<typeof useLiveMarketData>["snapshot"];
  marketDataLoading: boolean;
  marketDataError: string | null;
  onRefresh: () => Promise<void>;
}) {
  const stress = commandCenter.scenarios.find((scenario) => scenario.key === "stress");
  const base = commandCenter.scenarios.find((scenario) => scenario.key === "base");

  return (
    <section className="rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.06),_transparent_35%),linear-gradient(135deg,_#ffffff,_#f8fafc)] p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Valuation Command Center
          </div>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Lead with the stressed case, not the optimistic one.</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            The command center keeps the live market layer separate from the audited accounting base, then asks whether the current setup is merely cheap or genuinely rare.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SignalPill state={commandCenter.signal.state} label={commandCenter.signal.label} />
          <button
            onClick={() => { void onRefresh(); }}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
          >
            {marketDataLoading ? "Refreshing…" : "Refresh live data"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <HeroMetric label="Current price" value={commandCenter.marketPrice != null ? `₹${commandCenter.marketPrice.toFixed(2)}` : "—"} sublabel={`${liveMarketData?.freshness ?? "fallback"}${marketSymbol ? ` · ${marketSymbol}` : ""}`} />
        <HeroMetric label="Stress value" value={formatPerShare(stress?.intrinsicPerShare)} sublabel={`Upside ${formatPct(stress?.upsidePct)}`} />
        <HeroMetric label="Base value" value={formatPerShare(base?.intrinsicPerShare)} sublabel={`Upside ${formatPct(base?.upsidePct)}`} />
        <HeroMetric label="Expected CAGR (stress)" value={formatPct(commandCenter.opportunity.expectedCagrStress, 1)} sublabel={commandCenter.opportunity.convictionBucket} />
        <HeroMetric label="Valuation range" value={`${formatPerShare(commandCenter.range.floorPerShare)} to ${formatPerShare(commandCenter.range.ceilingPerShare)}`} sublabel={`As of ${commandCenter.asOf ? new Date(commandCenter.asOf).toLocaleString("en-IN") : "—"}`} />
      </div>

      {(marketDataError || liveMarketData?.warnings?.length) && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Live market overlay warnings</div>
          {marketDataError && <div className="mt-1">{marketDataError}</div>}
          {liveMarketData?.warnings?.length ? (
            <ul className="mt-2 space-y-1">
              {liveMarketData.warnings.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

function HeroMetric({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sublabel}</div>
    </div>
  );
}

function ScenarioCard({
  label,
  intrinsicPerShare,
  upsidePct,
  marginOfSafetyPct,
  expectedCagr,
  ke,
  kw,
  g,
  salesGrowth,
  corePm,
  reinvestmentRate,
  incrementalRoic,
}: {
  label: string;
  intrinsicPerShare: number | null;
  upsidePct: number | null;
  marginOfSafetyPct: number | null;
  expectedCagr: number | null;
  ke: number;
  kw: number;
  g: number;
  salesGrowth: number;
  corePm: number;
  reinvestmentRate: number | null;
  incrementalRoic: number | null;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{formatPerShare(intrinsicPerShare)}</div>
      <div className={`mt-1 text-sm font-semibold ${upsidePct != null && upsidePct >= 0 ? "text-emerald-700" : "text-red-700"}`}>
        {formatPct(upsidePct)} vs market
      </div>
      <div className="mt-4 grid gap-2 text-xs text-slate-500">
        <div>ke <strong className="text-slate-700">{formatPct(ke, 2)}</strong></div>
        <div>kw <strong className="text-slate-700">{formatPct(kw, 2)}</strong></div>
        <div>g <strong className="text-slate-700">{formatPct(g, 2)}</strong></div>
        <div>Y1 sales growth <strong className="text-slate-700">{formatPct(salesGrowth, 2)}</strong></div>
        <div>Y1 core PM <strong className="text-slate-700">{formatPct(corePm, 2)}</strong></div>
        <div>Margin of safety <strong className="text-slate-700">{formatPct(marginOfSafetyPct, 1)}</strong></div>
        <div>Expected CAGR <strong className="text-slate-700">{formatPct(expectedCagr, 1)}</strong></div>
        <div>Reinvestment rate <strong className="text-slate-700">{formatPct(reinvestmentRate, 1)}</strong></div>
        <div>Incremental ROIC <strong className="text-slate-700">{formatPct(incrementalRoic, 1)}</strong></div>
      </div>
    </div>
  );
}

function SignalPill({ state, label }: { state: ValuationSignalState; label: string }) {
  const classes = state === "blocked"
    ? "border-red-200 bg-red-50 text-red-700"
    : state === "guarded"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : state === "watchlist"
        ? "border-slate-200 bg-slate-100 text-slate-700"
        : state === "interesting"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : state === "high-conviction"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-emerald-300 bg-emerald-100 text-emerald-900";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${classes}`}>
      {label}
    </span>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function SensitivityGrid({
  ke, gRate, val, sharesOut, fmt
}: {
  ke: number; gRate: number;
  val: ReturnType<typeof computeValuation>;
  sharesOut: number | null;
  fmt: (n: number) => string;
}) {
  const KES = [0.08, 0.10, 0.12, 0.14, 0.16];
  const GS = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07];
  const T = val.reSeries.length;
  const lastRE = T > 0 ? val.reSeries[T - 1].RE : 0;

  const computeV = (keV: number, gv: number): number | null => {
    if (keV - gv <= 0.001) return null;
    const cv3 = lastRE * (1 + gv) / (keV - gv);
    const disc = Math.pow(1 + keV, T);
    return val.CSE0 + val.pvRE + cv3 / disc;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h2 className="text-lg font-bold text-slate-800">Sensitivity Grid — V_RE_CV3 (S-9.7)</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          {sharesOut != null
            ? "Per-share values across ke × g using the resolved share basis. Company totals are shown below for context."
            : "₹ Cr across ke × g. Columns strictly ascending by g (S-9.7). Base highlighted."}
        </p>
      </div>
      <div className="p-6 overflow-x-auto space-y-5">
        {sharesOut != null && sharesOut > 0 && (
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2 uppercase">Per Share (₹) — {sharesOut.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr shares</div>
            <table className="text-sm border-collapse">
              <thead>
                <tr>
                  <th className="px-3 py-2 bg-slate-100 text-xs text-slate-500 text-left border">ke ↓ / g →</th>
                  {GS.map(gv => (
                    <th key={gv} className="px-3 py-2 bg-slate-100 text-xs text-slate-500 text-right border">{(gv * 100).toFixed(0)}%</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KES.map(keV => (
                  <tr key={keV}>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-600 border bg-slate-50">ke={(keV * 100).toFixed(0)}%</td>
                    {GS.map(gv => {
                      const v = computeV(keV, gv);
                      const ps = toPerShare(v, sharesOut);
                      const isBase = Math.abs(keV - ke) < 0.005 && Math.abs(gv - gRate) < 0.005;
                      if (ps == null) return <td key={gv} className="px-3 py-2 text-center text-xs text-slate-400 border">—</td>;
                      return (
                        <td key={gv} className={`px-3 py-2 text-right font-mono text-xs border ${isBase ? "bg-indigo-100 font-bold text-indigo-800" : "text-slate-700"}`}>
                          ₹{ps.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2 uppercase">Value (₹ Cr)</div>
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                <th className="px-3 py-2 bg-slate-100 text-xs text-slate-500 text-left border">ke ↓ / g →</th>
                {GS.map(gv => (
                  <th key={gv} className="px-3 py-2 bg-slate-100 text-xs text-slate-500 text-right border">{(gv * 100).toFixed(0)}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KES.map(keV => (
                <tr key={keV}>
                  <td className="px-3 py-2 text-xs font-semibold text-slate-600 border bg-slate-50">ke={(keV * 100).toFixed(0)}%</td>
                  {GS.map(gv => {
                    const v = computeV(keV, gv);
                    const isBase = Math.abs(keV - ke) < 0.005 && Math.abs(gv - gRate) < 0.005;
                    if (v == null) return <td key={gv} className="px-3 py-2 text-center text-xs text-slate-400 border">—</td>;
                    return (
                      <td key={gv} className={`px-3 py-2 text-right font-mono text-xs border ${isBase ? "bg-indigo-100 font-bold text-indigo-800" : v > 0 ? "text-slate-700" : "text-red-500"}`}>
                        {fmt(v)}
                      </td>
                    );
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

function NumInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type="number" step={0.5} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 bg-white" />
    </div>
  );
}

function ValCard({ color, title, subtitle, value, items, fmt, perShare }: {
  color: "indigo" | "emerald"; title: string; subtitle: string; value: number;
  items: Array<{ l: string; v: number }>; fmt: (n: number) => string;
  perShare?: number | null;
}) {
  const bg = color === "indigo" ? "bg-indigo-50 border-indigo-200" : "bg-emerald-50 border-emerald-200";
  const hdr = color === "indigo" ? "bg-indigo-100 text-indigo-900" : "bg-emerald-100 text-emerald-900";
  const vc = color === "indigo" ? "text-indigo-700" : "text-emerald-700";
  return (
    <div className={`rounded-2xl border ${bg} overflow-hidden`}>
      <div className={`px-5 py-4 ${hdr}`}>
        <h3 className="font-bold">{title}</h3>
        <p className="text-xs opacity-70 mt-0.5">{subtitle}</p>
      </div>
      <div className="p-5">
        {perShare != null ? (
          <>
            <div className={`text-3xl font-bold ${vc} mb-1`}>₹{perShare.toFixed(2)} / share</div>
            <div className="text-sm text-slate-500 mb-3">₹{fmt(value)} Cr total equity value</div>
          </>
        ) : (
          <div className={`text-3xl font-bold ${vc} mb-3`}>₹{fmt(value)} Cr</div>
        )}
        {items.map((b, i) => (
          <div key={i} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
            <span className="text-slate-600 text-xs">{b.l}</span>
            <span className="font-mono font-semibold text-slate-800">{fmt(b.v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
