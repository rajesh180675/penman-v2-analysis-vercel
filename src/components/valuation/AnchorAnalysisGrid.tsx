import type { RecastPeriod } from "../../engine/types";
import { buildValuationCommandCenter, formatPct } from "../../engine/valuationCommandCenter";
import { computeMoatScore } from "../../engine/moatScoring";
import ExpectationBridgePanel from "../ExpectationBridgePanel";
import SensitivityHeatmap from "../charts/SensitivityHeatmap";
import FrameworkRadar from "../charts/FrameworkRadar";
import ForecastTornado from "../charts/ForecastTornado";
import MoatPanel from "../dashboard/MoatPanel";

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
            { name: "Reverse DCF implied", shortName: "RevDCF", value: commandCenter.reverseDcf?.impliedOwnerEarningsGrowth ?? null },
            { name: "SOTP (segment-weighted)", shortName: "SOTP", value: commandCenter.sotp != null && commandCenter.shareBasis.shares != null && commandCenter.shareBasis.shares > 0 ? (commandCenter.sotp.discountedSum / commandCenter.shareBasis.shares) * 1e7 : null },
          ]}
          marketPrice={commandCenter.marketPrice}
        />
        <SensitivityHeatmap
          ke={ke}
          g={commandCenter.scenarios.find(s => s.key === "base")?.assumptions.g ?? 0.05}
          computeValue={(keVal, gVal) => {
            // Simple RE perpetuity: CSE + (RNOA - ke) * NOA / (ke - g)
            const latest = data[data.length - 1]!;
            const rnoa = latest.ratios?.RNOA ?? 0;
            const noa = latest.bs.NOA;
            const cse = latest.bs.CSE;
            const shares = commandCenter.shareBasis.shares;
            if (!shares || shares <= 0 || keVal <= gVal) return null;
            const equity = cse + ((rnoa - keVal) * noa) / (keVal - gVal);
            return (equity / shares) * 1e7;
          }}
          marketPrice={commandCenter.marketPrice}
        />
      </div>

      {/* Sensitivity Tornado — which drivers move intrinsic value the most */}
      {(() => {
        const baseScenario = commandCenter.scenarios.find(s => s.key === "base");
        const baseValue = baseScenario?.intrinsicPerShare ?? null;
        const baseG = baseScenario?.assumptions.g ?? 0.05;
        const latest = data[data.length - 1]!;
        const rnoaBase = latest.ratios?.RNOA ?? 0;
        const noa = latest.bs.NOA;
        const cse = latest.bs.CSE;
        const shares = commandCenter.shareBasis.shares;

        if (!baseValue || !shares || shares <= 0) return null;

        const computeIV = (keV: number, gV: number, rnoaV: number, noaV: number) => {
          if (keV <= gV) return baseValue;
          const equity = cse + ((rnoaV - keV) * noaV) / (keV - gV);
          return (equity / shares) * 1e7;
        };

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
