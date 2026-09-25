/**
 * RadialProgress — circular progress ring (0–1) with center label.
 * Pure SVG, animated via CSS transition on stroke-dashoffset.
 * Use for scores (quality, moat, confidence), completion, coverage.
 */
export type RadialTone = "accent" | "positive" | "caution" | "negative" | "neutral";

const TONE_COLOR: Record<RadialTone, string> = {
  accent: "var(--color-accent)",
  positive: "var(--color-fin-positive)",
  caution: "var(--color-fin-caution)",
  negative: "var(--color-fin-negative)",
  neutral: "var(--color-fin-muted)",
};

/** Pick a tone from a 0–1 score with conventional 60/75 thresholds. */
export function radialToneForScore(score: number): RadialTone {
  if (score >= 0.75) return "positive";
  if (score >= 0.5) return "accent";
  if (score >= 0.35) return "caution";
  return "negative";
}

interface RadialProgressProps {
  /** 0–1 */
  value: number;
  size?: number | undefined;
  strokeWidth?: number | undefined;
  tone?: RadialTone | undefined;
  /** Center content — defaults to percentage */
  label?: string | undefined;
  sublabel?: string | undefined;
  className?: string | undefined;
}

export function RadialProgress({
  value,
  size = 72,
  strokeWidth = 7,
  tone = "accent",
  label,
  sublabel,
  className = "",
}: RadialProgressProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped);
  const center = size / 2;
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={center} cy={center} r={r} strokeWidth={strokeWidth} className="wb-radial-track" />
        <circle
          cx={center}
          cy={center}
          r={r}
          strokeWidth={strokeWidth}
          stroke={TONE_COLOR[tone]}
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="wb-radial-fill"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono font-bold wb-text-1" style={{ fontSize: size * 0.22 }}>
          {label ?? `${Math.round(clamped * 100)}`}
        </span>
        {sublabel && (
          <span className="wb-text-3" style={{ fontSize: Math.max(8, size * 0.11) }}>{sublabel}</span>
        )}
      </div>
    </div>
  );
}
