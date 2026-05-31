import { EngineConfig } from "../../engine/types";
import { computeValuation } from "../../engine/PenmanNissimEngine";
import { resolveValuationReadiness } from "../../engine/valuationPolicy";
import { buildValuationCommandCenter } from "../../engine/valuationCommandCenter";
import { useLiveMarketData } from "../../hooks/useLiveMarketData";
import { NumInput } from "./atoms";
import type { CVMethod } from "./ValuationReport.formatters";

export default function ValuationInputsPanel({
  keOverride,
  setKeOverride,
  keFromConfig,
  effectiveConfig,
  kwDerived,
  kwStructuralBaseline,
  g,
  setG,
  cv,
  setCv,
  commandCenter,
  liveMarketData,
  config,
  sharesOut,
  shareBasis,
  val,
  valuationReadiness,
}: {
  keOverride: number | null;
  setKeOverride: (v: number | null) => void;
  keFromConfig: number;
  effectiveConfig: EngineConfig;
  kwDerived: number;
  kwStructuralBaseline: number;
  g: number;
  setG: (v: number) => void;
  cv: CVMethod;
  setCv: (v: CVMethod) => void;
  commandCenter: ReturnType<typeof buildValuationCommandCenter>;
  liveMarketData: ReturnType<typeof useLiveMarketData>["snapshot"];
  config: EngineConfig;
  sharesOut: number | null;
  shareBasis: { source: string; confidence: string };
  val: ReturnType<typeof computeValuation>;
  valuationReadiness: ReturnType<typeof resolveValuationReadiness>;
}) {
  return (
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
          {Math.abs(kwDerived - kwStructuralBaseline) > 1e-4 && (
            <p className="text-xs text-amber-600 mt-0.5 font-medium" title="Recomputed kw at your overridden ke vs the structural baseline at config ke. Sensitivity exploration only — does not affect the rigor ladder.">
              Δ {(kwDerived - kwStructuralBaseline) >= 0 ? "+" : ""}{((kwDerived - kwStructuralBaseline) * 100).toFixed(2)}pp vs structural ({(kwStructuralBaseline * 100).toFixed(2)}%)
            </p>
          )}
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
  );
}
