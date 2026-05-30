import {
  ForecastScenarioKey,
  ForecastScenarioWeighting,
  ForecastProbabilityState,
} from "../../engine/types";
import { ResolvedShareBasis } from "../../engine/shareCountTools";
import { OperatingCostBridge } from "../../engine/types/recast";
import { pct, scenarioWeightForKey } from "./ForecastReport.formatters";

export default function AssumptionsPanel({
  ke_inp,
  setKe,
  g_inp,
  setG,
  kwDerived,
  horizon,
  setH,
  probabilityState,
  setManualWeight,
  defaultWeights,
  sharesOut,
  shareBasis,
  bridgeReady,
  operatingBridge,
}: {
  ke_inp: number;
  setKe: (v: number) => void;
  g_inp: number;
  setG: (v: number) => void;
  kwDerived: number;
  horizon: number;
  setH: (v: number) => void;
  probabilityState: ForecastProbabilityState;
  setManualWeight: (key: ForecastScenarioKey, rawValue: string) => void;
  defaultWeights: ForecastScenarioWeighting;
  sharesOut: number | null;
  shareBasis: ResolvedShareBasis;
  bridgeReady: boolean;
  operatingBridge: OperatingCostBridge | undefined;
}) {
  return (
    <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
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
  );
}
