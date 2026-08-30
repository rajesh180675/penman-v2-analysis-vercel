/**
 * BulletChart — Stephen Few bullet graph: a primary measure bar against
 * qualitative range bands, with a target marker. Pure CSS/SVG.
 * Compact alternative to gauges for KPI-vs-target display.
 */
interface BulletChartProps {
  /** Primary measure value */
  value: number;
  /** Target marker value (optional) */
  target?: number | undefined;
  /** Qualitative band breakpoints, ascending (e.g. [poor, ok, good]) */
  ranges: [number, number, number];
  /** Axis max — defaults to max(ranges[2], value, target) */
  max?: number | undefined;
  format?: ((v: number) => string) | undefined;
  label?: string | undefined;
  /** Bar tone */
  tone?: "accent" | "positive" | "negative" | "caution" | undefined;
  className?: string | undefined;
}

export function BulletChart({
  value,
  target,
  ranges,
  max,
  format = (v) => v.toFixed(1),
  label,
  tone = "accent",
  className = "",
}: BulletChartProps) {
  const axisMax = max ?? Math.max(ranges[2], value, target ?? 0) * 1.05;
  const pct = (v: number) => `${Math.min(100, (v / axisMax) * 100).toFixed(1)}%`;
  const barColor =
    tone === "positive"
      ? "var(--color-fin-positive)"
      : tone === "negative"
        ? "var(--color-fin-negative)"
        : tone === "caution"
          ? "var(--color-fin-caution)"
          : "var(--color-accent)";

  return (
    <div className={className}>
      {label && (
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-xs font-medium wb-text-2">{label}</span>
          <span className="text-xs font-mono font-semibold wb-text-1">{format(value)}</span>
        </div>
      )}
      <div className="relative h-4 w-full">
        {/* qualitative bands: poor → ok → good, darkest at left */}
        {[ranges[2], ranges[1], ranges[0]].map((_, i) => {
          const bandMax = ranges[2 - i] ?? ranges[2];
          const opacity = [0.14, 0.24, 0.36][i] ?? 0.2;
          return (
            <div
              key={i}
              className="absolute inset-y-0 left-0 wb-bullet-band"
              style={{ width: pct(bandMax), background: "var(--color-text-3)", opacity }}
            />
          );
        })}
        {/* measure bar */}
        <div className="absolute left-0 wb-bullet-measure" style={{ width: pct(value), background: barColor, top: "30%", bottom: "30%" }} />
        {/* target marker */}
        {target != null && (
          <div
            className="absolute wb-bullet-marker"
            style={{ left: pct(target), top: -2, bottom: -2, width: 2.5, background: "var(--color-text-1)" }}
          />
        )}
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[9px] wb-text-3">0</span>
        {target != null && <span className="text-[9px] wb-text-3">target {format(target)}</span>}
        <span className="text-[9px] wb-text-3">{format(axisMax)}</span>
      </div>
    </div>
  );
}
