import { buildDriverForecastModel } from "../../engine/forecastDriverModel";
import { buildCyclicalNormalization } from "../../engine/cyclicalNormalization";
import { buildTerminalEconomics } from "../../engine/terminalEconomics";
import { buildQuarterlyDriverSummary } from "../../engine/quarterlyDriverModel";
import { derivePersistenceForecastScenario } from "../../engine/forecastingEngine";
import { ForecastScenarioWeighting } from "../../engine/types";
import { pct, cr } from "./ForecastReport.formatters";

export default function DriverGrid({
  driverModel,
  cyclicalNormalization,
  terminalEconomics,
  persistenceScenario,
  defaultWeights,
  quarterlySummary,
}: {
  driverModel: ReturnType<typeof buildDriverForecastModel>;
  cyclicalNormalization: ReturnType<typeof buildCyclicalNormalization>;
  terminalEconomics: ReturnType<typeof buildTerminalEconomics>;
  persistenceScenario: ReturnType<typeof derivePersistenceForecastScenario>;
  defaultWeights: ForecastScenarioWeighting;
  quarterlySummary: ReturnType<typeof buildQuarterlyDriverSummary>;
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
      <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        <h3 className="text-base font-bold text-slate-800 mb-2">Driver-Based Forecast</h3>
        <div className="text-sm text-slate-700">{driverModel.narrative.join(" ")}</div>
        <div className="mt-4 grid gap-2 text-sm text-slate-700">
          <div>Year 1 sales growth: <strong>{driverModel.year1.salesGrowth != null ? pct(driverModel.year1.salesGrowth) : "—"}</strong></div>
          <div>Year 1 core margin: <strong>{driverModel.year1.coreMargin != null ? pct(driverModel.year1.coreMargin) : "—"}</strong></div>
          <div>Year 1 ATO: <strong>{driverModel.year1.ato != null ? `${driverModel.year1.ato.toFixed(2)}x` : "—"}</strong></div>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        <h3 className="text-base font-bold text-slate-800 mb-2">Cyclical Normalization</h3>
        <div className="grid gap-2 text-sm text-slate-700">
          <div>Status: <strong>{cyclicalNormalization.label}</strong></div>
          <div>Volatility score: <strong>{cyclicalNormalization.volatilityScore.toFixed(0)}</strong></div>
          <div>Normalized growth: <strong>{cyclicalNormalization.normalizedSalesGrowth != null ? pct(cyclicalNormalization.normalizedSalesGrowth) : "—"}</strong></div>
          <div>Normalized margin: <strong>{cyclicalNormalization.normalizedMargin != null ? pct(cyclicalNormalization.normalizedMargin) : "—"}</strong></div>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        <h3 className="text-base font-bold text-slate-800 mb-2">Terminal Economics</h3>
        <div className="grid gap-2 text-sm text-slate-700">
          <div>Terminal ROIC: <strong>{terminalEconomics.terminalRoic != null ? pct(terminalEconomics.terminalRoic) : "—"}</strong></div>
          <div>Terminal growth: <strong>{pct(terminalEconomics.terminalGrowth)}</strong></div>
          <div>Terminal reinvestment: <strong>{terminalEconomics.terminalReinvestmentRate != null ? pct(terminalEconomics.terminalReinvestmentRate) : "—"}</strong></div>
          <div>Competition pressure: <strong>{terminalEconomics.competitionPressure}</strong></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">{terminalEconomics.summary}</div>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
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
      <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
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
  );
}
