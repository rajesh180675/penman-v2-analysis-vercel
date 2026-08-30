/**
 * TreemapChart — sized tiles for composition breakdowns (segment revenue,
 * subsidiary contribution, portfolio weights). Uses Recharts Treemap with
 * token palette + INR labels.
 */
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";
import { CHART_PALETTE, fmtINRFull, TOOLTIP_STYLE } from "./chartUtils";

export interface TreemapEntry {
  name: string;
  /** Size metric (absolute) */
  size: number;
  /** Optional display value (e.g. growth %) shown on the tile */
  display?: string | undefined;
  color?: string | undefined;
}

interface TreemapChartProps {
  entries: TreemapEntry[];
  height?: number | undefined;
  className?: string | undefined;
}

function TileContent(props: {
  x?: number; y?: number; width?: number; height?: number;
  name?: string; display?: string; color?: string; depth?: number;
}) {
  const { x = 0, y = 0, width = 0, height = 0, name, display, color, depth } = props;
  if (depth !== 1 || width < 4 || height < 4) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={5} fill={color} stroke="var(--color-surface-1)" strokeWidth={2} opacity={0.92} />
      {width > 52 && height > 30 && (
        <>
          <text x={x + 8} y={y + 16} fontSize={11} fontWeight={600} fill="#fff" style={{ pointerEvents: "none" }}>
            {name && name.length > Math.floor(width / 7) ? `${name.slice(0, Math.floor(width / 7))}…` : name}
          </text>
          {display && (
            <text x={x + 8} y={y + 30} fontSize={10} fontWeight={700} fill="rgba(255,255,255,0.85)" fontFamily="var(--font-mono)" style={{ pointerEvents: "none" }}>
              {display}
            </text>
          )}
        </>
      )}
    </g>
  );
}

export function TreemapChart({ entries, height = 300, className = "" }: TreemapChartProps) {
  const data = entries
    .filter((e) => e.size > 0)
    .map((e, i) => ({
      name: e.name,
      size: e.size,
      display: e.display,
      color: e.color ?? CHART_PALETTE[i % CHART_PALETTE.length],
    }));
  if (data.length === 0) {
    return <div className={`wb-chart-empty ${className}`} style={{ height }}>No data</div>;
  }
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer debounce={50} width="100%" height="100%">
        <Treemap
          data={data}
          dataKey="size"
          aspectRatio={4 / 3}
          stroke="var(--color-surface-1)"
          isAnimationActive={false}
          content={<TileContent />}
        >
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name) => [typeof value === "number" ? fmtINRFull(value) : value ?? "—", String(name)]}
          />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
