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
