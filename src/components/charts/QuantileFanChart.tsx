/**
 * QuantileFanChart — PVRE probabilistic valuation range.
 * Renders the q05–q95 cone as nested bands (outer 90%, inner 50%), a median
 * line, and an optional market-price reference. Pure SVG on a quantile
 * summary — no raw simulation array needed.
 */
import { fmtINRFull } from "./chartUtils";

export interface QuantileBand {
  label: string;
  q05: number;
  q25: number;
  q50: number;
  q75: number;
  q95: number;
}

interface QuantileFanChartProps {
  band: QuantileBand;
  referencePrice?: number | null | undefined;
  /** P(intrinsic > price) 0–1 — shown as a badge */
  probabilityUndervalued?: number | null | undefined;
  width?: number | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

export function QuantileFanChart({
  band,
  referencePrice,
  probabilityUndervalued,
  width = 460,
  height = 200,
  className = "",
}: QuantileFanChartProps) {
  const vals = [band.q05, band.q25, band.q50, band.q75, band.q95, referencePrice].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (vals.length < 5) return <div className={`wb-chart-empty ${className}`} style={{ height }}>No distribution</div>;

  const min = Math.min(...vals) * 0.97;
  const max = Math.max(...vals) * 1.03;
  const span = max - min || 1;
  const padL = 8;
  const padR = 8;
  const midY = height / 2;
  const x = (v: number) => padL + ((v - min) / span) * (width - padL - padR);

  // Band heights (vertical thickness) per quantile tier — visual metaphor:
  // closer to median = taller band.
  const outerH = height * 0.34;
  const innerH = height * 0.52;

  return (
    <div className={className}>
      <svg width={width} height={height} role="img" aria-label={`Probabilistic range ${band.label}`}>
        {/* outer 90% band (q05–q95) */}
        <rect
          x={x(band.q05)}
          y={midY - outerH / 2}
          width={Math.max(1, x(band.q95) - x(band.q05))}
          height={outerH}
          rx={6}
          fill="var(--color-chart-1)"
          opacity={0.12}
        />
        {/* inner 50% band (q25–q75) */}
        <rect
          x={x(band.q25)}
          y={midY - innerH / 2}
          width={Math.max(1, x(band.q75) - x(band.q25))}
          height={innerH}
          rx={6}
          fill="var(--color-chart-1)"
          opacity={0.22}
        />
        {/* median line */}
        <line x1={x(band.q50)} y1={midY - innerH / 2 - 6} x2={x(band.q50)} y2={midY + innerH / 2 + 6} stroke="var(--color-chart-1)" strokeWidth={2.5} />
        {/* whisker end caps */}
        {[band.q05, band.q95].map((q, i) => (
          <line key={i} x1={x(q)} y1={midY - outerH / 2} x2={x(q)} y2={midY + outerH / 2} stroke="var(--color-chart-1)" strokeWidth={1.5} opacity={0.5} />
        ))}
        {/* market price reference */}
        {referencePrice != null && Number.isFinite(referencePrice) && (
          <g>
            <line x1={x(referencePrice)} y1={midY - innerH / 2 - 16} x2={x(referencePrice)} y2={midY + innerH / 2 + 16} stroke="var(--color-fin-caution)" strokeWidth={2} strokeDasharray="5 3" />
            <text x={x(referencePrice)} y={midY - innerH / 2 - 22} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--color-fin-caution)">
              MKT {fmtINRFull(referencePrice)}
            </text>
          </g>
        )}
        {/* quantile labels */}
        {[
          { q: band.q05, t: "P5" },
          { q: band.q25, t: "P25" },
          { q: band.q50, t: "P50" },
          { q: band.q75, t: "P75" },
          { q: band.q95, t: "P95" },
        ].map(({ q, t }) => (
          <g key={t}>
            <text x={x(q)} y={height - 18} textAnchor="middle" fontSize={9} fill="var(--color-text-3)">{t}</text>
            <text x={x(q)} y={height - 6} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--color-text-2)" fontFamily="var(--font-mono)">
              {fmtINRFull(q)}
            </text>
          </g>
        ))}
      </svg>
      {probabilityUndervalued != null && (
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            probabilityUndervalued >= 0.6
              ? "badge-positive"
              : probabilityUndervalued >= 0.4
                ? "badge-caution"
                : "badge-negative"
          }`}>
            {Math.round(probabilityUndervalued * 100)}% undervalued
          </span>
          <span className="text-[10px] wb-text-3">{band.label}</span>
        </div>
      )}
    </div>
  );
}
