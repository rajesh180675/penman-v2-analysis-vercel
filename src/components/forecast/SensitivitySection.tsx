import { SensResult } from "../../engine/forecastingEngine";
import { cr } from "./ForecastReport.formatters";

export default function SensitivitySection({
  sensResults,
  sharesOut,
}: {
  sensResults: SensResult[];
  sharesOut: number | null;
}) {
  return (
    <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
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
  );
}
