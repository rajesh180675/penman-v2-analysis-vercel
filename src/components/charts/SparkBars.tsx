/**
 * SparkBars — column micro-chart for small series (period deltas, quarterly
 * beats/misses, sign patterns). Pure CSS flex columns, zero dependencies.
 * Positive columns rise from the baseline, negative drop below it.
 */
export type SparkBarTone = "default" | "positive" | "negative" | "caution" | "muted";

interface SparkBarsProps {
  values: (number | null | undefined)[];
  height?: number | undefined;
  /** Auto-color per bar by sign when true */
  colorBySign?: boolean | undefined;
  tone?: SparkBarTone | undefined;
  className?: string | undefined;
}

export function SparkBars({
  values,
  height = 28,
  colorBySign = true,
  tone = "default",
  className = "",
}: SparkBarsProps) {
  const vals = values.map((v) => (v != null && Number.isFinite(v) ? v : 0));
  if (vals.length === 0) return <div style={{ height }} className={className} />;
  const maxAbs = Math.max(...vals.map(Math.abs), 1e-9);
  const hasNeg = vals.some((v) => v < 0);
  const half = Math.floor(height / 2);

  const toneFor = (v: number): string => {
    if (!colorBySign) return tone === "default" ? "" : ` wb-sparkbar-col-${tone}`;
    if (v > 0) return " wb-sparkbar-col-positive";
    if (v < 0) return " wb-sparkbar-col-negative";
    return " wb-sparkbar-col-muted";
  };

  if (!hasNeg) {
    // Simple baseline-aligned bars
    return (
      <div className={`wb-sparkbar ${className}`} style={{ height }} role="img" aria-label="bar sparkline">
        {vals.map((v, i) => (
          <div key={i} className={`wb-sparkbar-col${toneFor(v)}`} style={{ height: `${(Math.abs(v) / maxAbs) * 100}%` }} />
        ))}
      </div>
    );
  }

  // Diverging bars around a center baseline
  return (
    <div className={`flex flex-col ${className}`} style={{ height }} role="img" aria-label="diverging bar sparkline">
      <div className="wb-sparkbar" style={{ height: half }}>
        {vals.map((v, i) => (
          <div
            key={i}
            className={`wb-sparkbar-col${toneFor(Math.max(v, 0))}`}
            style={{ height: `${(Math.max(v, 0) / maxAbs) * 100}%`, opacity: v > 0 ? undefined : 0 }}
          />
        ))}
      </div>
      <div className="wb-sparkbar" style={{ height: height - half, alignItems: "flex-start" }}>
        {vals.map((v, i) => (
          <div
            key={i}
            className={`wb-sparkbar-col${toneFor(Math.min(v, 0))}`}
            style={{ height: `${(Math.abs(Math.min(v, 0)) / maxAbs) * 100}%`, opacity: v < 0 ? undefined : 0 }}
          />
        ))}
      </div>
    </div>
  );
}
