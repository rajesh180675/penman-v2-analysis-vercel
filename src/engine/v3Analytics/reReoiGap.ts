/* ══════════════════════════════════════════════════════════════════
   S-15.2 — RE / ReOI identity-gap decomposition
   Imports DOWN from ../types and ./shared only — no back-edge to
   v3Analytics.ts.
══════════════════════════════════════════════════════════════════ */
import { RecastPeriod } from "../types";
import { CanonicalOutputRegistry } from "./shared";

export interface ReReOIGapDecomposition {
  /** B_0 − (NOA_0 − NFO_0 − MI_0) at the valuation anchor. ~0 when the recast closes. */
  anchor_book_identity: number;
  /** Σ RE_t/(1+ke)^t − Σ ReOI_t/(1+kw)^t over the explicit forecast. */
  explicit_period_discounting: number;
  /** CV_RE/(1+ke)^T − CV_ReOI/(1+kw)^T. */
  tv_divergence: number;
  /** Whatever the three terms above do not explain (0 when both values come from one anchored run). */
  residual: number;
  total: number;
  dominant_driver: string;
}

/** The pieces of ONE latest-anchored computeValuation run. */
export interface GapValuationParts {
  pvRE: number;
  pvReOI: number;
  CV_RE: number | null;
  CV_ReOI: number | null;
  /** Number of explicit forecast years (T). */
  horizon: number;
}

/**
 * Both valuations are dated at the latest balance sheet, so their gap is
 * exactly three terms:
 *
 *   V_RE − V_ReOI = [B − (NOA − NFO − MI)]_anchor
 *                 + [Σ RE_t/ρE^t − Σ ReOI_t/ρW^t]
 *                 + [CV_RE/ρE^T − CV_ReOI/ρW^T]
 *
 * This used to be decomposed with HISTORICAL components (realized dirty
 * surplus, realized ΔNFO, realized RE discounted to the oldest book) — terms
 * of a valuation dated at the first historical year, which no longer exists.
 * Without the run's parts only the anchor identity can be measured and the
 * rest is reported as residual rather than guessed.
 */
export function decomposeReReOIGap(
  anchor: RecastPeriod,
  valuation: { V_RE_CV3: number; V_ReOI_CV03: number; ke: number; kw: number },
  parts: GapValuationParts | null | undefined,
  registry?: CanonicalOutputRegistry | undefined,
): ReReOIGapDecomposition {
  const bs = anchor.bs;
  const anchor_book_identity = bs.CSE - (bs.NOA - bs.NFO - (Number.isFinite(bs.MI) ? bs.MI : 0));
  let explicit_period_discounting = 0;
  let tv_divergence = 0;
  if (parts) {
    explicit_period_discounting = parts.pvRE - parts.pvReOI;
    const T = Math.max(0, parts.horizon);
    const tvRE = parts.CV_RE != null ? parts.CV_RE / Math.pow(1 + valuation.ke, T) : 0;
    const tvReOI = parts.CV_ReOI != null ? parts.CV_ReOI / Math.pow(1 + valuation.kw, T) : 0;
    tv_divergence = tvRE - tvReOI;
  }
  const total = valuation.V_RE_CV3 - valuation.V_ReOI_CV03;
  const residual = total - anchor_book_identity - explicit_period_discounting - tv_divergence;
  const dominant_driver = Object.entries({ anchor_book_identity, explicit_period_discounting, tv_divergence, residual })
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0] ?? "none";
  const out: ReReOIGapDecomposition = { anchor_book_identity, explicit_period_discounting, tv_divergence, residual, total, dominant_driver };
  registry?.register("re_reoi_gap", Math.abs(total), "S-15.2");
  registry?.register("re_reoi_gap_pct", valuation.V_RE_CV3 !== 0 ? Math.abs(total) / Math.abs(valuation.V_RE_CV3) : 0, "S-15.2");
  registry?.register("re_reoi_gap_decomposition", out, "S-15.2");
  return out;
}
