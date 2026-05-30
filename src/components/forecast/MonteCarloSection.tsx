import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { MonteCarloOutput } from "../../engine/monteCarloTypes";
import { toPerShare } from "../../engine/shareCountTools";
import { Mini } from "./atoms";
import { cr, share } from "./ForecastReport.formatters";

export default function MonteCarloSection({
  runMc,
  mcBusy,
  mcProgress,
  mcOut,
  mcHistogram,
  sharesOut,
}: {
  runMc: () => Promise<void>;
  mcBusy: boolean;
  mcProgress: number;
  mcOut: MonteCarloOutput | null;
  mcHistogram: Array<{ bucket: string; n: number }>;
  sharesOut: number | null;
}) {
  return (
    <div className="bg-white dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
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
          <ResponsiveContainer debounce={50} width="100%" height={220}>
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
  );
}
