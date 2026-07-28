import type { FinancialInstitutionAnalysisResult } from "../../../engine/analysisFamily";

/**
 * Stable identity for an absent `bankResult.bankMetrics`.
 *
 * All five financial views open with `bankResult.bankMetrics ?? []` and key a
 * `useMemo` on the result. `?? []` allocates a fresh array every render, so for
 * a bank whose metrics never arrived — a parse that produced no period metrics,
 * an insurance subtype before its sidecar lands — the dependency was a new
 * reference each render and the memo recomputed every time. Sharing one module
 * constant makes the nullish branch as stable as the present one.
 *
 * Read-only by convention, not by type: `bankMetrics` is a mutable
 * `BankPeriodMetrics[]`, and `CapitalCushion` forwards `metrics` to a child
 * expecting that exact type — so declaring this `readonly` would not compile,
 * and `Object.freeze` returns `readonly never[]`, which needs a double cast to
 * get back. Every consumer only maps over it. Do not mutate it.
 */
export const NO_BANK_METRICS: NonNullable<FinancialInstitutionAnalysisResult["bankMetrics"]> = [];
