import { useMemo } from "react";

interface Props {
  /** Base ke (cost of equity) */
  ke: number;
  /** Base terminal growth rate */
  g: number;
  /** Function that computes intrinsic value per share given (ke, g) */
  computeValue: (ke: number, g: number) => number | null;
  /** Current market price for color-coding */
  marketPrice?: number | null | undefined;
}

/**
 * Sensitivity heatmap: ke (rows) × g (cols) → intrinsic value per share.
 * Cells colored green (undervalued) to red (overvalued) relative to market price.
 */
export default function SensitivityHeatmap({ ke, g, computeValue, marketPrice = null }: Props) {
  // Generate ke range: ±3pp in 1pp steps
  const keSteps = useMemo(() => {
    const steps: number[] = [];
    for (let delta = -0.03; delta <= 0.03; delta += 0.01) {
      const val = ke + delta;
      if (val > 0.04 && val < 0.25) steps.push(val);
    }
    return steps;
  }, [ke]);

  // Generate g range: ±2pp in 0.5pp steps
  const gSteps = useMemo(() => {
    const steps: number[] = [];
    for (let delta = -0.02; delta <= 0.02; delta += 0.005) {
      const val = g + delta;
      if (val >= 0 && val < 0.12) steps.push(val);
    }
    return steps;
  }, [g]);

  // Compute grid
  const grid = useMemo(() => {
    return keSteps.map(keVal =>
      gSteps.map(gVal => computeValue(keVal, gVal))
    );
  }, [keSteps, gSteps, computeValue]);

  // Color scale — more granular for institutional feel
  function cellColor(value: number | null): string {
    if (value == null || marketPrice == null || marketPrice <= 0) return "bg-slate-100 dark:bg-slate-800";
    const ratio = value / marketPrice;
    if (ratio > 1.5) return "bg-emerald-300 dark:bg-emerald-800/70 text-emerald-900 dark:text-emerald-100";
    if (ratio > 1.3) return "bg-emerald-200 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200";
    if (ratio > 1.15) return "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300";
    if (ratio > 1.0) return "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400";
    if (ratio > 0.9) return "bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300";
    if (ratio > 0.8) return "bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300";
    if (ratio > 0.7) return "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300";
    return "bg-red-200 dark:bg-red-900/60 text-red-900 dark:text-red-200";
  }

  function isBase(keVal: number, gVal: number): boolean {
    return Math.abs(keVal - ke) < 0.001 && Math.abs(gVal - g) < 0.001;
  }

  function isFairValue(value: number | null): boolean {
    if (value == null || marketPrice == null || marketPrice <= 0) return false;
    const ratio = value / marketPrice;
    return ratio >= 0.95 && ratio <= 1.05;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
        Sensitivity: ke × Terminal Growth → Intrinsic Value
      </h3>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr>
              <th className="p-1.5 text-slate-500 font-medium">ke \ g</th>
              {gSteps.map((gVal, i) => (
                <th key={i} className={`p-1.5 font-medium ${Math.abs(gVal - g) < 0.001 ? "text-indigo-700 dark:text-indigo-300" : "text-slate-500"}`}>
                  {(gVal * 100).toFixed(1)}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keSteps.map((keVal, ri) => (
              <tr key={ri}>
                <td className={`p-1.5 font-medium ${Math.abs(keVal - ke) < 0.001 ? "text-indigo-700 dark:text-indigo-300" : "text-slate-500"}`}>
                  {(keVal * 100).toFixed(1)}%
                </td>
                {gSteps.map((gVal, ci) => {
                  const val = grid[ri]![ci]!;
                  return (
                    <td
                      key={ci}
                      className={`p-1.5 text-center rounded ${cellColor(val)} ${
                        isBase(keVal, gVal) ? "ring-2 ring-indigo-500 font-bold"
                        : isFairValue(val) ? "ring-2 ring-orange-400 ring-offset-1"
                        : ""
                      }`}
                    >
                      {val != null ? `₹${val.toFixed(0)}` : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-200 inline-block" /> Undervalued (&gt;15% MoS)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-50 border border-amber-200 inline-block" /> Fair value</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block" /> Overvalued</span>
        {marketPrice != null && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded ring-2 ring-orange-400 inline-block bg-white dark:bg-slate-900" />
            Fair value (±5%)
          </span>
        )}
        {marketPrice != null && <span className="ml-auto">Market: ₹{marketPrice.toLocaleString("en-IN")}</span>}
      </div>
    </div>
  );
}
