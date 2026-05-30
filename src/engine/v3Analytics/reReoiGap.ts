/* ══════════════════════════════════════════════════════════════════
   S-15.2 — RE / ReOI identity-gap decomposition
   Extracted verbatim from v3Analytics.ts (Plan 2 PR-2.2). Imports DOWN
   from ../types and ./shared only — no back-edge to v3Analytics.ts.
══════════════════════════════════════════════════════════════════ */
import { RecastPeriod } from "../types";
import { CanonicalOutputRegistry } from "./shared";

export interface ReReOIGapDecomposition {
  dirty_surplus: number;
  nfo_timing: number;
  tv_divergence: number;
  explicit_period_discounting: number;
  residual: number;
  total: number;
  dominant_driver: string;
}

export function decomposeReReOIGap(
  periods: RecastPeriod[],
  valuation: { V_RE_CV3: number; V_ReOI_CV03: number; CSE0: number; pvRE: number; CV_RE: number; CV_ReOI: number; ke: number; kw: number },
  gEffective: number,
  registry?: CanonicalOutputRegistry | undefined,
): ReReOIGapDecomposition {
  const T = Math.max(1, periods.length - 1);
  const ke = valuation.ke;
  const kw = valuation.kw;
  const dirty_surplus = periods.slice(1).reduce((acc, p, idx) => {
    const prev = periods[idx]!;
    const ds = (p.bs.CSE - prev.bs.CSE) - p.is.CNI + p.cf.DividendPaid;
    return acc + ds / Math.pow(1 + ke, idx + 1);
  }, 0);
  const nfo_timing = periods.slice(1).reduce((acc, period, idx) => {
    const prev = periods[idx]!;
    const deltaNfo = (period.bs.NFO ?? 0) - (prev.bs.NFO ?? 0);
    return acc + deltaNfo / Math.pow(1 + ke, idx + 1);
  }, 0);
  const reT = periods[periods.length - 1]?.ri?.RE ?? 0;
  const reoiT = periods[periods.length - 1]?.ri?.ReOI ?? 0;
  const pvReTV = (ke > gEffective) ? (reT * (1 + gEffective) / (ke - gEffective)) / Math.pow(1 + ke, T) : 0;
  const pvReOITV = (kw > gEffective) ? (reoiT * (1 + gEffective) / (kw - gEffective)) / Math.pow(1 + kw, T) : 0;
  const tv_divergence = pvReTV - pvReOITV;
  const explicit_period_discounting = periods.slice(1).reduce((acc, p, idx) => {
    const t = idx + 1;
    return acc + (p.ri?.RE ?? 0) / Math.pow(1 + ke, t) - (p.ri?.ReOI ?? 0) / Math.pow(1 + kw, t);
  }, 0);
  const total = valuation.V_RE_CV3 - valuation.V_ReOI_CV03;
  const residual = total - dirty_surplus - nfo_timing - tv_divergence - explicit_period_discounting;
  const dominant_driver = Object.entries({ dirty_surplus, nfo_timing, tv_divergence, explicit_period_discounting })
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0] ?? "none";
  const out: ReReOIGapDecomposition = { dirty_surplus, nfo_timing, tv_divergence, explicit_period_discounting, residual, total, dominant_driver };
  registry?.register("re_reoi_gap", Math.abs(total), "S-15.2");
  registry?.register("re_reoi_gap_pct", valuation.V_RE_CV3 !== 0 ? Math.abs(total) / Math.abs(valuation.V_RE_CV3) : 0, "S-15.2");
  registry?.register("re_reoi_gap_decomposition", out, "S-15.2");
  return out;
}
