/**
 * Shared chart formatting utilities for the financial dashboard.
 * Use these across all Recharts components for consistent INR display.
 */

/** Format rupee values for chart axes (compact: ₹1.2L, ₹45K, ₹890) */
export function fmtINR(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return `₹${v.toFixed(0)}`;
}

/** Format crore values for chart axes (compact: ₹1,200 Cr, ₹45 Cr) */
export function fmtCr(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return `₹${(v / 1000).toFixed(0)}K Cr`;
  if (abs >= 100) return `₹${v.toFixed(0)} Cr`;
  return `₹${v.toFixed(1)} Cr`;
}

/** Format percentage for chart axes (compact: 12.3%, -5.1%) */
export function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

/** Full INR display for tooltips (₹1,23,456) */
export function fmtINRFull(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** Full crore display for tooltips (₹1,234.5 Cr) */
export function fmtCrFull(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr`;
}

/** Institutional chart color palette — colorblind-safe, high-contrast */
export const CHART_COLORS = {
  primary: "#6366f1",    // indigo
  positive: "#10b981",   // emerald
  caution: "#f59e0b",    // amber
  negative: "#ef4444",   // red
  tertiary: "#8b5cf6",   // violet
  info: "#06b6d4",       // cyan
  highlight: "#f97316",  // orange
  accent: "#ec4899",     // pink
} as const;

/** Ordered array for multi-series charts */
export const CHART_PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.positive,
  CHART_COLORS.caution,
  CHART_COLORS.negative,
  CHART_COLORS.tertiary,
  CHART_COLORS.info,
  CHART_COLORS.highlight,
  CHART_COLORS.accent,
];

/** Shared tooltip style — institutional dark glass */
export const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  background: "rgba(15, 23, 42, 0.95)",
  border: "1px solid #334155",
  color: "#f1f5f9",
  padding: "8px 12px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
} as const;
