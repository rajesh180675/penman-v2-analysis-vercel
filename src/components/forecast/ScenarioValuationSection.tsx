import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, ReferenceLine, Cell,
} from "recharts";
import { ForecastScenarioCardSurface } from "../../engine/types";
import { buildForecastDisplayMode } from "../../engine/forecastPresentation";
import { toPerShare } from "../../engine/shareCountTools";
import { pct, cr, share, scenarioColor } from "./ForecastReport.formatters";

interface ChartScenRow {
  year: string;
  RE: number;
  ReOI: number;
  OI: number;
  Sales: number;
  FCF: number;
}

export default function ScenarioValuationSection({
  scenarioCards,
  displayMode,
  sharesOut,
  expectedValue,
  chartScen,
}: {
  scenarioCards: ForecastScenarioCardSurface[];
  displayMode: ReturnType<typeof buildForecastDisplayMode>;
  sharesOut: number | null;
  expectedValue: number | null;
  chartScen: ChartScenRow[];
}) {
  return (
    <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
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
                  Sales g Y1: {pct(card.forecast.drivers.sales_growth[0]!)} → Y{card.forecast.horizonT}: {pct(card.forecast.drivers.sales_growth[card.forecast.horizonT-1]??card.forecast.drivers.sales_growth[0]!)}
                </div>
                <div className="text-xs text-slate-500">Core PM Y1: {pct(card.forecast.drivers.core_sales_pm[0]!)}</div>
                {card.forecast.drivers.material_cost_ratio?.length ? (
                  <div className="text-xs text-slate-500">Material / Sales Y1: {pct(card.forecast.drivers.material_cost_ratio[0]!)}</div>
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
          <ResponsiveContainer debounce={50} width="100%" height={220}>
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
  );
}
