import type { BankPeriodMetrics } from "../bankPipeline/metrics";
import type { FinancialInstitutionSubtype } from "../analysisFamily";
import type { ValuationReadiness } from "../valuationPolicy";
import type { BankValuationBundle } from "./types";
import { describeFinancialValuationEvidence, summarizeFinancialValuationEvidence } from "./evidence";

/** The band within which two independent lenses must agree: the industrial triangulation's critical threshold. */
export const FI_LENS_AGREEMENT = 0.30;

/** Usable years of book and profit a financial-institution valuation needs. */
export const FI_MIN_USABLE_PERIODS = 3;

/**
 * Whether a financial institution's valuation is ready to be used, from the
 * evidence it actually rests on. One function, so the app's run and the audit
 * harness cannot disagree (the harness used to call every financial with
 * three periods "production-ready").
 *
 * - An insurer is ready when its embedded value and value of new business are
 *   filed: the actuarial valuation is the regulator-mandated primary, and its
 *   book models are only sanity brackets. Embedded value alone (VNB missing)
 *   is scaled by an assumed multiple and does not suffice.
 * - A bank or NBFC is ready when two independent lenses agree within
 *   FI_LENS_AGREEMENT. A bank's justified P/B, residual income and DDM are one
 *   algebra, so a bank with only those is not ready, however close they sit.
 *
 * Ready resolves "warning" (valuation-eligible), never "production-ready":
 * production-ready needs the release checks the industrial path runs, which
 * the financial-institution path does not yet.
 */
export function resolveFinancialValuationReadiness(input: {
  readonly bankMetrics: readonly BankPeriodMetrics[];
  readonly valuation: BankValuationBundle | null | undefined;
  readonly subtype: FinancialInstitutionSubtype;
}): ValuationReadiness {
  const { bankMetrics, valuation, subtype } = input;
  const latestIndex = bankMetrics.length - 1;
  const latestPeriod = bankMetrics.at(-1)?.period_end ?? null;
  const base = {
    latestPeriod,
    anchorPeriod: latestPeriod,
    anchorIndex: latestIndex,
    fallbackUsed: false,
    contaminationTier: "CLEAN" as const,
    persistenceStatus: "unknown" as const,
    persistenceScore: null,
    terminalFlags: [],
    terminalFlagLabels: [],
  };
  const guarded = (reason: string): ValuationReadiness => ({ ...base, status: "guarded", reasons: [reason] });

  const usable = bankMetrics.filter((m) => m.totalEquity != null && m.totalEquity > 0 && m.pat != null && Number.isFinite(m.pat));
  if (usable.length < FI_MIN_USABLE_PERIODS) {
    return guarded(`Financial-institution valuation needs ${FI_MIN_USABLE_PERIODS} years with positive book and filed profit; ${usable.length} available.`);
  }

  const evidence = summarizeFinancialValuationEvidence(valuation, subtype);
  const stated = describeFinancialValuationEvidence(evidence);

  if (subtype === "insurance") {
    const ev = valuation?.evBased;
    const vnb = ev?.status === "computed" ? ev.diagnostics.vnb : null;
    if (ev?.status === "computed" && vnb != null && vnb > 0) {
      return { ...base, status: "warning", reasons: [`Valuation-eligible on the filed embedded value and value of new business. ${stated}`] };
    }
    return guarded(ev?.status === "computed"
      ? `Embedded value is filed without value of new business, so it is scaled by an assumed multiple; valuation-eligible needs both. ${stated}`
      : `An insurer is valued on its filed embedded value and value of new business, and neither is available. ${stated}`);
  }

  const { groups, maxGapRatio } = evidence;
  if (groups.length >= 2 && maxGapRatio != null && maxGapRatio <= FI_LENS_AGREEMENT) {
    return { ...base, status: "warning", reasons: [`Valuation-eligible: two independent lenses agree within ${FI_LENS_AGREEMENT * 100}%. ${stated}`] };
  }
  return guarded(groups.length >= 2
    ? `${stated} Valuation-eligible needs them within ${FI_LENS_AGREEMENT * 100}%.`
    : `${stated} Valuation-eligible needs two independent lenses that agree within ${FI_LENS_AGREEMENT * 100}%.`);
}
