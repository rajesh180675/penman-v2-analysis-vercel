/** Phase 4.2: India-Specific Regime Overlays
 *
 * Captures major regulatory and tax regime changes that affect
 * financial analysis of Indian companies. These events create
 * structural breaks in time-series data that must be acknowledged
 * during trend analysis and terminal value estimation.
 */

// ── Corporate Tax Rate Cut 2019 ──
export const CORPORATE_TAX_CUT_2019 = {
  announcementDate: "2019-09-20",
  effectiveFrom: "FY2020 (companies opting for new regime)",
  oldStatutoryRate: 0.30,      // 30% base rate
  newStatutoryRate: 0.22,      // 22% base rate (25.17% incl. surcharge + cess)
  description: "Corporate tax rate reduced from 30% to 22% for domestic companies not claiming exemptions.",
} as const;

// ── GST Implementation 2017 ──
export const GST_IMPLEMENTATION_2017 = {
  effectiveDate: "2017-07-01",
  workingCapitalImpact: "positive" as const, // Eliminated cascading tax input credits
  description: "GST replaced complex multi-layer indirect tax structure. Input tax credit mechanism generally improves working capital for compliant firms.",
} as const;

// ── Ind AS 116 (Leases) Transition ──
export const IND_AS_116_TRANSITION = {
  effectiveDate: "2019-04-01",
  impactSummary: {
    roaImpact: "negative",  // Asset denominator increases with ROU assets
    leverageImpact: "negative", // Debt increases with lease liabilities
    ebitdaImpact: "positive",    // Op lease rent moved from EBITDA to D&A + interest
  },
  description: "Ind AS 116 requires recognition of ROU assets and lease liabilities, affecting balance-sheet ratios.",
} as const;

// ── Demonetization 2016 ──
export const DEMONETIZATION_2016 = {
  announcementDate: "2016-11-08",
  revenueImpact: "negative_short_term",
  description: "Short-term revenue disruption for cash-dependent businesses, mostly normalized within 1-2 years.",
} as const;

// ── Sector-specific: Cigarette Excise Duty ──
/** Historical cigarette excise duty rate changes (ad valorem + specific). */
export const CIGARETTE_EXCISE_DUTY_CHANGES: Array<{
  effectiveDate: string;
  rateChange: string;
  expectedMarginImpact: "negative" | "neutral" | "positive";
}> = [
  { effectiveDate: "2023-02-01", rateChange: "Specific duty increased by ~3-5%", expectedMarginImpact: "negative" },
  { effectiveDate: "2022-02-01", rateChange: "Ad valorem + specific combined increase", expectedMarginImpact: "negative" },
  { effectiveDate: "2021-02-01", rateChange: "Specific duty increased", expectedMarginImpact: "negative" },
  { effectiveDate: "2020-02-01", rateChange: "Ad valorem rate increased", expectedMarginImpact: "negative" },
];

// ── Composite overlay engine ──

export interface RegimeEvent {
  eventName: string;
  effectiveDate: string;
  impactSummary: string;
  affectsTaxes: boolean;
  affectsWorkingCapital: boolean;
  affectsOperatingMargin: boolean;
  affectsBalanceSheet: boolean;
}

export interface RegimeOverlayResult {
  applicableEvents: RegimeEvent[];
  preAndPostTaxSplitPeriod: string | null; // Period before/after tax cut
  taxRateWarning: string | null;
  workingCapitalNarrative: string | null;
  marginDistortions: string[];
}

/**
 * Analyze a company's financial history for India-specific regime effects.
 *
 * @param periodEnds - Array of period end dates (YYYY-MM-DD format)
 * @param sector - Company sector (e.g., "tobacco", "consumer-staples")
 * @param effectiveTaxRates - Map of period_end → effective tax rate
 */
export function analyzeRegimeOverlays(
  periodEnds: string[],
  sector: string | null,
  effectiveTaxRates: Map<string, number>,
): RegimeOverlayResult {
  const applicableEvents: RegimeEvent[] = [];
  const marginDistortions: string[] = [];
  let preAndPostTaxSplitPeriod: string | null = null;
  let taxRateWarning: string | null = null;
  let workingCapitalNarrative: string | null = null;

  // ── Corporate Tax Rate Cut 2019 ──
  const hasPre2019 = periodEnds.some((d) => d <= "2019-09-20");
  const hasPost2019 = periodEnds.some((d) => d > "2019-09-20");
  if (hasPre2019 && hasPost2019) {
    applicableEvents.push({
      eventName: "Corporate Tax Cut 2019",
      effectiveDate: CORPORATE_TAX_CUT_2019.effectiveFrom,
      impactSummary: "Effective tax rate may differ materially before vs after FY2020.",
      affectsTaxes: true,
      affectsWorkingCapital: false,
      affectsOperatingMargin: false,
      affectsBalanceSheet: false,
    });
    preAndPostTaxSplitPeriod = "2019-09-20";

    // Check if the company's effective tax rate actually changed
    if (effectiveTaxRates.size > 0) {
      const preRates: number[] = [];
      const postRates: number[] = [];
      for (const [period, rate] of effectiveTaxRates) {
        if (period <= "2019-09-20") preRates.push(rate);
        else postRates.push(rate);
      }
      const avgPre = preRates.length > 0 ? preRates.reduce((s, v) => s + v, 0) / preRates.length : null;
      const avgPost = postRates.length > 0 ? postRates.reduce((s, v) => s + v, 0) / postRates.length : null;
      if (avgPre != null && avgPost != null) {
        const diff = avgPre - avgPost;
        if (diff > 0.03) {
          taxRateWarning = `Effective tax rate fell by ${(diff * 100).toFixed(1)}pp around 2019 tax cut period (from ${(avgPre * 100).toFixed(1)}% to ${(avgPost * 100).toFixed(1)}%). Pre/post tax rates are not comparable.`;
        }
      }
    }
  }

  // ── GST 2017 ──
  const hasPreGST = periodEnds.some((d) => d <= "2017-07-01");
  const hasPostGST = periodEnds.some((d) => d > "2017-07-01");
  if (hasPreGST && hasPostGST) {
    applicableEvents.push({
      eventName: "GST Implementation",
      effectiveDate: GST_IMPLEMENTATION_2017.effectiveDate,
      impactSummary: "Working capital structure changed due to input tax credit mechanism.",
      affectsTaxes: false,
      affectsWorkingCapital: true,
      affectsOperatingMargin: false,
      affectsBalanceSheet: false,
    });
    workingCapitalNarrative = `GST implementation may have improved working capital efficiency through input tax credits. Pre-GST payables/receivables structure is not directly comparable.`;
  }

  // ── Ind AS 116 ──
  const hasPre116 = periodEnds.some((date) => date <= "2019-04-01");
  const hasPost116 = periodEnds.some((date) => date > "2019-04-01");
  if (hasPre116 && hasPost116) {
    applicableEvents.push({
      eventName: "Ind AS 116 (Leases) Adoption",
      effectiveDate: IND_AS_116_TRANSITION.effectiveDate,
      impactSummary: "ROU assets and lease liabilities capitalized. EBITDA may be artificially elevated post-adoption.",
      affectsTaxes: false,
      affectsWorkingCapital: false,
      affectsOperatingMargin: true,
      affectsBalanceSheet: true,
    });
    marginDistortions.push(`Ind AS 116 adoption: Operating lease rent expense moved from operating cost to D&A + interest, potentially inflating post-2019 EBITDA. Adjust for comparability.`);
  }

  // ── Sector-specific: Cigarette Excise Duty ──
  if (sector === "tobacco" || sector === "cigarettes") {
    for (const duty of CIGARETTE_EXCISE_DUTY_CHANGES) {
      if (periodEnds.some((d) => d >= duty.effectiveDate)) {
        applicableEvents.push({
          eventName: `Cigarette Excise Duty Increase (${duty.effectiveDate})`,
          effectiveDate: duty.effectiveDate,
          impactSummary: `Excise duty increase expected to pressure margins by ${duty.rateChange}.`,
          affectsTaxes: false,
          affectsWorkingCapital: false,
          affectsOperatingMargin: true,
          affectsBalanceSheet: false,
        });
        marginDistortions.push(`${duty.effectiveDate}: Cigarette excise duty increase (${duty.rateChange}). Monitor for margin compression that may not reflect operational deterioration.`);
      }
    }
  }

  // ── Demonetization 2016 ──
  const hasPostDemonetization = periodEnds.some((d) => d >= "2016-11-08");
  if (hasPostDemonetization && periodEnds.some((d) => d < "2016-11-08")) {
    applicableEvents.push({
      eventName: "Demonetization 2016",
      effectiveDate: DEMONETIZATION_2016.announcementDate,
      impactSummary: "Short-term revenue disruption, especially for cash-dependent businesses.",
      affectsTaxes: false,
      affectsWorkingCapital: false,
      affectsOperatingMargin: false,
      affectsBalanceSheet: false,
    });
  }

  return {
    applicableEvents,
    preAndPostTaxSplitPeriod,
    taxRateWarning,
    workingCapitalNarrative,
    marginDistortions,
  };
}
