import type { RecastPeriod } from "../../engine/types";
import { buildValuationCommandCenter, formatPct } from "../../engine/valuationCommandCenter";
import { computeMoatScore } from "../../engine/moatScoring";
import ExpectationBridgePanel from "../ExpectationBridgePanel";
import SensitivityHeatmap from "../charts/SensitivityHeatmap";
import FrameworkRadar from "../charts/FrameworkRadar";
import ForecastTornado from "../charts/ForecastTornado";
import MoatPanel from "../dashboard/MoatPanel";
import { rePerpetuityPerShare } from "../valuationScaleMath";

export default function AnchorAnalysisGrid({
  commandCenter,
  moatScore,
  ke,
  data,
}: {
  commandCenter: ReturnType<typeof buildValuationCommandCenter>;
  moatScore: ReturnType<typeof computeMoatScore>;
  ke: number;
  data: RecastPeriod[];
}) {
  // Non-null is safe: ValuationReport returns early below 2 periods
  // (ValuationReport.tsx:358), which is what the closures below already assume.
  const latest = data[data.length - 1]!;

  return (
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

      {/* Economic Moat Panel — 5-dimension Buffett/Munger framework */}
      <MoatPanel moat={moatScore} title="Economic Moat (5-Dimension Score)" />

      {/* Phase G2: Framework Radar + Sensitivity Heatmap */}
      <div className="grid gap-4 lg:grid-cols-2">
        <FrameworkRadar
          anchors={[
            { name: "Residual Earnings (base)", shortName: "V_RE", value: commandCenter.scenarios.find(s => s.key === "base")?.intrinsicPerShare ?? null },
            { name: "Residual Earnings (stress)", shortName: "V_Stress", value: commandCenter.scenarios.find(s => s.key === "stress")?.intrinsicPerShare ?? null },
            { name: "EPV (no-growth floor)", shortName: "EPV", value: commandCenter.epv?.epvPerShare ?? null },
            // Every spoke has to be ₹/share: FrameworkRadar divides each by
            // marketPrice. This slot used to hold reverseDcf's implied owner-
            // earnings growth — a fraction, which the radar's `value > 0`
            // filter accepts and then clamps to the 0.3× floor, inventing a
            // spoke and dragging the reported convergence σ with it. The
            // cash-lens FCFF DCF is the genuinely independent per-share leg
            // (cashFlowDcf.ts:1-16); the implied growth is a market-expectation
            // diagnostic, already surfaced as a percent by the
            // ExpectationBridgePanel in this same grid.
            { name: "Cash-lens FCFF DCF", shortName: "FCFF", value: commandCenter.cashFlowDcf?.perShare ?? null },
            // Read, not derived. `sotp.discountedSum` is an enterprise figure
            // that has to be bridged to equity (−NFO) before it can sit beside
            // four equity anchors, and the NFO it pairs with is the anchor
            // period's — which this component cannot resolve, since the anchor
            // moves off the newest period when the terminal one is contaminated
            // (valuationPolicy.ts:145-166). Dividing `discountedSum` here by
            // `shareBasis.shares` (and, before, scaling it by 1e7) produced a
            // spoke that was both unbridged and mis-scaled.
            { name: "SOTP (segment-weighted)", shortName: "SOTP", value: commandCenter.sotpPerShare },
          ]}
          marketPrice={commandCenter.marketPrice}
        />
        <SensitivityHeatmap
          ke={ke}
          g={commandCenter.scenarios.find(s => s.key === "base")?.assumptions.g ?? 0.05}
          computeValue={(keVal, gVal) => rePerpetuityPerShare({
            cse: latest.bs.CSE,
            noa: latest.bs.NOA,
            rnoa: latest.ratios?.RNOA ?? 0,
            ke: keVal,
            g: gVal,
            shares: commandCenter.shareBasis.shares,
          })}
          marketPrice={commandCenter.marketPrice}
        />
      </div>

      {/* Sensitivity Tornado — which drivers move intrinsic value the most */}
      {(() => {
        const baseScenario = commandCenter.scenarios.find(s => s.key === "base");
        const baseValue = baseScenario?.intrinsicPerShare ?? null;
        const baseG = baseScenario?.assumptions.g ?? 0.05;
        const rnoaBase = latest.ratios?.RNOA ?? 0;
        const noa = latest.bs.NOA;
        const shares = commandCenter.shareBasis.shares;

        if (!baseValue || !shares || shares <= 0) return null;

        // `baseValue` is `intrinsicPerShare`, a median of bare equity/shares
        // quotients (computeScenarioIntrinsicPerShare in
        // valuationCommandCenter/helpers.ts, over the per-share values built at
        // PenmanNissimEngine.ts:313). The drivers are differenced against it in
        // ForecastTornado (:42-43), so they have to be on that same ₹/share
        // scale; the ×1e7 that used to be here made every bar 1e7× the base.
        // A non-convergent perpetuity falls back to the base, i.e. no impact.
        const computeIV = (keV: number, gV: number, rnoaV: number, noaV: number) =>
          rePerpetuityPerShare({ cse: latest.bs.CSE, noa: noaV, rnoa: rnoaV, ke: keV, g: gV, shares }) ?? baseValue;

        const drivers = [
          {
            driver: "Cost of Equity (ke)",
            low: computeIV(ke + 0.01, baseG, rnoaBase, noa),
            high: computeIV(Math.max(0.01, ke - 0.01), baseG, rnoaBase, noa),
            range: "ke ±100 bps",
          },
          {
            driver: "Terminal Growth (g)",
            low: computeIV(ke, Math.max(0, baseG - 0.01), rnoaBase, noa),
            high: computeIV(ke, Math.min(ke - 0.01, baseG + 0.01), rnoaBase, noa),
            range: "g ±100 bps",
          },
          {
            driver: "RNOA (operating return)",
            low: computeIV(ke, baseG, rnoaBase * 0.8, noa),
            high: computeIV(ke, baseG, rnoaBase * 1.2, noa),
            range: "RNOA ±20%",
          },
          {
            driver: "NOA (capital base)",
            low: computeIV(ke, baseG, rnoaBase, noa * 0.9),
            high: computeIV(ke, baseG, rnoaBase, noa * 1.1),
            range: "NOA ±10%",
          },
        ].filter(d => Number.isFinite(d.low) && Number.isFinite(d.high));

        if (drivers.length === 0) return null;

        return (
          <ForecastTornado
            baseValue={baseValue}
            drivers={drivers}
            marketPrice={commandCenter.marketPrice}
          />
        );
      })()}

      {/* EPV Panel — Graham-Dodd no-growth floor anchor */}
      {commandCenter.epv && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Graham-Dodd EPV (Greenwald)</div>
              <div className="mt-1 text-sm text-slate-600">No-growth floor — what the business is worth if it never grows again</div>
            </div>
            <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${commandCenter.epv.moatSignal === "moat" ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : commandCenter.epv.moatSignal === "no-moat" ? "bg-red-50 text-red-700 border border-red-200"
                  : "bg-slate-50 text-slate-600 border border-slate-200"
              }`}>
              {commandCenter.epv.moatSignal === "moat" ? "🏰 Franchise Value Positive" : commandCenter.epv.moatSignal === "no-moat" ? "⚠️ No Moat" : "Inconclusive"}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Normalized NOPAT</div>
              <div className="text-lg font-bold text-slate-900">₹{commandCenter.epv.normalizedNOPAT.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">EPV per Share</div>
              <div className="text-lg font-bold text-slate-900">{commandCenter.epv.epvPerShare != null ? `₹${commandCenter.epv.epvPerShare.toFixed(0)}` : "—"}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Franchise Value</div>
              <div className={`text-lg font-bold ${commandCenter.epv.franchiseValue > 0 ? "text-emerald-700" : "text-red-700"}`}>
                ₹{commandCenter.epv.franchiseValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">MoS vs Market</div>
              <div className={`text-lg font-bold ${(commandCenter.epv.marginOfSafety ?? 0) > 0 ? "text-emerald-700" : "text-red-700"}`}>
                {commandCenter.epv.marginOfSafety != null ? `${(commandCenter.epv.marginOfSafety * 100).toFixed(1)}%` : "—"}
              </div>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Based on {commandCenter.epv.periodsUsed} periods median CoreOI. ke={((commandCenter.epv.ke) * 100).toFixed(1)}%.
            EPV_ops = ₹{commandCenter.epv.epvOperations.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr − NFO ₹{commandCenter.epv.nfo.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr = Equity ₹{commandCenter.epv.epvEquity.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr.
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
  );
}
