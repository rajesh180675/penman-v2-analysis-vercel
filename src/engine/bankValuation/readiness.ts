import type { BankPeriodMetrics } from "../bankPipeline/metrics";
import type { FinancialInstitutionSubtype } from "../analysisFamily";
import type { ValuationReadiness } from "../valuationPolicy";
import type { BankValuationBundle } from "./types";
import { describeFinancialValuationEvidence, summarizeFinancialValuationEvidence } from "./evidence";

/** The band within which two independent lenses must agree: the industrial triangulation's critical threshold. */
export const FI_LENS_AGREEMENT = 0.30;

/** Agreement for production-ready: the industrial triangulation's warning threshold. */
export const FI_LENS_PRODUCTION_AGREEMENT = 0.15;

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
 * Ready resolves "warning" (valuation-eligible). It resolves "production-ready"
 * only for a bank or NBFC
 * whose two lenses agree within FI_LENS_PRODUCTION_AGREEMENT — the industrial
 * triangulation's warning band. The rest of production-ready is the envelope's
 * as for any run: a cost of equity on undated priors withdraws it there.
 *
 * An insurer stops at valuation-eligible: its value of new business is scaled
 * by a multiple (12× by default) that nothing in the engine sources or dates —
 * a config value is not provenance, as a typed ke is not — and on HDFC Life
 * that multiple carries nearly half the headline value.
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
      const multiple = ev.diagnostics.vnb_multiple ?? null;
      if (ev.diagnostics.vnb_multiple_derived === 1 && multiple != null) {
        // Derived from the run's ke and terminal growth: no assumption of its
        // own. The envelope's ke-provenance gate still demotes an undated ke.
        return { ...base, status: "production-ready", reasons: [`Ready: the filed embedded value plus the value of new business, growing at g and discounted at ke (× ${multiple.toFixed(1)}). ${stated}`] };
      }
      return { ...base, status: "warning", reasons: [`Valuation-eligible on the filed embedded value and value of new business. The VNB multiple (${multiple ?? "?"}×) is configured for the company, an assumption nothing in the engine sources, so production-ready waits for the derived one. ${stated}`] };
    }
    return guarded(ev?.status === "computed"
      ? `Embedded value is filed without value of new business, so it is scaled by an assumed multiple; valuation-eligible needs both. ${stated}`
      : `An insurer is valued on its filed embedded value and value of new business, and neither is available. ${stated}`);
  }

  const { groups, maxGapRatio } = evidence;
  if (groups.length >= 2 && maxGapRatio != null && maxGapRatio <= FI_LENS_PRODUCTION_AGREEMENT) {
    return { ...base, status: "production-ready", reasons: [`Ready: two independent lenses agree within ${FI_LENS_PRODUCTION_AGREEMENT * 100}%. ${stated}`] };
  }
  if (groups.length >= 2 && maxGapRatio != null && maxGapRatio <= FI_LENS_AGREEMENT) {
    return { ...base, status: "warning", reasons: [`Valuation-eligible: two independent lenses agree within ${FI_LENS_AGREEMENT * 100}%, not the ${FI_LENS_PRODUCTION_AGREEMENT * 100}% production-ready needs. ${stated}`] };
  }
  return guarded(groups.length >= 2
    ? `${stated} Valuation-eligible needs them within ${FI_LENS_AGREEMENT * 100}%.`
    : `${stated} Valuation-eligible needs two independent lenses that agree within ${FI_LENS_AGREEMENT * 100}%.`);
}
