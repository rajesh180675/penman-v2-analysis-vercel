import type {
  CapitalBufferSeverity,
  NPACyclePosition,
  TrendDirection,
} from "../../engine/bankAssetQuality";

export function fmtCr(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L Cr`;
  if (Math.abs(v) >= 1000) return `₹${v.toFixed(0)} Cr`;
  return `₹${v.toFixed(2)} Cr`;
}

export function fmtPct(v: number | null, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtMultiple(v: number | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}x`;
}

/** Format a percentage that's already in % units (not 0–1 scale). */
export function fmtPctRaw(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

/** Format a number with commas, or em-dash for null/zero. */
export function fmtNum(v: number | null): string {
  if (v == null) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1000) {
    return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  }
  return v.toFixed(2);
}

/** Severity coloring for capital buffer cells. */
export function capitalToneClass(sev: CapitalBufferSeverity | null): string {
  if (sev === "breach") return "text-rose-700 dark:text-rose-300";
  if (sev === "thin") return "text-amber-700 dark:text-amber-300";
  return "";
}

/** Severity coloring for NPA cycle cells. */
export function npaToneClass(pos: NPACyclePosition | null): string {
  if (pos === "rising") return "text-rose-700 dark:text-rose-300";
  if (pos === "peaking") return "text-amber-700 dark:text-amber-300";
  if (pos === "improving") return "text-emerald-700 dark:text-emerald-300";
  return "";
}

/** Trend tone for PCR / slippage / CASA. */
export function trendToneClass(t: TrendDirection | null, semantic: "higher-is-good" | "lower-is-good"): string {
  if (!t) return "";
  if (t === "stable") return "";
  if (semantic === "higher-is-good") {
    return t === "improving" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300";
  }
  return t === "improving" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300";
}
