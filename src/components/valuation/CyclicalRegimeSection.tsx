import { buildCyclicalNormalization } from "../../engine/cyclicalNormalization";
import { buildRegimeContext } from "../../engine/regimeModel";
import { calibrateSignalBacktest } from "../../engine/signalBacktest";
import { buildTerminalEconomics } from "../../engine/terminalEconomics";
import { formatPct } from "../../engine/valuationCommandCenter";

export default function CyclicalRegimeSection({
  cyclicalNormalization,
  terminalEconomics,
  regimeContext,
  calibration,
}: {
  cyclicalNormalization: ReturnType<typeof buildCyclicalNormalization>;
  terminalEconomics: ReturnType<typeof buildTerminalEconomics>;
  regimeContext: ReturnType<typeof buildRegimeContext>;
  calibration: ReturnType<typeof calibrateSignalBacktest>;
}) {
  return (
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
          <div>Calibration band: <strong>{calibration.calibrationBand}</strong></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">{regimeContext.summary}</div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">{calibration.hitRateSummary}</div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">{calibration.alertDiscipline}</div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">{calibration.recommendation}</div>
        </div>
      </div>
    </section>
  );
}
