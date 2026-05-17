import { useMemo, useState } from "react";
import {
  RecastPeriod,
  ForecastPeriod,
  FADE_PARAMS,
  NP_BENCHMARKS,
  EngineConfig,
  RawPeriodData,
  ke_from_config,
  ForecastScenarioKey,
  ForecastScenarioWeighting,
} from "../engine/types";
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
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend, ReferenceLine, Cell,
} from "recharts";
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

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
  traceability?: AnalysisTraceabilityEnvelope | null;
  traceabilitySummary?: ReturnType<typeof buildValuationTraceabilitySurfaceSummary> | null;
}
interface ExtendedProps extends Props { rawData?: RawPeriodData[] | null }

const pct = (v:number,d=1) => (v*100).toFixed(d)+"%";
const cr  = (v:number) => v.toLocaleString("en-IN",{maximumFractionDigits:0});
const share = (v:number | null | undefined, d=2) => v == null ? "—" : `₹${v.toFixed(d)}`;
function fadeArr(base:number,alpha:number,target:number,t:number):number[] {
  const arr:number[]=[];let prev=base;
  for(let i=0;i<t;i++){const n=alpha*prev+(1-alpha)*target;arr.push(n);prev=n;}
  return arr;
}

function scenarioWeightForKey(weights: ForecastScenarioWeighting, key: ForecastScenarioKey) {
  switch (key) {
    case "stress":
      return weights.stress;
    case "base":
      return weights.base;
    case "bull":
      return weights.bull;
    case "historical-panic":
      return weights.historicalPanic;
  }
}

function scenarioColor(key: ForecastScenarioKey) {
  switch (key) {
    case "stress":
      return "#f59e0b";
    case "base":
      return "#6366f1";
    case "bull":
      return "#10b981";
    case "historical-panic":
      return "#ef4444";
  }
}

function updateWeightsForKey(
  weights: ForecastScenarioWeighting,
  key: ForecastScenarioKey,
  value: number,
): ForecastScenarioWeighting {
  switch (key) {
    case "stress":
      return { ...weights, stress: value };
    case "base":
      return { ...weights, base: value };
    case "bull":
      return { ...weights, bull: value };
    case "historical-panic":
      return { ...weights, historicalPanic: value };
  }
}

export default function ForecastReport({data,config, rawData = null, traceability = null, traceabilitySummary: precomputedTraceabilitySummary = null}:ExtendedProps) {
  const keBase = ke_from_config(config);
  const valuationReadiness = useMemo(() => resolveValuationReadiness(data), [data]);
  const derivedTraceabilitySummary = useMemo(
    () => buildValuationTraceabilitySurfaceSummary(traceability),
    [traceability],
  );
  const traceabilitySummary = precomputedTraceabilitySummary ?? derivedTraceabilitySummary;
  const shareBasis = useMemo(() => resolveShareBasis(data, config), [data, config]);
  const valuationConfig = useMemo(() => shareBasis.valuationConfig, [shareBasis]);
  const sharesOut = shareBasis.shares ?? null;

  const latest = data[data.length-1];
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

  const [ke_inp,  setKe]  = useState(+(keBase*100).toFixed(1));
  const [g_inp,   setG]   = useState(5.0);
  const [horizon, setH]   = useState(5);
  const [mcBusy, setMcBusy] = useState(false);
  const [mcProgress, setMcProgress] = useState(0);
  const [mcOut, setMcOut] = useState<MonteCarloOutput | null>(null);

  const kwDerived = useMemo(() => {
    if (data.length < 2) return config.risk_free_rate;
    const cur = data[data.length - 1];
    const prev = data[data.length - 2];
    return deriveKwFromStructure(cur, prev, ke_inp / 100, config.risk_free_rate, config);
  }, [data, ke_inp, config]);
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
        || traceability.reconciliation.status === "failed"
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
    Sales_g: +(fadeSG[i]*100).toFixed(1),
    PM:      +(fadePM[i]*100).toFixed(1),
    ATO:     +fadeATO[i].toFixed(2),
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
      counts[idx] += 1;
    }
    return counts.map((n, i) => ({ bucket: `${cr(min + i * step)}–${cr(min + (i + 1) * step)}`, n }));
  }, [mcOut, sharesOut]);

  return (
    <div className="space-y-8">
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
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
        <div className="font-semibold text-slate-800">Forecast provenance</div>
        <div>Engine version: <b>{provenance.engineVersion || "unversioned"}</b></div>
        <div>Valuation policy: <b>{provenance.valuationPolicyVersion || "unversioned"}</b></div>
        <div>Traceability schema: <b>{provenance.traceabilitySchemaVersion || "unversioned"}</b></div>
        <div>Latest period: <b>{provenance.latestPeriod ?? "—"}</b></div>
        <div>Anchor period: <b>{provenance.anchorPeriod ?? "—"}</b>{provenance.fallbackUsed ? " · fallback anchor in use" : ""}</div>
        {provenance.generatedAt && <div>Generated at: <b>{provenance.generatedAt}</b></div>}
        {provenance.hasIncompleteVersionMetadata && (
          <div className="mt-2 text-amber-700">
            Version metadata is incomplete; treat this forecast as unverified against the current valuation rule set.
          </div>
        )}
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4">Forecast Assumptions — §4.3</h2>
        <div className="flex flex-wrap gap-4 items-end">
          {[
            {label:"ke % (Cost of Equity)",val:ke_inp,set:setKe},
            {label:"g % (Terminal Growth)",val:g_inp,set:setG},
          ].map(({label,val,set})=>(
            <div key={label}>
              <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
              <input type="number" step={0.5} value={val}
                onChange={e=>set(Number(e.target.value))}
                className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm"/>
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">kw % (Derived, S-9.4)</label>
            <div className="w-28 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-700 font-mono font-semibold">
              {(kwDerived * 100).toFixed(2)}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Horizon (years)</label>
            <select value={horizon} onChange={e=>setH(Number(e.target.value))}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              {[1,3,5,7,10,12,15].map(n=><option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {([
              { key: "stress", label: "Stress" },
              { key: "base", label: "Base" },
              { key: "bull", label: "Bull" },
              { key: "historical-panic", label: "Panic" },
            ] as Array<{ key: ForecastScenarioKey; label: string }>).map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-slate-600 mb-1">{`P(${label})`}</label>
                <input
                  type="number"
                  step={0.05}
                  value={scenarioWeightForKey(probabilityState.weights, key).toFixed(2)}
                  onChange={(e) => setManualWeight(key, e.target.value)}
                  className="w-20 px-2 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            ))}
          </div>
        </div>
        <div className={`mt-3 text-xs ${probabilityState.isValid ? "text-emerald-700" : "text-amber-700"}`}>
          {probabilityState.reason == null
            ? `Probability sum = ${probabilityState.total.toFixed(2)} (valid)`
            : probabilityState.reason}
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Policy default weighting: Stress {defaultWeights.stress.toFixed(2)} · Base {defaultWeights.base.toFixed(2)} · Bull {defaultWeights.bull.toFixed(2)} · Panic {defaultWeights.historicalPanic.toFixed(2)}
        </div>
        {sharesOut != null && (
          <div className="mt-3 text-xs text-slate-500 space-y-1">
            <div>Per-share base: <b>{sharesOut.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr shares</b></div>
            <div>Source: <b>{shareBasis.source}</b> · Confidence: <b>{shareBasis.confidence}</b></div>
          </div>
        )}
        {bridgeReady && operatingBridge && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-800 mb-2">Operating cost bridge is driving the forecast margin</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-slate-600">
              <div>Material / Sales: <span className="font-mono text-slate-800">{pct(operatingBridge.driverRatios.materialCostPct ?? 0)}</span></div>
              <div>Employee / Sales: <span className="font-mono text-slate-800">{pct(operatingBridge.driverRatios.employeeCostPct ?? 0)}</span></div>
              <div>Depreciation / Sales: <span className="font-mono text-slate-800">{pct(operatingBridge.driverRatios.depreciationPct ?? 0)}</span></div>
              <div>SG&A / Sales: <span className="font-mono text-slate-800">{pct(operatingBridge.driverRatios.sgaPct ?? 0)}</span></div>
              <div>Other opex / Sales: <span className="font-mono text-slate-800">{pct(operatingBridge.driverRatios.otherOperatingExpensePct ?? 0)}</span></div>
              <div>Other op income / Sales: <span className="font-mono text-slate-800">{pct(operatingBridge.driverRatios.otherOperatingIncomePct ?? 0)}</span></div>
              <div>Bridge PM: <span className="font-mono text-slate-800">{pct(operatingBridge.driverRatios.bridgeCoreSalesPm ?? 0)}</span></div>
              <div>Coverage: <span className="font-mono text-slate-800">{pct(operatingBridge.coverageRatio ?? 0)}</span></div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-bold text-slate-800 mb-2">Driver-Based Forecast</h3>
          <div className="text-sm text-slate-700">{driverModel.narrative.join(" ")}</div>
          <div className="mt-4 grid gap-2 text-sm text-slate-700">
            <div>Year 1 sales growth: <strong>{driverModel.year1.salesGrowth != null ? pct(driverModel.year1.salesGrowth) : "—"}</strong></div>
            <div>Year 1 core margin: <strong>{driverModel.year1.coreMargin != null ? pct(driverModel.year1.coreMargin) : "—"}</strong></div>
            <div>Year 1 ATO: <strong>{driverModel.year1.ato != null ? `${driverModel.year1.ato.toFixed(2)}x` : "—"}</strong></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-bold text-slate-800 mb-2">Cyclical Normalization</h3>
          <div className="grid gap-2 text-sm text-slate-700">
            <div>Status: <strong>{cyclicalNormalization.label}</strong></div>
            <div>Volatility score: <strong>{cyclicalNormalization.volatilityScore.toFixed(0)}</strong></div>
            <div>Normalized growth: <strong>{cyclicalNormalization.normalizedSalesGrowth != null ? pct(cyclicalNormalization.normalizedSalesGrowth) : "—"}</strong></div>
            <div>Normalized margin: <strong>{cyclicalNormalization.normalizedMargin != null ? pct(cyclicalNormalization.normalizedMargin) : "—"}</strong></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-bold text-slate-800 mb-2">Terminal Economics</h3>
          <div className="grid gap-2 text-sm text-slate-700">
            <div>Terminal ROIC: <strong>{terminalEconomics.terminalRoic != null ? pct(terminalEconomics.terminalRoic) : "—"}</strong></div>
            <div>Terminal growth: <strong>{pct(terminalEconomics.terminalGrowth)}</strong></div>
            <div>Terminal reinvestment: <strong>{terminalEconomics.terminalReinvestmentRate != null ? pct(terminalEconomics.terminalReinvestmentRate) : "—"}</strong></div>
            <div>Competition pressure: <strong>{terminalEconomics.competitionPressure}</strong></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">{terminalEconomics.summary}</div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-bold text-slate-800 mb-2">Scenario Policy</h3>
          <div className="grid gap-2 text-sm text-slate-700">
            <div>Spread posture: <strong>{persistenceScenario.forecastPolicy?.scenarioSpread ?? "—"}</strong></div>
            <div>
              Default weighting: <strong>
                Stress {defaultWeights.stress.toFixed(2)} · Base {defaultWeights.base.toFixed(2)} · Bull {defaultWeights.bull.toFixed(2)} · Panic {defaultWeights.historicalPanic.toFixed(2)}
              </strong>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              {(persistenceScenario.forecastPolicy?.scenarioWeightRationale ?? []).join(" ")}
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-bold text-slate-800 mb-2">Quarterly And TTM Driver View</h3>
          <div className="grid gap-2 text-sm text-slate-700">
            <div>Cadence: <strong>{quarterlySummary.filingCadence}</strong></div>
            <div>Latest filing: <strong>{quarterlySummary.latestQuarterLabel?.slice(0, 10) ?? "—"}</strong></div>
            <div>TTM revenue proxy: <strong>{quarterlySummary.ttmRevenueProxy != null ? `₹${cr(quarterlySummary.ttmRevenueProxy)}` : "—"}</strong></div>
            <div>TTM PAT proxy: <strong>{quarterlySummary.ttmPatProxy != null ? `₹${cr(quarterlySummary.ttmPatProxy)}` : "—"}</strong></div>
            <div>Run-rate margin: <strong>{quarterlySummary.drivers.marginRunRate != null ? pct(quarterlySummary.drivers.marginRunRate) : "—"}</strong></div>
            <div>Capacity read: <strong>{quarterlySummary.capacitySignal}</strong></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">{quarterlySummary.priceVolumeMixSignal}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-2">Fade Analysis — N&P Table 3</h2>
        <p className="text-xs text-slate-500 mb-4">Ratios mean-revert toward N&P historical medians (R<sub>t+1</sub> = α×R<sub>t</sub> + (1−α)×R̄ median)</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2">Sales Growth Fade (α={FADE_SG})</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartFade}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="year" tick={{fontSize:9}}/>
                <YAxis tick={{fontSize:9}} unit="%"/>
                <Tooltip formatter={(v:unknown)=>[`${v}%`]}/>
                <ReferenceLine y={NP_SG*100} stroke="#94a3b8" strokeDasharray="4 2" label={{value:"N&P",fontSize:9}}/>
                <Line type="monotone" dataKey="Sales_g" stroke="#6366f1" strokeWidth={2} dot/>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2">Core PM Fade (α={FADE_PM})</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartFade}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="year" tick={{fontSize:9}}/>
                <YAxis tick={{fontSize:9}} unit="%"/>
                <Tooltip formatter={(v:unknown)=>[`${v}%`]}/>
                <ReferenceLine y={NP_PM*100} stroke="#94a3b8" strokeDasharray="4 2" label={{value:"N&P",fontSize:9}}/>
                <Line type="monotone" dataKey="PM" stroke="#10b981" strokeWidth={2} dot/>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2">ATO Fade (α={FADE_ATO})</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartFade}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="year" tick={{fontSize:9}}/>
                <YAxis tick={{fontSize:9}}/>
                <Tooltip/>
                <ReferenceLine y={NP_ATO} stroke="#94a3b8" strokeDasharray="4 2" label={{value:"N&P",fontSize:9}}/>
                <Line type="monotone" dataKey="ATO" stroke="#f59e0b" strokeWidth={2} dot/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4">Scenario Valuation — §4.3.3</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {scenarioCards.map((card)=>(
            <div key={card.key} className="border rounded-xl p-4" style={{borderColor:`${scenarioColor(card.key)}44`}}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="w-3 h-3 rounded-full" style={{backgroundColor:scenarioColor(card.key)}}/>
                <span className="font-bold text-slate-800">{card.label}</span>
                <span className="text-xs text-slate-400">({(card.probability*100).toFixed(0)}%)</span>
                {displayMode.mode !== "interactive" && (
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${displayMode.mode === "diagnostic-only" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                    {displayMode.mode === "diagnostic-only" ? "Blocked" : "Review-only"}
                  </span>
                )}
              </div>
              {card.forecast.valuationResult&&(
                <div>
                  <div className="text-2xl font-bold" style={{color:scenarioColor(card.key)}}>
                    {card.forecast.valuationResult.V_RE_CV3 == null
                      ? <span className="text-amber-600">— Skipped (negative equity)</span>
                      : sharesOut
                        ? share(card.forecast.valuationResult.perShare?.intrinsic_re_per_share)
                        : `₹${cr(card.forecast.valuationResult.V_RE_CV3)}`}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {sharesOut ? "V (RE·CV3) per share" : "V (RE·CV3) Cr"}
                  </div>
                  {sharesOut && card.forecast.valuationResult.V_RE_CV3 != null && (
                    <div className="text-xs text-slate-500 mt-1">Total equity value: ₹{cr(card.forecast.valuationResult.V_RE_CV3)} Cr</div>
                  )}
                  <div className="mt-2 text-xs text-slate-500">
                    Sales g Y1: {pct(card.forecast.drivers.sales_growth[0])} → Y{card.forecast.horizonT}: {pct(card.forecast.drivers.sales_growth[card.forecast.horizonT-1]??card.forecast.drivers.sales_growth[0])}
                  </div>
                  <div className="text-xs text-slate-500">Core PM Y1: {pct(card.forecast.drivers.core_sales_pm[0])}</div>
                  {card.forecast.drivers.material_cost_ratio?.length ? (
                    <div className="text-xs text-slate-500">Material / Sales Y1: {pct(card.forecast.drivers.material_cost_ratio[0])}</div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
        {expectedValue == null ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
            <div className="text-sm font-semibold text-amber-800">
              Expected value unavailable until scenario probabilities sum to 1.00 and valuation trust supports point-estimate use.
            </div>
          </div>
        ) : (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-4">
            <div className="text-sm font-semibold text-indigo-800">
              Expected Value (probability-weighted): {sharesOut ? share(toPerShare(expectedValue, sharesOut)) : `₹${cr(expectedValue)} Cr`}
            </div>
          </div>
        )}

        {chartScen.length>0&&(
          <div>
            <div className="text-sm font-semibold text-slate-600 mb-3">Base Case Pro Forma — RE & ReOI Series {sharesOut ? "(₹ / share)" : "(₹ Cr)"}</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartScen}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="year" tick={{fontSize:10}}/>
                <YAxis tick={{fontSize:10}}/>
                <Tooltip/>
                <Legend wrapperStyle={{fontSize:11}}/>
                <ReferenceLine y={0} stroke="#94a3b8"/>
                <Bar dataKey="RE" name="RE" fill="#6366f1">
                  {chartScen.map((e,i)=><Cell key={i} fill={e.RE>=0?"#6366f1":"#ef4444"}/>) }
                </Bar>
                <Bar dataKey="ReOI" name="ReOI" fill="#10b981">
                  {chartScen.map((e,i)=><Cell key={i} fill={e.ReOI>=0?"#10b981":"#ef4444"}/>) }
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {displayMode.showMonteCarlo && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Monte Carlo Simulation — §4.1.1</h2>
              <p className="text-xs text-slate-500">N=10,000 simulations in Web Worker. Outputs valuation distribution percentiles{sharesOut ? " on a per-share basis" : ""}.</p>
            </div>
            <button onClick={runMc} disabled={mcBusy} className={`px-4 py-2 rounded-lg text-sm font-medium ${mcBusy?"bg-slate-300 text-slate-100":"bg-indigo-600 text-white hover:bg-indigo-700"}`}>
              {mcBusy ? `Running... ${(mcProgress * 100).toFixed(0)}%` : "Run Monte Carlo"}
            </button>
          </div>
          {mcOut && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm mb-4">
                <Mini title="P10 RE" value={sharesOut ? share(toPerShare(mcOut.p10_RE, sharesOut)) : `₹${cr(mcOut.p10_RE)}`} />
                <Mini title="P50 RE" value={sharesOut ? share(toPerShare(mcOut.p50_RE, sharesOut)) : `₹${cr(mcOut.p50_RE)}`} />
                <Mini title="P90 RE" value={sharesOut ? share(toPerShare(mcOut.p90_RE, sharesOut)) : `₹${cr(mcOut.p90_RE)}`} />
                <Mini title="P10 ReOI" value={sharesOut ? share(toPerShare(mcOut.p10_ReOI, sharesOut)) : `₹${cr(mcOut.p10_ReOI)}`} />
                <Mini title="P50 ReOI" value={sharesOut ? share(toPerShare(mcOut.p50_ReOI, sharesOut)) : `₹${cr(mcOut.p50_ReOI)}`} />
                <Mini title="P90 ReOI" value={sharesOut ? share(toPerShare(mcOut.p90_ReOI, sharesOut)) : `₹${cr(mcOut.p90_ReOI)}`} />
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={mcHistogram}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis dataKey="bucket" hide />
                  <YAxis tick={{fontSize:10}} />
                  <Tooltip />
                  <Bar dataKey="n" fill="#6366f1" />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      )}

      {displayMode.mode !== "diagnostic-only" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-bold text-slate-800 mb-2">Sensitivity Analysis — §4.3.4</h2>
          <p className="text-xs text-slate-500 mb-4">Each parameter varied ±20% from base. Impact = V_high − V_low {sharesOut ? "(₹ / share)" : "(₹ Cr)"}. Sorted by magnitude.</p>
          {sensResults.map(r=>{
            const maxImpact = Math.max(...sensResults.map(x=>x.impact),1);
            const pctW = r.impact/maxImpact*100;
            return (
              <div key={r.param} className="flex items-center gap-3 mb-2">
                <div className="w-40 text-xs text-slate-600 text-right truncate">{r.label}</div>
                <div className="flex-1 flex items-center gap-1">
                  <div className="h-5 bg-blue-200 rounded-l" style={{width:`${pctW/2}%`}}/>
                  <div className="h-5 bg-indigo-500 rounded-r" style={{width:`${pctW/2}%`}}/>
                </div>
                <div className="w-28 text-xs font-mono text-slate-500">{sharesOut ? `±₹${(r.impact/2).toFixed(2)}` : `±₹${cr(r.impact/2)}`}</div>
                <div className="w-36 text-xs text-slate-400">
                  {r.impact === 0
                    ? "inactive in current valuation path"
                    : sharesOut ? `[₹${r.low.toFixed(2)} – ₹${r.high.toFixed(2)}]` : `[${cr(r.low)} – ${cr(r.high)}]`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {fcPeriods.length>0&&(
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <h2 className="text-lg font-bold text-slate-800">Pro Forma Statement (Base Case)</h2>
            <p className="text-xs text-slate-500">Derived from accounting identities Eq.2,3,12,14 {sharesOut ? `· displayed as ₹ per share on the current ${sharesOut.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr share base` : ""}</p>
          </div>
          <div className="p-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b">
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Line Item</th>
                {fcPeriods.map(fp=><th key={fp.period_label} className="px-3 py-2 text-right text-xs font-semibold text-slate-500">{fp.period_label}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {([
                  {key:"Sales_f",label:"Sales",bold:true},
                  {key:"OI_f",label:"Operating Income (OI)"},
                  {key:"NFE_f",label:"Net Financial Expense (NFE)"},
                  {key:"CNI_f",label:"Comprehensive Net Income (CNI)",bold:true},
                  {key:"NOA_f",label:"Net Operating Assets (NOA)"},
                  {key:"CSE_f",label:"Common Equity (CSE)",bold:true},
                  {key:"ΔNOA_f",label:"ΔNOA"},
                  {key:"FCF_f",label:"Free Cash Flow (FCF = OI − ΔNOA)"},
                  {key:"RE_f",label:"Residual Earnings (RE)",bold:true},
                  {key:"ReOI_f",label:"Residual Op. Income (ReOI)",bold:true},
                ] as {key:keyof ForecastPeriod,label:string,bold?:boolean}[]).map(({key,label,bold})=>(
                  <tr key={key} className={`hover:bg-slate-50 ${bold?"bg-indigo-50/20":""}`}>
                    <td className={`px-3 py-2 text-slate-700 text-xs ${bold?"font-semibold":""}`}>{label}</td>
                    {fcPeriods.map(fp=>(
                      <td key={fp.period_label} className={`px-3 py-2 text-right font-mono text-xs ${bold?"font-semibold":""} ${(fp[key] as number)<0?"text-red-600":"text-slate-700"}`}>
                        {sharesOut ? share(toPerShare(fp[key] as number, sharesOut)) : `₹${cr(fp[key] as number)}`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ title, value }: { title: string; value: string }) {
  return (
    <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
      <div className="text-[11px] text-slate-500 uppercase">{title}</div>
      <div className="font-semibold text-slate-800">{value}</div>
    </div>
  );
}
