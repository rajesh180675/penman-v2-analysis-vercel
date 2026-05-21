/**
 * Time-Trail Scatter — two metrics across time as a connected trail.
 *
 * Each dot is one fiscal year, dots connected chronologically with a
 * gradient line (oldest=cool, newest=warm). The shape of the trail
 * reveals regime changes invisible in side-by-side line charts:
 *
 *   - Loops: cyclical reversion (commodity, autos)
 *   - Outward spirals: scaling business (early-stage NBFCs)
 *   - Sharp kinks: regulatory or M&A breaks (HDFC merger, demergers)
 *   - Tight clusters: stable mature business (FMCG)
 *
 * Why this is novel: every fundamental tool plots metrics vs time.
 * None plot metric-A vs metric-B with time as the trajectory. This is
 * standard in physics phase-space diagrams and macro-economics but
 * essentially absent from corporate-fundamental visualization.
 */
import { useMemo, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import type { RawPeriodData } from "../../engine/types";

interface Props {
  rawData: RawPeriodData[];
  allMetrics: string[];
}

interface TrailPoint {
  x: number;
  y: number;
  period: string;
  yearIdx: number;
  yearShare: number; // 0 for oldest, 1 for newest
}

// Smart defaults: try to find common pairs of interest
function pickInitialPair(allMetrics: string[]): [string, string] {
  const lower = allMetrics.map((m) => m.toLowerCase());
  const findIdx = (...needles: string[]): number => {
    for (const n of needles) {
      const i = lower.findIndex((m) => m.includes(n.toLowerCase()));
      if (i >= 0) return i;
    }
    return -1;
  };

  const x = findIdx("net sales", "revenue from operations", "total revenue", "interest earned", "premium");
  const y = findIdx("net profit", "profit after tax", "pat");
  if (x >= 0 && y >= 0) return [allMetrics[x], allMetrics[y]];
  return [allMetrics[0], allMetrics[Math.min(1, allMetrics.length - 1)]];
}

export default function TimeTrailScatter({ rawData, allMetrics }: Props) {
  const [xMetric, setXMetric] = useState<string>(() => pickInitialPair(allMetrics)[0]);
  const [yMetric, setYMetric] = useState<string>(() => pickInitialPair(allMetrics)[1]);
  const [xSearch, setXSearch] = useState("");
  const [ySearch, setYSearch] = useState("");

  const filteredX = useMemo(() => {
    const q = xSearch.toLowerCase().trim();
    return q ? allMetrics.filter((m) => m.toLowerCase().includes(q)) : allMetrics;
  }, [allMetrics, xSearch]);

  const filteredY = useMemo(() => {
    const q = ySearch.toLowerCase().trim();
    return q ? allMetrics.filter((m) => m.toLowerCase().includes(q)) : allMetrics;
  }, [allMetrics, ySearch]);

  const trail: TrailPoint[] = useMemo(() => {
    const pts: TrailPoint[] = [];
    rawData.forEach((p, i) => {
      const x = p.raw_metric_values[xMetric];
      const y = p.raw_metric_values[yMetric];
      if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) {
        pts.push({
          x,
          y,
          period: p.period_end,
          yearIdx: i,
          yearShare: rawData.length > 1 ? i / (rawData.length - 1) : 0,
        });
      }
    });
    return pts;
  }, [rawData, xMetric, yMetric]);

  // Axis bounds with 5% padding
  const bounds = useMemo(() => {
    if (trail.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    const xs = trail.map((p) => p.x);
    const ys = trail.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const xPad = (xMax - xMin) * 0.08 || Math.abs(xMax) * 0.1 || 1;
    const yPad = (yMax - yMin) * 0.08 || Math.abs(yMax) * 0.1 || 1;
    return {
      xMin: xMin - xPad,
      xMax: xMax + xPad,
      yMin: yMin - yPad,
      yMax: yMax + yPad,
    };
  }, [trail]);

  // Year-share to color: blue → emerald → amber
  const trailColor = (share: number): string => {
    if (share < 0.5) {
      // Cool → mid: blue (0) → emerald (0.5)
      const t = share * 2;
      const r = Math.round(59 + t * (16 - 59));
      const g = Math.round(130 + t * (185 - 130));
      const b = Math.round(246 + t * (129 - 246));
      return `rgb(${r}, ${g}, ${b})`;
    }
    // Mid → warm: emerald (0.5) → amber (1)
    const t = (share - 0.5) * 2;
    const r = Math.round(16 + t * (245 - 16));
    const g = Math.round(185 + t * (158 - 185));
    const b = Math.round(129 + t * (11 - 129));
    return `rgb(${r}, ${g}, ${b})`;
  };

  // Custom Recharts shape with chronological line trail
  const renderTrail = () => {
    if (trail.length < 2) return null;
    return null; // The line is drawn separately as <Scatter line> below
  };

  return (
    <div className="space-y-4">
      {/* Metric pickers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <MetricPicker
          axis="X axis (horizontal)"
          accent="text-blue-700 dark:text-blue-400"
          search={xSearch}
          setSearch={setXSearch}
          metrics={filteredX}
          selected={xMetric}
          setSelected={setXMetric}
          allCount={allMetrics.length}
        />
        <MetricPicker
          axis="Y axis (vertical)"
          accent="text-emerald-700 dark:text-emerald-400"
          search={ySearch}
          setSearch={setYSearch}
          metrics={filteredY}
          selected={yMetric}
          setSelected={setYMetric}
          allCount={allMetrics.length}
        />
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Time-Trail · {trail.length} years
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Each dot is a year. Trail goes <span className="text-blue-600 dark:text-blue-400 font-medium">cool</span> (oldest)
              {" → "}
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">mid</span>
              {" → "}
              <span className="text-amber-600 dark:text-amber-400 font-medium">warm</span> (newest)
            </p>
          </div>
          {trail.length >= 2 && (
            <div className="text-right text-xs">
              <div className="text-slate-500">Path length</div>
              <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                {pathLength(trail).toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </div>
            </div>
          )}
        </div>

        {trail.length < 2 ? (
          <div className="h-[400px] flex items-center justify-center text-sm text-slate-500">
            Need ≥2 periods with both metrics non-null. Try different metrics.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={460}>
            <ScatterChart margin={{ top: 16, right: 32, bottom: 32, left: 48 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.18)" />
              <XAxis
                type="number"
                dataKey="x"
                name={xMetric}
                domain={[bounds.xMin, bounds.xMax]}
                tick={{ fontSize: 11 }}
                label={{ value: xMetric, position: "bottom", offset: 4, fontSize: 12 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={yMetric}
                domain={[bounds.yMin, bounds.yMax]}
                tick={{ fontSize: 11 }}
                label={{
                  value: yMetric,
                  angle: -90,
                  position: "left",
                  offset: 8,
                  fontSize: 12,
                }}
              />
              <ZAxis range={[60, 60]} />
              {/* Reference lines at zero if axes cross */}
              {bounds.xMin < 0 && bounds.xMax > 0 && <ReferenceLine x={0} stroke="rgba(148,163,184,0.4)" strokeDasharray="3 3" />}
              {bounds.yMin < 0 && bounds.yMax > 0 && <ReferenceLine y={0} stroke="rgba(148,163,184,0.4)" strokeDasharray="3 3" />}
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as TrailPoint;
                  return (
                    <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-xl">
                      <div className="font-mono text-slate-400">{p.period}</div>
                      <div className="mt-1 tabular-nums">
                        <span className="text-blue-400">x:</span>{" "}
                        {p.x.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </div>
                      <div className="tabular-nums">
                        <span className="text-emerald-400">y:</span>{" "}
                        {p.y.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  );
                }}
              />
              {/* Connecting trail */}
              <Scatter
                data={trail}
                line={{ stroke: "rgba(148,163,184,0.45)", strokeWidth: 1.5 }}
                lineType="joint"
                shape="circle"
              >
                {trail.map((p, i) => (
                  <Cell
                    key={i}
                    fill={trailColor(p.yearShare)}
                    stroke={trailColor(p.yearShare)}
                    strokeWidth={i === trail.length - 1 ? 3 : 1}
                    r={i === 0 || i === trail.length - 1 ? 7 : 5}
                  />
                ))}
              </Scatter>
              {renderTrail()}
            </ScatterChart>
          </ResponsiveContainer>
        )}

        {/* Year-by-year breadcrumb */}
        {trail.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
            {trail.map((p) => (
              <div
                key={p.period}
                className="flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono"
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: trailColor(p.yearShare) }}
                />
                <span className="text-slate-700 dark:text-slate-300">
                  {p.period.slice(0, 7)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reading guide */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
        <h4 className="text-xs font-semibold text-amber-900 dark:text-amber-300 uppercase mb-2">
          Reading the trail
        </h4>
        <ul className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
          <li>
            <span className="font-semibold">Loops & figure-eights →</span> cyclical / mean-reverting business
          </li>
          <li>
            <span className="font-semibold">Outward spiral →</span> scaling — both metrics growing together
          </li>
          <li>
            <span className="font-semibold">Sharp kinks →</span> regulatory event, M&A, demerger, accounting change
          </li>
          <li>
            <span className="font-semibold">Tight cluster near origin →</span> stable, mature, low-variance
          </li>
          <li>
            <span className="font-semibold">Crossing back over itself →</span> reversion to a prior regime
          </li>
        </ul>
      </div>
    </div>
  );
}

function pathLength(pts: TrailPoint[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    d += Math.sqrt(dx * dx + dy * dy);
  }
  return d;
}

function MetricPicker({
  axis,
  accent,
  search,
  setSearch,
  metrics,
  selected,
  setSelected,
  allCount,
}: {
  axis: string;
  accent: string;
  search: string;
  setSearch: (s: string) => void;
  metrics: string[];
  selected: string;
  setSelected: (s: string) => void;
  allCount: number;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-mono uppercase font-semibold ${accent}`}>{axis}</span>
        <span className="text-[10px] text-slate-400">
          {metrics.length}/{allCount}
        </span>
      </div>
      <input
        type="search"
        placeholder="Search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 mb-2"
      />
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        size={6}
        className="w-full rounded-md border border-slate-300 px-1 py-1 text-xs font-mono dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        {metrics.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <div className="text-[11px] text-slate-500 mt-1.5 truncate" title={selected}>
        Selected: <span className="text-slate-700 dark:text-slate-300 font-mono">{selected}</span>
      </div>
    </div>
  );
}
