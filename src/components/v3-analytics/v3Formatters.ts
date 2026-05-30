/**
 * V3 Analytics shared formatters and color constants.
 * Extracted verbatim from V3AnalyticsPanel.tsx.
 */
export const pct = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`;
export const cr = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `₹${Math.abs(v) >= 10 ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : v.toFixed(1)} Cr`;
export const DS_COLORS: Record<string, string> = {
  NEGLIGIBLE: "text-emerald-700 bg-emerald-50",
  MINOR: "text-amber-700 bg-amber-50",
  MATERIAL: "text-orange-700 bg-orange-50",
  CRITICAL: "text-red-700 bg-red-50",
};

export const CONF_COLORS: Record<string, string> = {
  HIGH: "text-emerald-700 bg-emerald-50 border-emerald-200",
  MODERATE: "text-blue-700 bg-blue-50 border-blue-200",
  LOW: "text-amber-700 bg-amber-50 border-amber-200",
  VERY_LOW: "text-red-700 bg-red-50 border-red-200",
};

export const GRADE_COLORS: Record<string, string> = {
  GRADE_A: "text-emerald-700 bg-emerald-50",
  GRADE_B: "text-blue-700 bg-blue-50",
  GRADE_C: "text-amber-700 bg-amber-50",
  GRADE_D: "text-red-700 bg-red-50",
};
