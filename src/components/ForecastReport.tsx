import { useMemo, useState } from "react";
import {
  RecastPeriod,
  FADE_PARAMS,
  NP_BENCHMARKS,
  EngineConfig,
  RawPeriodData,
  ForecastScenarioKey,
  ForecastScenarioWeighting,
} from "../engine/types";
import { resolveCostOfCapitalFromConfig } from "../engine/costOfCapital";
import { buildCyclicalNormalization } from "../engine/cyclicalNormalization";
import { buildDriverForecastModel } from "../engine/forecastDriverModel";
import { buildQuarterlyDriverSummary } from "../engine/quarterlyDriverModel";
import {
  buildPersistenceForecastScenarioSet,
  buildScenario,
  sensitivityAnalysis,
  buildValuationPeriodsFromForecast,
  applyDriverSensitivityToScenario,
  buildBusinessModelProfile,
  derivePersistenceForecastScenario,
} from "../engine/forecastingEngine";
import { computeValuation, deriveKwFromStructure } from "../engine/PenmanNissimEngine";
import { buildTerminalEconomics } from "../engine/terminalEconomics";
import { resolveValuationReadiness } from "../engine/valuationPolicy";
import { resolveShareBasis, toPerShare } from "../engine/shareCountTools";
import { runMonteCarlo } from "../engine/monteCarloClient";
import { MonteCarloOutput } from "../engine/monteCarloTypes";
import { AnalysisTraceabilityEnvelope } from "../engine/analysisTraceability";
import { buildValuationTraceabilitySurfaceSummary } from "../engine/valuationTraceabilitySummary";
import {
  buildForecastDisplayMode,
  buildForecastProbabilityState,
  buildForecastProvenance,
} from "../engine/forecastPresentation";
import TraceabilityTrustPanel from "./TraceabilityTrustPanel";
import { SectionHeader } from "./shared/DesignSystem";
import ScenarioRangeChart from "./charts/ScenarioRangeChart";
import { cr, fadeArr, scenarioColor, scenarioWeightForKey, updateWeightsForKey } from "./forecast/ForecastReport.formatters";
import AssumptionsPanel from "./forecast/AssumptionsPanel";
import DriverGrid from "./forecast/DriverGrid";
import FadeAnalysisSection from "./forecast/FadeAnalysisSection";
import ScenarioValuationSection from "./forecast/ScenarioValuationSection";
import MonteCarloSection from "./forecast/MonteCarloSection";
import SensitivitySection from "./forecast/SensitivitySection";
import ProFormaTable from "./forecast/ProFormaTable";
import ProvenancePanel from "./forecast/ProvenancePanel";
import RunBackedForecastReport from "./forecast/RunBackedForecastReport";
import type { SourcedAssumptionSet, UnifiedAnalysisWindow } from "../engine/analysisCase";
import type { IndustrialForecastResult, ScenarioOrderingReport } from "../engine/forecastState";
import type { ScenarioGovernanceReport } from "../engine/valuationEvidence";

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
  traceability?: AnalysisTraceabilityEnvelope | null | undefined;
  traceabilitySummary?: ReturnType<typeof buildValuationTraceabilitySurfaceSummary> | null | undefined;
}
interface ExtendedProps extends Props {
  rawData?: RawPeriodData[] | null;
  /** Presence of this property selects the immutable run-backed surface, even
   * while the value is null during worker execution. */
  runForecastResults?: readonly IndustrialForecastResult[] | null;
  analysisWindow?: UnifiedAnalysisWindow | null;
  sourcedAssumptionSet?: SourcedAssumptionSet | null;
  scenarioOrdering?: ScenarioOrderingReport | null;
  scenarioGovernance?: ScenarioGovernanceReport | null;
}

export default function ForecastReport(props: ExtendedProps) {
  if ("runForecastResults" in props) {
    return (
      <RunBackedForecastReport
        results={props.runForecastResults ?? null}
        analysisWindow={props.analysisWindow ?? null}
        assumptions={props.sourcedAssumptionSet ?? null}
        ordering={props.scenarioOrdering ?? null}
        governance={props.scenarioGovernance ?? null}
        traceability={props.traceability ?? null}
        traceabilitySummary={props.traceabilitySummary ?? buildValuationTraceabilitySurfaceSummary(props.traceability)}
      />
    );
  }
  return <LegacyForecastReport {...props} />;
}

function LegacyForecastReport({data,config, rawData = null, traceability = null, traceabilitySummary: precomputedTraceabilitySummary = null}:ExtendedProps) {
  // S-9.4C: one cost-of-equity derivation for the whole app, replacing the
  // parallel `ke_from_config` implementation.
  const keBase = resolveCostOfCapitalFromConfig({ config }).ke;
  // ke_inp is seeded in percent rounded to 0.1pp; keSeed is the exact decimal ke
  // the live path starts from (ke_inp/100 at rest). The structural baseline must
  // use keSeed — NOT raw keBase — so kwDerived === baseline before the analyst
  // moves ke, mirroring the Valuation side (otherwise the rounding gap would
  // light the Δ badge at rest).
  const keSeed = +(keBase * 100).toFixed(1) / 100;
  const valuationReadiness = useMemo(() => resolveValuationReadiness(data), [data]);
  const derivedTraceabilitySummary = useMemo(
    () => buildValuationTraceabilitySurfaceSummary(traceability),
    [traceability],
  );
  const traceabilitySummary = precomputedTraceabilitySummary ?? derivedTraceabilitySummary;
  const shareBasis = useMemo(() => resolveShareBasis(data, config), [data, config]);
  const valuationConfig = useMemo(() => shareBasis.valuationConfig, [shareBasis]);
  const sharesOut = shareBasis.shares ?? null;

  const latest = data[data.length-1]!;
  const latestRatios = latest?.ratios;

  const basePM  = latestRatios?.CoreSalesPM ?? latestRatios?.PM ?? 0.12;
  const baseATO = latestRatios?.ATO ?? 1.2;
  const baseSG  = latestRatios?.Sales_growth ?? 0.10;

  const NP_PM  = NP_BENCHMARKS.PM?.median   ?? 0.055;
  const NP_ATO = NP_BENCHMARKS.ATO?.median  ?? 1.18;
  const FADE_PM  = FADE_PARAMS.CoreSalesPM  ?? 0.87;
  const FADE_ATO = FADE_PARAMS.ATO          ?? 0.95;
  const FADE_SG  = FADE_PARAMS.Sales_growth ?? 0.70;
  const NP_SG    = NP_BENCHMARKS.Sales_growth?.median ?? 0.072;

  const horizonT = 5;
  const fadePM  = fadeArr(basePM, FADE_PM, NP_PM, horizonT);
  const fadeATO = fadeArr(baseATO, FADE_ATO, NP_ATO, horizonT);
  const fadeSG  = fadeArr(baseSG, FADE_SG, NP_SG, horizonT);
  const operatingBridge = latest?.is.operatingCostBridge;
  const bridgeReady = (operatingBridge?.coverageRatio ?? 0) >= 0.25;

  const [ke_inp,  setKe]  = useState(+(keSeed*100).toFixed(1));
  const [g_inp,   setG]   = useState(5.0);
  const [horizon, setH]   = useState(5);
  const [mcBusy, setMcBusy] = useState(false);
  const [mcProgress, setMcProgress] = useState(0);
  const [mcOut, setMcOut] = useState<MonteCarloOutput | null>(null);

  const kwDerived = useMemo(() => {
    if (data.length < 2) return config.risk_free_rate;
    const cur = data[data.length - 1]!;
    const prev = data[data.length - 2]!;
    return deriveKwFromStructure(cur, prev, ke_inp / 100, config.risk_free_rate, config);
  }, [data, ke_inp, config]);
  // S-9.4C structural baseline: kw recomputed at the config ke seed (keSeed),
  // the same value the live ke_inp starts from — not the analyst's moved ke_inp.
  // Moving the ke assumption drifts kwDerived from this; the AssumptionsPanel
  // surfaces the gap as a read-only badge. Sensitivity only — the rigor ladder
  // is untouched. Exactly equal to kwDerived at the initial ke_inp seed.
  const kwStructuralBaseline = useMemo(() => {
    if (data.length < 2) return config.risk_free_rate;
    const cur = data[data.length - 1]!;
    const prev = data[data.length - 2]!;
    return deriveKwFromStructure(cur, prev, keSeed, config.risk_free_rate, config);
  }, [data, keSeed, config]);
  const cyclicalNormalization = useMemo(() => buildCyclicalNormalization(data), [data]);
  const businessModel = useMemo(() => buildBusinessModelProfile(data), [data]);
  const persistenceTemplate = useMemo(() => ({
    normalizedGrowth: cyclicalNormalization.normalizedSalesGrowth ?? NP_SG,
    terminalGrowthFloor: 0.02,
    terminalGrowthCap: 0.05,
    growthFadeAlpha: 0.8,
    marginFadeAlpha: 0.9,
    atoFadeAlpha: 0.95,
  }), [cyclicalNormalization, NP_SG]);
  const driverModel = useMemo(() => buildDriverForecastModel({
    data,
    latest,
    businessModel,
    normalized: cyclicalNormalization,
    scenarioKey: "base",
    template: persistenceTemplate,
  }), [data, latest, businessModel, cyclicalNormalization, persistenceTemplate]);
  const persistenceScenario = useMemo(() => derivePersistenceForecastScenario({
    scenarioKey: "base",
    periods: data,
    latest,
    businessModel,
    horizon,
    template: persistenceTemplate,
    riskInputs: { ke: ke_inp / 100, kw: kwDerived, riskFreeRate: config.risk_free_rate },
  }), [data, latest, businessModel, horizon, persistenceTemplate, ke_inp, kwDerived, config.risk_free_rate]);
  const defaultWeights = persistenceScenario.forecastPolicy?.scenarioWeighting ?? {
    stress: 0.25,
    base: 0.4,
    bull: 0.2,
    historicalPanic: 0.15,
  };
  const [manualWeights, setManualWeights] = useState<ForecastScenarioWeighting | null>(null);
  const probabilityState = useMemo(
    () => buildForecastProbabilityState(manualWeights ?? defaultWeights),
    [manualWeights, defaultWeights],
  );
  const terminalEconomics = useMemo(
    () => buildTerminalEconomics({
      latest,
      normalized: cyclicalNormalization,
      businessModel,
      driverPlan: driverModel,
      requiredReturn: kwDerived,
      terminalGrowthFloor: persistenceTemplate.terminalGrowthFloor,
      terminalGrowthCap: persistenceTemplate.terminalGrowthCap,
    }),
    [latest, cyclicalNormalization, businessModel, driverModel, kwDerived, persistenceTemplate],
  );
  const quarterlySummary = useMemo(() => buildQuarterlyDriverSummary(rawData, data), [rawData, data]);

  const valuationStatus = useMemo(() => {
    if (traceability) {
      if (
        traceability.confidence.status === "blocked"
        || traceability.qualityGate.scopeBlocked
        || traceability.qualityGate.valuationBlocked
        || (
          traceability.reconciliation.status !== "confirmed"
          && traceability.reconciliation.status !== "degraded"
        )
        || traceability.parserFidelity.status === "failed"
      ) {
        return "blocked" as const;
      }
      return traceability.confidence.status;
    }
    return valuationReadiness.status === "guarded" ? "guarded" : "production-ready";
  }, [traceability, valuationReadiness.status]);

  const displayMode = useMemo(() => buildForecastDisplayMode({
    valuationStatus,
    probabilityValid: probabilityState.isValid,
  }), [valuationStatus, probabilityState.isValid]);
  const provenance = useMemo(
    () => buildForecastProvenance({ traceability, valuationReadiness }),
    [traceability, valuationReadiness],
  );

  const scenarioCards = useMemo(() => {
    const kei = ke_inp / 100;
    const kwi = kwDerived;
    const scenarioSet = buildPersistenceForecastScenarioSet({
      periods: data,
      latest,
      businessModel,
      horizon,
      template: persistenceTemplate,
      riskInputs: { ke: kei, kw: kwi, riskFreeRate: config.risk_free_rate },
    });

    return [
      { key: "stress" as const, label: "Stress", forecast: scenarioSet.stress },
      { key: "base" as const, label: "Base", forecast: scenarioSet.base },
      { key: "bull" as const, label: "Bull", forecast: scenarioSet.bull },
      { key: "historical-panic" as const, label: "Panic", forecast: scenarioSet.historicalPanic },
    ].map((card) => {
      const probability = scenarioWeightForKey(probabilityState.weights, card.key);
      const forecast = {
        ...card.forecast,
        probability,
      };
      const periods = buildScenario(forecast, latest);
      const valuationPeriods = buildValuationPeriodsFromForecast(latest, periods);
      const valuationResult = computeValuation(valuationPeriods, kei, kwi, g_inp / 100, valuationConfig);
      return {
        ...card,
        probability,
        forecast: {
          ...forecast,
          periods,
          valuationResult,
        },
      };
    });
  }, [data, latest, businessModel, horizon, persistenceTemplate, ke_inp, kwDerived, config.risk_free_rate, probabilityState.weights, g_inp, valuationConfig]);

  const baseScenarioCard = scenarioCards.find((card) => card.key === "base");
  const fcPeriods = baseScenarioCard?.forecast.periods ?? [];
  const baseValuationPeriods = useMemo(
    () => baseScenarioCard?.forecast.periods ? buildValuationPeriodsFromForecast(latest, baseScenarioCard.forecast.periods) : data,
    [baseScenarioCard, latest, data],
  );

  const baseV = sharesOut
    ? toPerShare(baseScenarioCard?.forecast.valuationResult?.V_RE_CV3 ?? null, sharesOut) ?? 0
    : baseScenarioCard?.forecast.valuationResult?.V_RE_CV3 ?? 0;
  const sensResults = useMemo(()=>sensitivityAnalysis(
    baseV,
    {ke:ke_inp/100,kw:kwDerived,g:g_inp/100,core_pm:basePM,ato:baseATO,sales_growth:baseSG},
    (p)=>{
      if (!baseScenarioCard?.forecast.periods) return baseV;
      const scenarioForSensitivity = applyDriverSensitivityToScenario(
        {
          ...baseScenarioCard.forecast,
          drivers: {
            ...baseScenarioCard.forecast.drivers,
            ke: p.ke,
            kw: p.kw,
            g_terminal: p.g,
          },
        },
        { core_pm: basePM, ato: baseATO, sales_growth: baseSG },
        { core_pm: p.core_pm, ato: p.ato, sales_growth: p.sales_growth },
      );
      const sensitivityPeriods = buildScenario(scenarioForSensitivity, latest);
      const valuationPeriods = buildValuationPeriodsFromForecast(latest, sensitivityPeriods);
      const r = computeValuation(valuationPeriods,p.ke,p.kw,p.g,valuationConfig);
      // Phase J2: V_RE_CV3 may be null; fall back to baseV (already 0 in
      // that case) so the sensitivity surface stays well-defined.
      return sharesOut
        ? toPerShare(r.V_RE_CV3, sharesOut) ?? baseV
        : (r.V_RE_CV3 ?? baseV);
    }
  ),[baseV,baseScenarioCard,latest,ke_inp,kwDerived,g_inp,basePM,baseATO,baseSG,valuationConfig,sharesOut]);

  const chartFade = Array.from({length:horizonT},((_,i)=>({
    year:`Y+${i+1}`,
    Sales_g: +(fadeSG[i]!*100).toFixed(1),
    PM:      +(fadePM[i]!*100).toFixed(1),
    ATO:     +fadeATO[i]!.toFixed(2),
    NP_PM:   +(NP_PM*100).toFixed(1),
    NP_ATO:  +NP_ATO.toFixed(2),
  })));

  const chartScen = fcPeriods.map(fp=>({
    year: fp.period_label,
    RE:   +(toPerShare(fp.RE_f, sharesOut) ?? fp.RE_f).toFixed(2),
    ReOI: +(toPerShare(fp.ReOI_f, sharesOut) ?? fp.ReOI_f).toFixed(2),
    OI:   +(toPerShare(fp.OI_f, sharesOut) ?? fp.OI_f).toFixed(2),
    Sales:+(toPerShare(fp.Sales_f, sharesOut) ?? fp.Sales_f).toFixed(2),
    FCF:  +(toPerShare(fp.FCF_f, sharesOut) ?? fp.FCF_f).toFixed(2),
  }));

  const expectedValue = displayMode.showExpectedValue
    ? scenarioCards.reduce((sum, card) => sum + card.probability * (card.forecast.valuationResult?.V_RE_CV3 ?? 0), 0)
    : null;

  const setManualWeight = (key: ForecastScenarioKey, rawValue: string) => {
    const nextValue = Number(rawValue);
    if (!Number.isFinite(nextValue)) return;
    setManualWeights((current) => updateWeightsForKey(current ?? defaultWeights, key, nextValue));
  };

  const runMc = async () => {
    setMcBusy(true);
    setMcProgress(0);
    try {
      const out = await runMonteCarlo(
        {
          basePeriods: baseValuationPeriods,
          config: valuationConfig,
          N: 10000,
          horizonT: horizon,
          paramDistributions: {
            ke: { mean: ke_inp / 100, std: 0.01 },
            kw: { mean: kwDerived, std: 0.008 },
            g: { mean: g_inp / 100, std: 0.01 },
          },
        },
        (p) => setMcProgress(p),
      );
      setMcOut(out);
    } finally {
      setMcBusy(false);
    }
  };

  const mcHistogram = useMemo(() => {
    if (!mcOut?.V_RE_samples?.length) return [] as Array<{ bucket: string; n: number }>;
    const vals: number[] = sharesOut ? mcOut.V_RE_samples.map((v) => toPerShare(v, sharesOut) ?? 0) : mcOut.V_RE_samples;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const bins = 20;
    const step = (max - min) / bins || 1;
    const counts = new Array<number>(bins).fill(0);
    for (const v of vals) {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / step)));
      counts[idx]! += 1;
    }
    return counts.map((n, i) => ({ bucket: `${cr(min + i * step)}–${cr(min + (i + 1) * step)}`, n }));
  }, [mcOut, sharesOut]);

  return (
    <div className="space-y-8">
      <SectionHeader
        title="Forecast"
        subtitle="Multi-scenario persistence-based forecasting with fade-to-median convergence"
        icon="📈"
      />

      {valuationReadiness.status !== "production-ready" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
          <b>Guarded forecast valuation.</b> {valuationReadiness.reasons[0]} Forecast scenarios still start from the latest reported period, so treat scenario values as review-only until the terminal period is normalized.
        </div>
      )}
      {displayMode.mode === "diagnostic-only" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <b>Diagnostic preview only.</b> Scenario values are shown only to help review assumptions; they are not eligible for point-estimate use while trust gates are blocked.
        </div>
      )}
      {traceabilitySummary && (
        <TraceabilityTrustPanel
          title="Forecast Trust Gate"
          summary={traceabilitySummary}
          confidenceStatus={valuationStatus}
          rigorLabel={traceability?.rigor.currentLabel}
          parserStatus={traceability?.parserFidelity.status}
          reconciliationStatus={traceability?.reconciliation.status}
          cautionHeading="Why this forecast should be treated cautiously"
        />
      )}
      <ProvenancePanel provenance={provenance} />
      {/* Scenario Range visual summary */}
      <ScenarioRangeChart
        scenarios={scenarioCards.map(c => ({
          label: c.label,
          value: sharesOut ? toPerShare(c.forecast.valuationResult?.V_RE_CV3 ?? null, sharesOut) ?? null : c.forecast.valuationResult?.V_RE_CV3 ?? null,
          probability: c.probability,
          color: scenarioColor(c.key),
        }))}
        marketPrice={config.market_price ?? null}
        expectedValue={expectedValue != null && sharesOut ? toPerShare(expectedValue, sharesOut) ?? null : expectedValue}
      />

      <AssumptionsPanel
        ke_inp={ke_inp}
        setKe={setKe}
        g_inp={g_inp}
        setG={setG}
        kwDerived={kwDerived}
        kwStructuralBaseline={kwStructuralBaseline}
        horizon={horizon}
        setH={setH}
        probabilityState={probabilityState}
        setManualWeight={setManualWeight}
        defaultWeights={defaultWeights}
        sharesOut={sharesOut}
        shareBasis={shareBasis}
        bridgeReady={bridgeReady}
        operatingBridge={operatingBridge}
      />

      <DriverGrid
        driverModel={driverModel}
        cyclicalNormalization={cyclicalNormalization}
        terminalEconomics={terminalEconomics}
        persistenceScenario={persistenceScenario}
        defaultWeights={defaultWeights}
        quarterlySummary={quarterlySummary}
      />

      <FadeAnalysisSection
        chartFade={chartFade}
        FADE_SG={FADE_SG}
        FADE_PM={FADE_PM}
        FADE_ATO={FADE_ATO}
        NP_SG={NP_SG}
        NP_PM={NP_PM}
        NP_ATO={NP_ATO}
      />

      <ScenarioValuationSection
        scenarioCards={scenarioCards}
        displayMode={displayMode}
        sharesOut={sharesOut}
        expectedValue={expectedValue}
        chartScen={chartScen}
      />

      {displayMode.showMonteCarlo && (
        <MonteCarloSection
          runMc={runMc}
          mcBusy={mcBusy}
          mcProgress={mcProgress}
          mcOut={mcOut}
          mcHistogram={mcHistogram}
          sharesOut={sharesOut}
        />
      )}

      {displayMode.mode !== "diagnostic-only" && (
        <SensitivitySection
          sensResults={sensResults}
          sharesOut={sharesOut}
        />
      )}

      {fcPeriods.length>0&&(
        <ProFormaTable
          fcPeriods={fcPeriods}
          sharesOut={sharesOut}
        />
      )}
    </div>
  );
}
