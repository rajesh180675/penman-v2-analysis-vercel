import { ReactNode, useState } from "react";

// ─── MetricCard ──────────────────────────────────────────────────────────────
interface MetricCardProps {
  label: string;
  value: number | null | undefined;
  format?: "pct" | "mult" | "currency" | "days" | "number" | "ratio";
  context?: string;
  trend?: number | null;
  benchmark?: { label: string; percentile: number } | null;
  onClick?: () => void;
}

function formatValue(value: number | null | undefined, format: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  switch (format) {
    case "pct": return `${(value * 100).toFixed(1)}%`;
    case "mult": return `${value.toFixed(2)}×`;
    case "currency": return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    case "days": return `${value.toFixed(0)}d`;
    case "ratio": return value.toFixed(3);
    default: return value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  }
}

export function MetricCard({ label, value, format = "number", context, trend, benchmark, onClick }: MetricCardProps) {
  return (
    <div
      className={`card-base p-4 ${onClick ? "cursor-pointer hover:ring-2 hover:ring-indigo-500/30 transition-all" : ""}`}
      onClick={onClick}
    >
      <p className="metric-label">{label}</p>
      <p className="metric-value mt-1">{formatValue(value, format)}</p>
      {trend != null && Number.isFinite(trend) && (
        <span className={`text-xs font-medium ${trend > 0 ? "text-emerald-600 dark:text-emerald-400" : trend < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-500"}`}>
          {trend > 0 ? "▲" : trend < 0 ? "▼" : "→"} {Math.abs(trend * 100).toFixed(1)}pp
        </span>
      )}
      {benchmark && (
        <div className="mt-2">
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>{benchmark.label}</span>
            <span>P{benchmark.percentile}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 mt-0.5">
            <div
              className="h-full rounded-full bg-indigo-500"
              style={{ width: `${Math.min(100, Math.max(0, benchmark.percentile))}%` }}
            />
          </div>
        </div>
      )}
      {context && <p className="metric-context">{context}</p>}
    </div>
  );
}

// ─── VerdictBanner ───────────────────────────────────────────────────────────
interface VerdictBannerProps {
  verdict: "buy" | "hold" | "avoid" | "insufficient-data";
  headline: string;
  subtitle?: string;
  confidence?: "high" | "medium" | "low" | null;
  metrics?: { label: string; value: string }[];
}

const VERDICT_STYLES = {
  buy: "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20",
  hold: "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20",
  avoid: "border-l-rose-500 bg-rose-50/50 dark:bg-rose-950/20",
  "insufficient-data": "border-l-slate-400 bg-slate-50/50 dark:bg-slate-900/50",
};

const VERDICT_ICONS = { buy: "🟢", hold: "🟡", avoid: "🔴", "insufficient-data": "⚪" };
const VERDICT_LABELS = { buy: "BUY", hold: "HOLD", avoid: "AVOID", "insufficient-data": "INSUFFICIENT DATA" };

export function VerdictBanner({ verdict, headline, subtitle, confidence, metrics }: VerdictBannerProps) {
  return (
    <div className={`card-verdict ${VERDICT_STYLES[verdict]}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">{VERDICT_ICONS[verdict]}</span>
            <span className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              {VERDICT_LABELS[verdict]}
            </span>
            {confidence && <ConfidenceBadge level={confidence} />}
          </div>
          <p className="mt-1 text-base font-medium text-slate-800 dark:text-slate-100">{headline}</p>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {metrics && metrics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-4">
          {metrics.map((m) => (
            <div key={m.label} className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">{m.label}</p>
              <p className="font-mono text-sm font-semibold text-slate-700 dark:text-slate-200">{m.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ConfidenceBadge ─────────────────────────────────────────────────────────
interface ConfidenceBadgeProps {
  level: "high" | "medium" | "low";
}

export function ConfidenceBadge({ level }: ConfidenceBadgeProps) {
  const styles = {
    high: "badge-positive",
    medium: "badge-caution",
    low: "badge-negative",
  };
  const labels = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };
  return <span className={styles[level]}>{labels[level]}</span>;
}

// ─── InsightBlock ────────────────────────────────────────────────────────────
interface InsightBlockProps {
  text: string;
  icon?: string;
}

export function InsightBlock({ text, icon = "💡" }: InsightBlockProps) {
  if (!text) return null;
  return (
    <div className="rounded-lg bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 px-4 py-3">
      <p className="insight-text">
        <span className="mr-1.5">{icon}</span>
        {text}
      </p>
    </div>
  );
}

// ─── ExpandableSection ───────────────────────────────────────────────────────
interface ExpandableSectionProps {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function ExpandableSection({ title, badge, defaultOpen = false, children }: ExpandableSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card-base overflow-hidden">
      <button
        className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className={`text-xs text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</span>
          {badge && <span className="badge-neutral">{badge}</span>}
        </div>
      </button>
      {open && <div className="border-t border-slate-100 dark:border-slate-800 px-5 py-4">{children}</div>}
    </div>
  );
}

// ─── TrendIndicator ──────────────────────────────────────────────────────────
interface TrendIndicatorProps {
  value: number | null;
  label?: string;
  format?: "pp" | "pct" | "abs";
}

export function TrendIndicator({ value, label, format = "pp" }: TrendIndicatorProps) {
  if (value == null || !Number.isFinite(value)) return <span className="text-xs text-slate-400">—</span>;
  const positive = value > 0.001;
  const negative = value < -0.001;
  const color = positive ? "text-emerald-600 dark:text-emerald-400" : negative ? "text-rose-600 dark:text-rose-400" : "text-slate-500";
  const arrow = positive ? "▲" : negative ? "▼" : "→";
  const formatted = format === "pp"
    ? `${Math.abs(value * 100).toFixed(1)}pp`
    : format === "pct"
    ? `${Math.abs(value * 100).toFixed(1)}%`
    : Math.abs(value).toFixed(2);

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      {arrow} {formatted}
      {label && <span className="text-slate-400 ml-1">{label}</span>}
    </span>
  );
}

// ─── BenchmarkBar ────────────────────────────────────────────────────────────
interface BenchmarkBarProps {
  value: number | null;
  min: number;
  max: number;
  zones?: { from: number; to: number; color: string; label?: string }[];
  label?: string;
}

export function BenchmarkBar({ value, min, max, zones, label }: BenchmarkBarProps) {
  if (value == null || !Number.isFinite(value)) return null;
  const range = max - min;
  const pct = range > 0 ? Math.min(100, Math.max(0, ((value - min) / range) * 100)) : 50;

  return (
    <div className="w-full">
      {label && <p className="text-[10px] text-slate-400 mb-0.5">{label}</p>}
      <div className="relative h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        {zones?.map((z, i) => {
          const left = ((z.from - min) / range) * 100;
          const width = ((z.to - z.from) / range) * 100;
          return (
            <div
              key={i}
              className="absolute top-0 h-full opacity-30"
              style={{ left: `${left}%`, width: `${width}%`, backgroundColor: z.color }}
            />
          );
        })}
        <div
          className="absolute top-0 h-full w-1 rounded-full bg-indigo-600 dark:bg-indigo-400"
          style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
        />
      </div>
    </div>
  );
}

// ─── SectionHeader ───────────────────────────────────────────────────────────
interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  icon?: string;
}

export function SectionHeader({ title, subtitle, icon }: SectionHeaderProps) {
  return (
    <div className="mb-4">
      <h2 className="section-title flex items-center gap-2">
        {icon && <span>{icon}</span>}
        {title}
      </h2>
      {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
interface SparklineProps {
  data: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  /** Show a reference line at this value */
  reference?: number;
}

/** Inline SVG sparkline — fits in table cells and KPI cards */
export function Sparkline({ data, width = 64, height = 20, color = "#6366f1", reference }: SparklineProps) {
  const valid = data.filter((v): v is number => v != null && Number.isFinite(v));
  if (valid.length < 2) return null;

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const padding = 1;

  const points = valid.map((v, i) => {
    const x = padding + (i / (valid.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((v - min) / range) * (height - 2 * padding);
    return `${x},${y}`;
  }).join(" ");

  const refY = reference != null
    ? height - padding - ((reference - min) / range) * (height - 2 * padding)
    : null;

  return (
    <svg width={width} height={height} className="inline-block align-middle">
      {refY != null && (
        <line x1={padding} y1={refY} x2={width - padding} y2={refY}
          stroke="#94a3b8" strokeWidth={0.5} strokeDasharray="2,2" />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── FormulaTooltip ──────────────────────────────────────────────────────────
interface FormulaTooltipProps {
  /** The displayed value/content */
  children: ReactNode;
  /** Formula in plain text (e.g. "ROCE = CNI / avg(CSE)") */
  formula: string;
  /** Actual computation for this period */
  computation?: string;
  /** Textbook reference */
  reference?: string;
}

/** Hover to see formula + computation + reference */
export function FormulaTooltip({ children, formula, computation, reference }: FormulaTooltipProps) {
  const [show, setShow] = useState(false);

  return (
    <span
      className="relative inline-block cursor-help border-b border-dotted border-slate-400"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 p-3 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-left pointer-events-none">
          <span className="block font-mono text-xs text-indigo-600 dark:text-indigo-400 mb-1">{formula}</span>
          {computation && <span className="block text-[11px] text-slate-600 dark:text-slate-300 mb-1">{computation}</span>}
          {reference && <span className="block text-[10px] text-slate-400 italic">{reference}</span>}
        </span>
      )}
    </span>
  );
}

// ─── DataFreshness ───────────────────────────────────────────────────────────
interface DataFreshnessProps {
  /** ISO date string of the latest period end */
  latestPeriod?: string;
  /** Label for data source */
  source?: string;
}

export function DataFreshness({ latestPeriod, source }: DataFreshnessProps) {
  if (!latestPeriod) return null;
  const date = new Date(latestPeriod);
  const now = new Date();
  const monthsAgo = Math.round((now.getTime() - date.getTime()) / (30.44 * 24 * 60 * 60 * 1000));
  const stale = monthsAgo > 6;

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${
      stale
        ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800"
        : "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
    }`}>
      {source && <span className="font-medium">{source}</span>}
      <span>{date.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</span>
      {stale && <span className="font-medium">({monthsAgo}mo stale)</span>}
    </span>
  );
}

// ─── RiskFlag ────────────────────────────────────────────────────────────────
interface RiskFlagProps {
  severity: "high" | "medium" | "low";
  label: string;
  detail?: string;
}

export function RiskFlag({ severity, label, detail }: RiskFlagProps) {
  const styles = {
    high: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800",
    medium: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
    low: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
  };
  const icons = { high: "🔴", medium: "🟡", low: "⚪" };

  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border ${styles[severity]}`} title={detail}>
      <span>{icons[severity]}</span>
      <span className="font-medium">{label}</span>
    </span>
  );
}

// ─── SourceBadge ─────────────────────────────────────────────────────────────
interface SourceBadgeProps {
  source: "capitaline" | "manual" | "estimated" | "screener" | "xbrl";
}

export function SourceBadge({ source }: SourceBadgeProps) {
  const map: Record<string, { label: string; color: string }> = {
    capitaline: { label: "Capitaline", color: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-800" },
    manual: { label: "Manual", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800" },
    estimated: { label: "Estimated", color: "bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800" },
    screener: { label: "Screener", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800" },
    xbrl: { label: "XBRL", color: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700" },
  };
  const { label, color } = map[source] ?? map.manual;

  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${color}`}>
      {label}
    </span>
  );
}

// ─── HeatmapCell ────────────────────────────────────────────────────────────
interface HeatmapCellProps {
  value: number | null;
  min?: number;
  max?: number;
  format?: "pct" | "mult" | "abs";
  /** If true, lower is better (e.g. PE ratio) */
  invert?: boolean;
}

export function HeatmapCell({ value, min = 0, max = 1, format = "pct", invert = false }: HeatmapCellProps) {
  if (value == null || !Number.isFinite(value)) {
    return <td className="px-2 py-1.5 text-center text-xs text-slate-400">—</td>;
  }
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const intensity = invert ? 1 - ratio : ratio;
  // Green (good) to red (bad) via amber
  const bg = intensity > 0.7
    ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300"
    : intensity > 0.4
    ? "bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300"
    : "bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300";

  const formatted = format === "pct" ? `${(value * 100).toFixed(1)}%`
    : format === "mult" ? `${value.toFixed(2)}×`
    : value.toFixed(1);

  return (
    <td className={`px-2 py-1.5 text-center text-xs font-mono font-medium rounded ${bg}`}>
      {formatted}
    </td>
  );
}

// ─── ProgressRing ───────────────────────────────────────────────────────────
interface ProgressRingProps {
  /** 0–100 percentage */
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}

export function ProgressRing({ value, size = 48, strokeWidth = 4, label }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference;
  const color = value >= 80 ? "stroke-emerald-500" : value >= 50 ? "stroke-amber-500" : "stroke-red-500";

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-slate-200 dark:text-slate-700"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={color}
        />
      </svg>
      {label && <span className="text-[9px] text-slate-500 dark:text-slate-400">{label}</span>}
    </div>
  );
}
