import { CapAllocGrade } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function medianOf(values: number[]): number | null {
  const clean = values.filter(v => Number.isFinite(v));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Linear score: value at or above `good` → 100, at or below `bad` → 0 */
export function linearScore(value: number, bad: number, good: number): number {
  if (good === bad) return value >= good ? 100 : 0;
  return clamp(((value - bad) / (good - bad)) * 100, 0, 100);
}

export function gradeFromScore(score: number): CapAllocGrade {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

export function trendFromSeries(scores: number[]): "improving" | "stable" | "deteriorating" | "insufficient-data" {
  if (scores.length < 4) return "insufficient-data";
  const half = Math.floor(scores.length / 2);
  const early = medianOf(scores.slice(0, half)) ?? 0;
  const late  = medianOf(scores.slice(-half)) ?? 0;
  const delta = late - early;
  if (delta > 8)  return "improving";
  if (delta < -8) return "deteriorating";
  return "stable";
}
