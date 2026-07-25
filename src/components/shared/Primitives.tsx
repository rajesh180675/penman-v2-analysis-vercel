import { ReactNode, useState } from "react";

// ─── Icon set (inline SVG, replaces emoji) ───────────────────────────────────
interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export type IconName =
  | "database" | "chart" | "folder" | "compass" | "satellite"
  | "table" | "calculator" | "search" | "mirror" | "building"
  | "trending-up" | "currency" | "bank" | "users" | "book"
  | "document" | "flask" | "microscope" | "wrench" | "chevron-right"
  | "chevron-down" | "alert" | "check" | "x" | "info" | "moon"
  | "sun" | "link" | "keyboard" | "command" | "printer" | "upload"
  | "shield" | "gauge" | "target" | "layers" | "zap";

const ICON_PATHS: Record<IconName, string> = {
  database: "M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M4 7c0-2 1-3 3-3h10c2 0 3 1 3 3M4 7h16M4 12h16M4 17h16",
  chart: "M3 3v18h18M8 17V9m4 8V5m4 12v-6",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  compass: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM16 8l-2 6-6 2 2-6 6-2z",
  satellite: "M13 7l4-4 4 4-4 4-4-4zM7 13l-4 4 4 4 4-4-4-4zM13 7l-6 6M7 13l6 6",
  table: "M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM3 9h18M3 15h18M9 3v18M15 3v18",
  calculator: "M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM8 7h8M8 11h2m4 0h2m-8 4h2m4 0h2m-8 4h2m4 0h2",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  mirror: "M8 3H5a2 2 0 00-2 2v14a2 2 0 002 2h3m8-18h3a2 2 0 012 2v14a2 2 0 01-2 2h-3M12 2v20",
  building: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m4 0v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  "trending-up": "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6",
  currency: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  bank: "M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11M8 14v3m4-3v3m4-3v3",
  users: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  book: "M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z",
  document: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M16 13H8m8 4H8m2-8H8",
  flask: "M9 3h6m-3 0v6m0 0l-5 9a2 2 0 001.8 3h6.4a2 2 0 001.8-3l-5-9m-2 6h4",
  microscope: "M6 18h8M3 22h18M14 22a7 7 0 100-14 7 7 0 000 14zM9 2l2 2m-2-2L7 4m2-2v6m0-6h6",
  wrench: "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z",
  "chevron-right": "M9 18l6-6-6-6",
  "chevron-down": "M6 9l6 6 6-6",
  alert: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01",
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18M6 6l12 12",
  info: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 16v-4m0-4h.01",
  moon: "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z",
  sun: "M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42",
  link: "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71",
  keyboard: "M2 6a2 2 0 012-2h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM6 10h2m4 0h2m4 0h2M6 14h2m4 0h6",
  command: "M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z",
  printer: "M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2m-12-4h12v8H6v-8z",
  upload: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  gauge: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z",
  target: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z",
  layers: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
};

export function Icon({ name, size = 18, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────
interface PanelProps {
  title?: string;
  subtitle?: string;
  statusDot?: "pass" | "current" | "blocked" | "pending" | null;
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  elevated?: boolean;
  children: ReactNode;
  className?: string;
}

export function Panel({
  title,
  subtitle,
  statusDot,
  actions,
  collapsible = false,
  defaultOpen = true,
  elevated = false,
  children,
  className = "",
}: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const base = elevated ? "wb-panel-elevated" : "wb-panel";

  if (collapsible) {
    return (
      <div className={`${base} overflow-hidden ${className}`}>
        <button
          className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <div className="flex items-center gap-2">
            {statusDot && <span className={`wb-rigor-dot wb-rigor-dot-${statusDot}`} />}
            <span className="text-sm font-semibold wb-text-1">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <Icon
              name="chevron-right"
              size={16}
              className={`wb-text-3 transition-transform ${open ? "rotate-90" : ""}`}
            />
          </div>
        </button>
        {open && <div className="border-t wb-divider px-5 py-4">{children}</div>}
      </div>
    );
  }

  return (
    <div className={`${base} ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b wb-divider">
          <div className="flex items-center gap-2">
            {statusDot && <span className={`wb-rigor-dot wb-rigor-dot-${statusDot}`} />}
            <div>
              {title && <h3 className="text-sm font-semibold wb-text-1">{title}</h3>}
              {subtitle && <p className="text-xs wb-text-2 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

// ─── Metric ──────────────────────────────────────────────────────────────────
interface MetricProps {
  label: string;
  value: string | number | null | undefined;
  format?: "pct" | "mult" | "currency" | "days" | "number" | "ratio" | undefined;
  context?: string | undefined;
  trend?: number | null | undefined;
  onClick?: () => void;
}

function formatMetricValue(value: string | number | null | undefined, format: string): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "—";
  switch (format) {
    case "pct": return `${(value * 100).toFixed(1)}%`;
    case "mult": return `${value.toFixed(2)}×`;
    case "currency": return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    case "days": return `${value.toFixed(0)}d`;
    case "ratio": return value.toFixed(3);
    default: return value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  }
}

export function Metric({ label, value, format = "number", context, trend, onClick }: MetricProps) {
  return (
    <div
      className={`wb-metric ${onClick ? "cursor-pointer hover:ring-2 hover:ring-indigo-500/30 transition-all" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      <p className="wb-metric-label">{label}</p>
      <p className="wb-metric-value mt-1">{formatMetricValue(value, format)}</p>
      {trend != null && Number.isFinite(trend) && (
        <span className={`text-xs font-medium ${trend > 0 ? "text-emerald-600 dark:text-emerald-400" : trend < 0 ? "text-rose-600 dark:text-rose-400" : "wb-text-3"}`}>
          {trend > 0 ? "▲" : trend < 0 ? "▼" : "→"} {Math.abs(trend * 100).toFixed(1)}pp
        </span>
      )}
      {context && <p className="wb-metric-context">{context}</p>}
    </div>
  );
}

// ─── TrustBadge / RigorStepper ───────────────────────────────────────────────
export type RigorLevel = "syntactically-valid" | "structurally-reconciled" | "economically-plausible" | "valuation-eligible" | "production-ready";
export type RigorStatus = "pass" | "current" | "blocked" | "pending";

const RIGOR_LEVELS: { key: RigorLevel; label: string }[] = [
  { key: "syntactically-valid", label: "Syntax" },
  { key: "structurally-reconciled", label: "Reconciled" },
  { key: "economically-plausible", label: "Plausible" },
  { key: "valuation-eligible", label: "Valuation" },
  { key: "production-ready", label: "Production" },
];

interface RigorStepperProps {
  currentLevel: RigorLevel;
  achievedLevels: RigorLevel[];
  blockedLevel?: RigorLevel | null | undefined;
  compact?: boolean;
}

export function RigorStepper({ currentLevel, achievedLevels, blockedLevel, compact = false }: RigorStepperProps) {
  const getStatus = (level: RigorLevel): RigorStatus => {
    if (blockedLevel === level) return "blocked";
    if (achievedLevels.includes(level)) return "pass";
    if (currentLevel === level) return "current";
    return "pending";
  };

  if (compact) {
    return (
      <div className="wb-rigor-stepper" title={`Rigor: ${currentLevel}`}>
        {RIGOR_LEVELS.map((level, i) => (
          <div key={level.key} className="wb-rigor-node">
            {i > 0 && (
              <div className={`wb-rigor-connector ${achievedLevels.includes(level.key) ? "wb-rigor-connector-pass" : ""}`} />
            )}
            <div
              className={`wb-rigor-dot wb-rigor-dot-${getStatus(level.key)} ${currentLevel === level.key && !achievedLevels.includes(level.key) ? "wb-node-pulse" : ""}`}
              title={level.label}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {RIGOR_LEVELS.map((level, i) => (
        <div key={level.key} className="flex items-center">
          {i > 0 && (
            <div className={`w-4 h-px mx-1 ${achievedLevels.includes(level.key) ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} />
          )}
          <div className="flex flex-col items-center gap-1">
            <div
              className={`wb-rigor-dot wb-rigor-dot-${getStatus(level.key)} ${currentLevel === level.key && !achievedLevels.includes(level.key) ? "wb-node-pulse" : ""}`}
            />
            <span className="text-[9px] font-medium uppercase tracking-wider wb-text-3 whitespace-nowrap">
              {level.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── EmptyState ──────────────────────────────────────────────────────────────
interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}

export function EmptyState({ icon = "info", title, body, action }: EmptyStateProps) {
  return (
    <div className="wb-empty">
      <div className="wb-empty-icon">
        <Icon name={icon} size={24} />
      </div>
      <p className="wb-empty-title">{title}</p>
      {body && <p className="wb-empty-body">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ─── ChartCard ───────────────────────────────────────────────────────────────
interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

export function ChartCard({ title, subtitle, children, className = "" }: ChartCardProps) {
  return (
    <div className={`wb-chart-card ${className}`}>
      <div className="wb-chart-card-header">
        <h3 className="wb-chart-card-title">{title}</h3>
        {subtitle && <p className="wb-chart-card-subtitle">{subtitle}</p>}
      </div>
      <div className="wb-chart-card-body">{children}</div>
    </div>
  );
}

// ─── EvidenceRail ────────────────────────────────────────────────────────────
interface EvidenceItemProps {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function EvidenceItem({ summary, children, defaultOpen = false }: EvidenceItemProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        className="wb-evidence-item w-full text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="wb-evidence-summary">{summary}</span>
        <Icon
          name="chevron-right"
          size={14}
          className={`wb-evidence-chevron ${open ? "wb-evidence-chevron-open" : ""}`}
        />
      </button>
      {open && <div className="px-4 py-3 border-b wb-divider">{children}</div>}
    </div>
  );
}

interface EvidenceRailProps {
  children: ReactNode;
  title?: string;
}

export function EvidenceRail({ children, title = "Evidence" }: EvidenceRailProps) {
  return (
    <Panel title={title} className="mt-6">
      <div className="divide-y wb-divider">{children}</div>
    </Panel>
  );
}

// ─── ContextHeader (3-zone canvas zone A) ────────────────────────────────────
interface ContextHeaderProps {
  ticker: string;
  companyType?: string | null | undefined;
  periodCount?: number;
  latestPeriod?: string;
  price?: number | null;
  marketCap?: number | null;
  rigorCurrent: RigorLevel;
  rigorAchieved: RigorLevel[];
  rigorBlocked?: RigorLevel | null | undefined;
  verdict?: "buy" | "hold" | "avoid" | "insufficient-data";
  confidence?: "high" | "medium" | "low" | null;
}

const VERDICT_STYLES: Record<string, string> = {
  buy: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800",
  hold: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
  avoid: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800",
  "insufficient-data": "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
};

export function ContextHeader({
  ticker,
  companyType,
  periodCount,
  latestPeriod,
  price,
  marketCap,
  rigorCurrent,
  rigorAchieved,
  rigorBlocked,
  verdict,
  confidence,
}: ContextHeaderProps) {
  return (
    <div className="wb-context-header">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
          <span className="font-bold text-indigo-700 dark:text-indigo-300 text-lg">{ticker.slice(0, 3)}</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold wb-text-1">{ticker}</h1>
            {verdict && (
              <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full border ${VERDICT_STYLES[verdict]}`}>
                {verdict.toUpperCase().replace("-", " ")}
              </span>
            )}
            {confidence && (
              <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${
                confidence === "high"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800"
                  : confidence === "medium"
                  ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800"
                  : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800"
              }`}>
                {confidence} confidence
              </span>
            )}
          </div>
          <p className="text-sm wb-text-2 mt-0.5">
            {companyType ?? "Industrial"}
            {periodCount != null && ` · ${periodCount} periods`}
            {latestPeriod && ` · ${latestPeriod.slice(0, 4)}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-6">
        {price != null && (
          <div className="text-right">
            <p className="font-mono text-xl font-bold wb-text-1">₹{price.toFixed(0)}</p>
            <p className="text-xs wb-text-2">{marketCap ? `₹${marketCap.toFixed(0)} Cr MCap` : "Market Price"}</p>
          </div>
        )}
        <RigorStepper
          currentLevel={rigorCurrent}
          achievedLevels={rigorAchieved}
          blockedLevel={rigorBlocked}
        />
      </div>
    </div>
  );
}
