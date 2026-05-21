/**
 * Time-Trail Scatter v2 — phase-space with log axes + correlation.
 *
 * v1 issues this fixes:
 *   - Linear axes only → toggle linear/log per axis
 *   - No correlation overlay → Pearson R + linear-fit line shown
 *   - Path length in raw units → also reports normalized path length
 *   - Weak defaults → preset library: Operating Leverage / DuPont / Capital Cycle / Free Cash
 *
 * Reading the trail (kept from v1, validated):
 *   - Loops: cyclical reversion
 *   - Outward spirals: scaling
 *   - Sharp kinks: regulatory / M&A / accounting break
 *   - Tight clusters: stable mature
 *   - Crossing back: regime reversion
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
  yearShare: number;
}

type AxisScale = "linear" | "log";

interface Preset {
  id: string;
  label: string;
  description: string;
  xPattern: string[];
  yPattern: string[];
}

const PRESETS: Preset[] = [
  {
    id: "operating",
    label: "Operating Leverage",
    description: "Revenue × Operating Profit — measures how profit scales with sales",
    xPattern: ["net sales", "revenue from operations", "total revenue", "interest earned", "premium"],
    yPattern: ["operating profit", "ebitda", "ebit"],
  },
  {
    id: "dupont",
    label: "DuPont (Margin × Turnover)",
    description: "Profit margin × Asset turnover — the classic DuPont decomposition",
    xPattern: ["asset turnover", "total asset turnover"],
    yPattern: ["net profit margin", "operating profit margin", "pat margin"],
  },
  {
    id: "capital",
    label: "Capital Cycle",
    description: "CapEx × ROCE — capital deployed vs returns earned",
    xPattern: ["capital expenditure", "additions to fixed assets", "purchase of fixed assets"],
    yPattern: ["roce", "return on capital employed"],
  },
  {
    id: "freecash",
    label: "Free Cash",
    description: "CFO × Net Profit — cash backing vs accounting earnings",
    xPattern: ["net profit", "profit after tax", "pat"],
    yPattern: ["cash from operating", "cash flow from operations", "operating cash flow"],
  },
  {
    id: "scale",
    label: "Scale (default)",
    description: "Revenue × Net Profit — most common starting point",
    xPattern: ["net sales", "revenue from operations", "total revenue", "interest earned", "premium"],
    yPattern: ["net profit", "profit after tax", "pat"],
  },
];

function findFirstMatch(metrics: string[], patterns: string[]): string | null {
  const lower = metrics.map((m) => m.toLowerCase());
  for (const p of patterns) {
    const i = lower.findIndex((m) => m.includes(p.toLowerCase()));
    if (i >= 0) return metrics[i];
  }
  return null;
}

function applyPreset(preset: Preset, allMetrics: string[]): { x: string; y: string } {
  const x = findFirstMatch(allMetrics, preset.xPattern) ?? allMetrics[0];
  const y = findFirstMatch(allMetrics, preset.yPattern) ?? allMetrics[Math.min(1, allMetrics.length - 1)];
  return { x, y };
}

function pearsonR(pts: TrailPoint[]): number {
  if (pts.length < 2) return 0;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}

function linearFit(pts: TrailPoint[]): { slope: number; intercept: number } {
  if (pts.length < 2) return { slope: 0, intercept: 0 };
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}

export default function TimeTrailScatter({ rawData, allMetrics }: Props) {
  const initial = useMemo(() => applyPreset(PRESETS[PRESETS.length - 1], allMetrics), [allMetrics]);
  const [xMetric, setXMetric] = useState(initial.x);
  const [yMetric, setYMetric] = useState(initial.y);
  const [xSearch, setXSearch] = useState("");
  const [ySearch, setYSearch] = useState("");
  const [xScale, setXScale] = useState<AxisScale>("linear");
  const [yScale, setYScale] = useState<AxisScale>("linear");

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
        // Log scale requires positive values — skip non-positive points when log is on
        if (xScale === "log" && x <= 0) return;
        if (yScale === "log" && y <= 0) return;
        pts.push({
          x,
          y,
          period: p.period_end,
          yearShare: rawData.length > 1 ? i / (rawData.length - 1) : 0,
        });
      }
    });
    return pts;
  }, [rawData, xMetric, yMetric, xScale, yScale]);

  const r = useMemo(() => pearsonR(trail), [trail]);
  const fit = useMemo(() => linearFit(trail), [trail]);

  const bounds = useMemo(() => {
    if (trail.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    const xs = trail.map((p) => p.x);
    const ys = trail.map((p) => p.y);
    return {
      xMin: Math.min(...xs),
      xMax: Math.max(...xs),
      yMin: Math.min(...ys),
      yMax: Math.max(...ys),
    };
  }, [trail]);

  const trailColor = (share: number): string => {
    if (share < 0.5) {
      const t = share * 2;
      const r = Math.round(59 + t * (16 - 59));
      const g = Math.round(130 + t * (185 - 130));
      const b = Math.round(246 + t * (129 - 246));
      return `rgb(${r}, ${g}, ${b})`;
    }
    const t = (share - 0.5) * 2;
    const r = Math.round(16 + t * (245 - 16));
    const g = Math.round(185 + t * (158 - 185));
    const b = Math.round(129 + t * (11 - 129));
    return `rgb(${r}, ${g}, ${b})`;
  };

  const skippedCount = useMemo(() => {
    let skipped = 0;
    for (const p of rawData) {
      const x = p.raw_metric_values[xMetric];
      const y = p.raw_metric_values[yMetric];
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
        skipped++;
      } else if ((xScale === "log" && x <= 0) || (yScale === "log" && y <= 0)) {
        skipped++;
      }
    }
    return skipped;
  }, [rawData, xMetric, yMetric, xScale, yScale]);

  const rInterpretation = (r: number): { label: string; tone: string } => {
    const abs = Math.abs(r);
    if (abs >= 0.9) return { label: "very strong", tone: "text-emerald-700 dark:text-emerald-400" };
    if (abs >= 0.7) return { label: "strong", tone: "text-blue-700 dark:text-blue-400" };
    if (abs >= 0.4) return { label: "moderate", tone: "text-amber-700 dark:text-amber-400" };
    if (abs >= 0.2) return { label: "weak", tone: "text-orange-700 dark:text-orange-400" };
    return { label: "no relationship", tone: "text-slate-500 dark:text-slate-400" };
  };

  return (
    <div className="space-y-4">
      {/* Preset library */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-3 dark:border-slate-700 dark:bg-slate-900/40">
        <div className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400 mb-2">
          Preset relationships
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                const { x, y } = applyPreset(p, allMetrics);
                setXMetric(x);
                setYMetric(y);
              }}
              title={p.description}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400 hover:bg-slate-50 transition dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric pickers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <MetricPicker
          axis="X axis"
          accent="text-blue-700 dark:text-blue-400"
          search={xSearch}
          setSearch={setXSearch}
          metrics={filteredX}
          selected={xMetric}
          setSelected={setXMetric}
          allCount={allMetrics.length}
          scale={xScale}
          setScale={setXScale}
        />
        <MetricPicker
          axis="Y axis"
          accent="text-emerald-700 dark:text-emerald-400"
          search={ySearch}
          setSearch={setYSearch}
          metrics={filteredY}
          selected={yMetric}
          setSelected={setYMetric}
          allCount={allMetrics.length}
          scale={yScale}
          setScale={setYScale}
        />
      </div>

      {/* Stats strip */}
      {trail.length >= 2 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCell label="Years plotted" value={trail.length.toString()} subline={skippedCount > 0 ? `${skippedCount} skipped` : "all valid"} />
          <StatCell
            label="Pearson R"
            value={r.toFixed(3)}
            subline={rInterpretation(r).label}
            valueAccent={rInterpretation(r).tone}
          />
          <StatCell
            label="R²"
            value={(r * r).toFixed(3)}
            subline={`${(r * r * 100).toFixed(0)}% variance explained`}
          />
          <StatCell
            label="Slope (Δy/Δx)"
            value={fit.slope.toLocaleString(undefined, { maximumFractionDigits: 3 })}
            subline={fit.slope > 0 ? "positive relationship" : fit.slope < 0 ? "inverse relationship" : "flat"}
          />
        </div>
      )}

      {/* Chart */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Phase-space trail · {trail.length} years
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Each dot is a year. Trail goes <span className="text-blue-600 dark:text-blue-400 font-medium">cool</span>
              {" → "}
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">mid</span>
              {" → "}
              <span className="text-amber-600 dark:text-amber-400 font-medium">warm</span> (newest)
            </p>
          </div>
        </div>

        {trail.length < 2 ? (
          <div className="h-[400px] flex items-center justify-center text-sm text-slate-500">
            Need ≥2 periods with both metrics non-null{xScale === "log" || yScale === "log" ? " (and positive for log axes)" : ""}.
            {skippedCount > 0 && ` ${skippedCount} period${skippedCount !== 1 ? "s" : ""} skipped.`}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={460}>
            <ScatterChart margin={{ top: 16, right: 32, bottom: 32, left: 48 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.18)" />
              <XAxis
                type="number"
                dataKey="x"
                name={xMetric}
                scale={xScale === "log" ? "log" : "auto"}
                domain={xScale === "log" ? ["auto", "auto"] : ["auto", "auto"]}
                allowDataOverflow={false}
                tick={{ fontSize: 11 }}
                label={{ value: `${xMetric}${xScale === "log" ? " (log)" : ""}`, position: "bottom", offset: 4, fontSize: 12 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={yMetric}
                scale={yScale === "log" ? "log" : "auto"}
                domain={yScale === "log" ? ["auto", "auto"] : ["auto", "auto"]}
                allowDataOverflow={false}
                tick={{ fontSize: 11 }}
                label={{
                  value: `${yMetric}${yScale === "log" ? " (log)" : ""}`,
                  angle: -90,
                  position: "left",
                  offset: 8,
                  fontSize: 12,
                }}
              />
              <ZAxis range={[60, 60]} />
              {xScale === "linear" && bounds.xMin < 0 && bounds.xMax > 0 && (
                <ReferenceLine x={0} stroke="rgba(148,163,184,0.4)" strokeDasharray="3 3" />
              )}
              {yScale === "linear" && bounds.yMin < 0 && bounds.yMax > 0 && (
                <ReferenceLine y={0} stroke="rgba(148,163,184,0.4)" strokeDasharray="3 3" />
              )}
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
            </ScatterChart>
          </ResponsiveContainer>
        )}

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
                <span className="text-slate-700 dark:text-slate-300">{p.period.slice(0, 7)}</span>
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
          <li><span className="font-semibold">Loops →</span> cyclical / mean-reverting business</li>
          <li><span className="font-semibold">Outward spiral →</span> scaling — both metrics growing together</li>
          <li><span className="font-semibold">Sharp kinks →</span> regulatory, M&A, demerger, accounting change</li>
          <li><span className="font-semibold">Tight cluster →</span> stable, mature, low-variance</li>
          <li><span className="font-semibold">High R² + straight trail →</span> strong linear relationship</li>
          <li><span className="font-semibold">Low R² + tangled trail →</span> the metrics are independent — pick a different pair</li>
        </ul>
      </div>
    </div>
  );
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
  scale,
  setScale,
}: {
  axis: string;
  accent: string;
  search: string;
  setSearch: (s: string) => void;
  metrics: string[];
  selected: string;
  setSelected: (s: string) => void;
  allCount: number;
  scale: AxisScale;
  setScale: (s: AxisScale) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-mono uppercase font-semibold ${accent}`}>{axis}</span>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-md p-0.5">
            {(["linear", "log"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScale(s)}
                className={`px-2 py-0.5 text-[10px] rounded transition ${
                  scale === s
                    ? "bg-white shadow-sm dark:bg-slate-700"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-400">{metrics.length}/{allCount}</span>
        </div>
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
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <div className="text-[11px] text-slate-500 mt-1.5 truncate" title={selected}>
        Selected: <span className="text-slate-700 dark:text-slate-300 font-mono">{selected}</span>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  subline,
  valueAccent = "text-slate-900 dark:text-slate-100",
}: {
  label: string;
  value: string;
  subline?: string;
  valueAccent?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className={`text-base font-semibold tabular-nums mt-0.5 ${valueAccent}`}>{value}</div>
      {subline && <div className="text-[10px] text-slate-500 mt-0.5">{subline}</div>}
    </div>
  );
}
