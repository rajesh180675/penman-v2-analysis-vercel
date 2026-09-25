/**
 * GaugeChart — semicircle dial with a needle, for single KPI readings against
 * qualitative zones (cheap/fair/rich, weak/strong). Pure SVG.
 */
export interface GaugeZone {
  /** 0–1 start of the zone on the dial */
  from: number;
  /** 0–1 end of the zone */
  to: number;
  color: string;
  label?: string | undefined;
}

interface GaugeChartProps {
  /** 0–1 needle position */
  value: number;
  zones?: GaugeZone[] | undefined;
  width?: number | undefined;
  label?: string | undefined;
  valueText?: string | undefined;
  className?: string | undefined;
}

const DEFAULT_ZONES: GaugeZone[] = [
  { from: 0, to: 0.4, color: "var(--color-fin-positive)" },
  { from: 0.4, to: 0.7, color: "var(--color-fin-caution)" },
  { from: 0.7, to: 1, color: "var(--color-fin-negative)" },
];

export function GaugeChart({
  value,
  zones = DEFAULT_ZONES,
  width = 200,
  label,
  valueText,
  className = "",
}: GaugeChartProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const height = width * 0.62;
  const cx = width / 2;
  const cy = width / 2;
  const r = width / 2 - 10;
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from);
    const a1 = Math.PI * (1 - to);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    const large = to - from > 0.5 ? 1 : 0;
    return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
  };
  const needleAngle = Math.PI * (1 - clamped);
  const nx = cx + (r - 14) * Math.cos(needleAngle);
  const ny = cy - (r - 14) * Math.sin(needleAngle);

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${width / 2 + 8}`} role="img" aria-label={label ?? "gauge"}>
        {zones.map((z, i) => (
          <path key={i} d={arc(z.from, z.to)} stroke={z.color} strokeWidth={10} fill="none" opacity={0.85} strokeLinecap="round" />
        ))}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--color-text-1)" strokeWidth={2.5} strokeLinecap="round" className="wb-gauge-needle" />
        <circle cx={cx} cy={cy} r={4.5} fill="var(--color-text-1)" />
      </svg>
      {valueText && <div className="font-mono text-lg font-bold wb-text-1 -mt-3">{valueText}</div>}
      {label && <div className="text-xs wb-text-3 mt-0.5">{label}</div>}
    </div>
  );
}
