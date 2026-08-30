/**
 * Sparkline — tiny pure-SVG line/area micro-chart. Zero Recharts overhead.
 * Use inside Metric tiles, table cells, list rows, KPI strips.
 * Color is driven by wb-spark-* tone classes (token-based, dark-safe).
 */
export type SparkTone = "default" | "positive" | "negative" | "caution";

interface SparklineProps {
  values: (number | null | undefined)[];
  width?: number | undefined;
  height?: number | undefined;
  tone?: SparkTone | undefined;
  /** Show a dot on the last non-null point */
  showEndDot?: boolean | undefined;
  /** Fill area under the line */
  area?: boolean | undefined;
  className?: string | undefined;
}

export function Sparkline({
  values,
  width = 96,
  height = 28,
  tone = "default",
  showEndDot = true,
  area = true,
  className = "",
}: SparklineProps) {
  const pts = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (pts.length < 2) {
    return <svg width={width} height={height} className={className} aria-hidden />;
  }
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pad = 2;
  const iw = width - pad * 2;
  const ih = height - pad * 2;
  const step = iw / (pts.length - 1);
  const x = (i: number) => pad + i * step;
  const y = (v: number) => pad + ih - ((v - min) / span) * ih;
  const line = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const areaPath = `${line} L${x(pts.length - 1).toFixed(1)},${height - pad} L${pad},${height - pad} Z`;
  const toneClass = tone === "default" ? "" : ` wb-spark-${tone}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`wb-spark${toneClass} ${className}`} aria-hidden>
      {area && <path d={areaPath} className="wb-spark-area" />}
      <path d={line} className="wb-spark-line" />
      {showEndDot && <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1]!)} r={2} className="wb-spark-dot" />}
    </svg>
  );
}

/**
 * trendTone — pick a spark tone from a delta value.
 * `higherIsBetter` flips the sign convention (e.g. false for debt ratios).
 */
export function trendTone(delta: number | null | undefined, higherIsBetter = true): SparkTone {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 1e-9) return "default";
  const good = higherIsBetter ? delta > 0 : delta < 0;
  return good ? "positive" : "negative";
}
