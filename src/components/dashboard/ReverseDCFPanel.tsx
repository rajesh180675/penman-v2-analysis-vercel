import type { ReverseDCFResult } from '../../engine/reverseDCF';

interface Props {
  reverseDCF: ReverseDCFResult | null;
}

const verdictStyle: Record<string, string> = {
  priced_for_perfection: 'bg-red-900/40 text-red-300 border-red-700',
  reasonable: 'bg-green-900/40 text-green-300 border-green-700',
  priced_for_failure: 'bg-amber-900/40 text-amber-300 border-amber-700',
  asymmetric_upside: 'bg-cyan-900/40 text-cyan-300 border-cyan-700',
};

const verdictLabel: Record<string, string> = {
  priced_for_perfection: 'Priced for Perfection',
  reasonable: 'Reasonable',
  priced_for_failure: 'Priced for Failure',
  asymmetric_upside: 'Asymmetric Upside',
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const dollar = (v: number) => `₹${v.toFixed(0)}`;

export default function ReverseDCFPanel({ reverseDCF }: Props) {
  if (!reverseDCF) return null;
  const r = reverseDCF;
  const badge = verdictStyle[r.verdict] ?? verdictStyle.reasonable;

  const gaps = [
    { label: 'Growth', implied: r.impliedGrowth, hist: r.historicalGrowth, gap: r.growthGap, saturated: r.saturated?.impliedGrowth ?? false },
    { label: 'RNOA', implied: r.impliedRNOA, hist: r.historicalRNOA, gap: r.rnoaGap, saturated: r.saturated?.impliedRNOA ?? false },
  ];

  const sens = [
    ['0%', r.sensitivity.priceAtZeroGrowth],
    ['10%', r.sensitivity.priceAt10PctGrowth],
    ['15%', r.sensitivity.priceAt15PctGrowth],
    ['20%', r.sensitivity.priceAt20PctGrowth],
    ['Historical', r.sensitivity.priceAtHistoricalGrowth],
  ] as const;

  const decomp = r.priceDecomposition;

  return (
    <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-950/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">What Does Market Believe?</h3>
        <span className={`text-xs px-2 py-0.5 rounded border ${badge}`}>
          {verdictLabel[r.verdict] ?? r.verdict}
        </span>
      </div>

      {/* Implied vs Historical */}
      <table className="w-full text-xs text-slate-600 dark:text-slate-300">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left font-medium">Metric</th>
            <th className="text-right font-medium">Implied</th>
            <th className="text-right font-medium">Historical</th>
            <th className="text-right font-medium">Gap</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((g) => (
            <tr key={g.label}>
              <td>
                {g.label}
                {g.saturated && (
                  <span
                    className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                    title="Reverse-DCF solver hit its upper bound. Price implies more than the model is willing to model — treat as a signal, not a target."
                  >
                    saturated
                  </span>
                )}
              </td>
              <td className="text-right">{pct(g.implied)}</td>
              <td className="text-right">{pct(g.hist)}</td>
              <td className={`text-right font-medium ${g.gap > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {g.gap > 0 ? '+' : ''}{pct(g.gap)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {r.saturated?.any && (
        <div className="rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2 text-[11px] text-amber-900 dark:text-amber-200">
          <span className="font-semibold">Model saturated.</span> The current price implies expectations beyond what the reverse-DCF solver can rationalize ({[
            r.saturated.impliedGrowth && 'growth ≥ 40%',
            r.saturated.impliedRNOA && 'RNOA ≥ 80%',
            r.saturated.impliedFade && 'fade ≥ 0.95',
          ].filter(Boolean).join(', ')}). Treat the implied figures as a signal that the market is paying a premium the model can&apos;t price, not as forecasts.
        </div>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Market expects <span className="text-slate-800 dark:text-slate-200 font-medium">{r.impliedCAP} years</span> of competitive advantage
      </p>

      {/* Price Decomposition Bar */}
      <div>
        <p className="text-xs text-slate-500 mb-1">Price Decomposition (${r.marketPrice.toFixed(2)})</p>
        <div className="flex h-5 rounded overflow-hidden text-[10px] font-medium">
          <div className="bg-slate-600 flex items-center justify-center text-slate-800 dark:text-slate-200" style={{ width: `${decomp.noGrowthPct * 100}%` }}>
            {(decomp.noGrowthPct * 100).toFixed(0)}%
          </div>
          <div className="bg-blue-700 flex items-center justify-center text-blue-100" style={{ width: `${decomp.nearTermPct * 100}%` }}>
            {(decomp.nearTermPct * 100).toFixed(0)}%
          </div>
          <div className="bg-purple-700 flex items-center justify-center text-purple-100" style={{ width: `${decomp.longTermPct * 100}%` }}>
            {(decomp.longTermPct * 100).toFixed(0)}%
          </div>
        </div>
        <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
          <span>No Growth</span><span>Near-term</span><span>Long-term</span>
        </div>
      </div>

      {/* Sensitivity */}
      <div className="grid grid-cols-5 gap-1 text-center text-[10px]">
        {sens.map(([label, price]) => (
          <div key={label} className="bg-slate-100 dark:bg-slate-800 rounded p-1">
            <div className="text-slate-500">{label}</div>
            <div className="text-slate-800 dark:text-slate-200 font-medium">{dollar(price)}</div>
          </div>
        ))}
      </div>

      {r.narrative && (
        <p className="text-xs text-slate-500 dark:text-slate-400 italic leading-relaxed">{r.narrative}</p>
      )}
    </div>
  );
}
