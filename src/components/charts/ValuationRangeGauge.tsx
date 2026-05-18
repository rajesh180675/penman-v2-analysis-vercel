interface Props {
  /** Current market price */
  price: number | null;
  /** Floor value (e.g. EPV or stress scenario) */
  floor: number | null;
  /** Ceiling value (e.g. base or optimistic scenario) */
  ceiling: number | null;
  /** Mid-point intrinsic value */
  midpoint?: number | null;
}

/**
 * Horizontal gauge showing where market price sits relative to the intrinsic value range.
 * Green zone = undervalued, red zone = overvalued.
 */
export default function ValuationRangeGauge({ price, floor, ceiling, midpoint }: Props) {
  if (floor == null || ceiling == null || floor >= ceiling) {
    return null;
  }

  // Extend range 20% beyond floor/ceiling for visual context
  const rangeWidth = ceiling - floor;
  const displayMin = floor - rangeWidth * 0.2;
  const displayMax = ceiling + rangeWidth * 0.2;
  const displayRange = displayMax - displayMin;

  const toPercent = (v: number) => Math.max(0, Math.min(100, ((v - displayMin) / displayRange) * 100));

  const floorPct = toPercent(floor);
  const ceilingPct = toPercent(ceiling);
  const pricePct = price != null ? toPercent(price) : null;
  const midPct = midpoint != null ? toPercent(midpoint) : null;

  // Margin of safety
  const mos = price != null && midpoint != null && price > 0
    ? ((midpoint - price) / price) * 100
    : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Value Range</h3>
        {mos != null && (
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
            mos > 15 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            : mos > 0 ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
          }`}>
            Margin of Safety: {mos > 0 ? "+" : ""}{mos.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Gauge bar */}
      <div className="relative h-8 rounded-full bg-gradient-to-r from-red-100 via-amber-50 to-emerald-100 dark:from-red-900/20 dark:via-amber-900/10 dark:to-emerald-900/20 overflow-hidden">
        {/* Intrinsic value zone (green band) */}
        <div
          className="absolute top-0 h-full bg-emerald-200/50 dark:bg-emerald-800/30 border-x border-emerald-300 dark:border-emerald-700"
          style={{ left: `${floorPct}%`, width: `${ceilingPct - floorPct}%` }}
        />

        {/* Midpoint marker */}
        {midPct != null && (
          <div
            className="absolute top-0 h-full w-0.5 bg-indigo-500"
            style={{ left: `${midPct}%` }}
          />
        )}

        {/* Market price marker */}
        {pricePct != null && (
          <div
            className="absolute top-1 bottom-1 w-4 -ml-2 rounded-full bg-red-500 border-2 border-white dark:border-slate-800 shadow-sm"
            style={{ left: `${pricePct}%` }}
          />
        )}
      </div>

      {/* Labels */}
      <div className="relative h-5 mt-1 text-[10px] text-slate-500">
        <span className="absolute" style={{ left: `${floorPct}%`, transform: "translateX(-50%)" }}>
          ₹{floor.toFixed(0)}
        </span>
        {midPct != null && midpoint != null && (
          <span className="absolute font-medium text-indigo-600" style={{ left: `${midPct}%`, transform: "translateX(-50%)" }}>
            ₹{midpoint.toFixed(0)}
          </span>
        )}
        <span className="absolute" style={{ left: `${ceilingPct}%`, transform: "translateX(-50%)" }}>
          ₹{ceiling.toFixed(0)}
        </span>
        {pricePct != null && price != null && (
          <span className="absolute font-bold text-red-600" style={{ left: `${pricePct}%`, transform: "translateX(-50%)" }}>
            ₹{price.toFixed(0)}
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-200 inline-block" /> Intrinsic range</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Market price</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-indigo-500 inline-block" /> Midpoint</span>
      </div>
    </div>
  );
}
