/* ================================================================
   v3Analytics decomposition — shared numeric/format helpers.

   Pure leaf module: no imports, no back-edge. Both v3Analytics.ts and
   its cluster sub-modules (e.g. terminalValue) import these DOWN.

   Lifted verbatim from the Helpers block of v3Analytics.ts.
================================================================ */

export function medianOf(vals: number[]): number | null {
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}
export function computeCagr(first: number, last: number, years: number): number | null {
  if (first <= 0 || last <= 0 || years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}
export function pctStr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
