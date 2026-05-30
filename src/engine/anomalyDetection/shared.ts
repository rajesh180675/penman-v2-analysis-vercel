import { SpecFlag, Severity } from "../types";

/* ── Helpers ────────────────────────────────────────────────────── */

export function medianOf(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

export function madStddev(vals: number[]): number {
  const med = medianOf(vals);
  if (med == null) return 0.001;
  const mad = medianOf(vals.map(v => Math.abs(v - med))) ?? 0.001;
  return Math.max(mad * 1.4826, 0.001); // MAD × 1.4826 ≈ robust σ
}

export function flag(
  spec_id: string, severity: Severity, label: string,
  message: string, affects_terminal: boolean, period: string
): SpecFlag {
  return { spec_id, severity, label, message, affects_terminal, period };
}
