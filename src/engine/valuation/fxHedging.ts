/* ================================================================
   Plan 5b PR-5b.5 — FX hedging analysis (Schema v15 → v16).

   For export-heavy companies (IT services, pharma generics, gem &
   jewellery), reported revenue conflates two effects:
     1. Underlying business growth (volume + price)
     2. FX translation movement (USD/INR, EUR/INR, etc.)

   When INR strengthens, reported revenue rises in dollar terms
   even when local-currency volume is flat. The defensible analysis
   strips out the FX move and reports an "FX-neutral" growth rate.

   This module exposes:
     fxNeutralRevenue(periods, currency)  reports both
                                          reportedGrowth and
                                          fxNeutralGrowth
     hedgingEffectiveness({ notional,
                            spotMove,
                            fairValueChange })
                                          ratio of FV move to
                                          unhedged exposure

   Schema bump v15 -> v16 reflects the addition of these new
   fields to the analysis envelope (FX neutrality is consumed by
   the rigor ladder when company.subtype === 'export-heavy').

   PR-5b.5 ships the helpers + tests + schema bump. Wiring into
   the rigor ladder so >100bp difference between reported and
   FX-neutral growth flags the run is a follow-up.
================================================================ */

export interface FxRevenuePeriod {
  periodEnd: string;
  /** Reported revenue in INR crore. */
  reportedRevenueCr: number;
  /** Average period-end exchange rate (INR per unit foreign currency, e.g. 83 for USD). */
  averageRateInrPerForeign: number;
  /** Period-end exchange rate (for translation reconciliation). */
  closingRateInrPerForeign: number;
  /** Foreign-currency revenue mix (decimal). 0.65 = 65% of revenue in foreign currency. */
  foreignCurrencyMix: number;
}

export interface FxNeutralRevenueResult {
  perPeriod: ReadonlyArray<{
    periodEnd: string;
    reportedRevenueCr: number;
    /** Reported revenue retranslated at the BASE period's average rate. */
    fxNeutralRevenueCr: number;
    fxImpactCr: number;
    fxImpactPct: number;
  }>;
  /** Reported YoY growth (decimal). */
  reportedGrowth: number;
  /** FX-neutral YoY growth (decimal). */
  fxNeutralGrowth: number;
  /** Difference in basis points. Positive = FX inflated reported growth. */
  fxImpactBps: number;
}

/**
 * Strip FX translation from reported revenue. Period 0 is the
 * BASE — its rate is held fixed and applied to all later periods'
 * foreign-currency components. Reported INR-only component (the
 * complement of foreignCurrencyMix) is unchanged.
 */
export function fxNeutralRevenue(periods: ReadonlyArray<FxRevenuePeriod>): FxNeutralRevenueResult {
  if (periods.length < 2) {
    throw new Error("fxNeutralRevenue: at least 2 periods required");
  }
  const base = periods[0]!;
  const baseRate = base.averageRateInrPerForeign;

  const perPeriod = periods.map((p) => {
    const foreignComponentInrCr = p.reportedRevenueCr * p.foreignCurrencyMix;
    const inrOnlyComponent = p.reportedRevenueCr * (1 - p.foreignCurrencyMix);
    // Convert foreign component back to FX-neutral by re-translating at the
    // base period's rate.
    const foreignInBaseUnits = foreignComponentInrCr / p.averageRateInrPerForeign;
    const foreignAtBaseRate = foreignInBaseUnits * baseRate;
    const fxNeutral = inrOnlyComponent + foreignAtBaseRate;
    const fxImpact = p.reportedRevenueCr - fxNeutral;
    const fxImpactPct = fxNeutral !== 0 ? fxImpact / fxNeutral : 0;
    return {
      periodEnd: p.periodEnd,
      reportedRevenueCr: p.reportedRevenueCr,
      fxNeutralRevenueCr: fxNeutral,
      fxImpactCr: fxImpact,
      fxImpactPct,
    };
  });

  const last = perPeriod[perPeriod.length - 1]!;
  const reportedGrowth =
    base.reportedRevenueCr > 0
      ? last.reportedRevenueCr / base.reportedRevenueCr - 1
      : 0;
  const fxNeutralGrowth =
    base.reportedRevenueCr > 0
      ? last.fxNeutralRevenueCr / base.reportedRevenueCr - 1
      : 0;
  const fxImpactBps = (reportedGrowth - fxNeutralGrowth) * 10_000;

  return {
    perPeriod,
    reportedGrowth,
    fxNeutralGrowth,
    fxImpactBps,
  };
}

export interface HedgingEffectivenessInputs {
  /** Notional unhedged exposure (₹ crore equivalent). */
  notionalExposureCr: number;
  /** Spot rate move during the period (decimal). 0.05 = INR weakened 5%. */
  spotMove: number;
  /** Fair value change of derivatives portfolio (₹ crore). */
  derivativeFvChangeCr: number;
  /** Material threshold for "effective" hedging (default 0.80 = 80%). */
  effectiveThreshold?: number;
  /** Material threshold for "ineffective" hedging (default 0.40 = 40%). */
  ineffectiveThreshold?: number;
}

export type HedgeVerdict = "effective" | "partial" | "ineffective" | "speculative";

export interface HedgingEffectivenessResult {
  /** Implied unhedged P&L impact (notional * spotMove). */
  unhedgedImpactCr: number;
  /** Hedge ratio = derivativeFvChange / unhedgedImpact. Negative when offsetting. */
  hedgeRatio: number;
  verdict: HedgeVerdict;
  diagnostics: string[];
}

const DEFAULT_EFFECTIVE = 0.80;
const DEFAULT_INEFFECTIVE = 0.40;

export function hedgingEffectiveness(
  inputs: HedgingEffectivenessInputs,
): HedgingEffectivenessResult {
  const effectiveThreshold = inputs.effectiveThreshold ?? DEFAULT_EFFECTIVE;
  const ineffectiveThreshold = inputs.ineffectiveThreshold ?? DEFAULT_INEFFECTIVE;
  const unhedgedImpact = inputs.notionalExposureCr * inputs.spotMove;

  // Hedge offsets exposure when sign(derivativeFvChange) == -sign(unhedgedImpact).
  // Ratio is the absolute offset: |dFV| / |unhedged|, capped at 1.0 for "effective".
  const offsetMagnitude =
    unhedgedImpact !== 0 ? Math.abs(inputs.derivativeFvChangeCr) / Math.abs(unhedgedImpact) : 0;
  const isOffsetting =
    Math.sign(inputs.derivativeFvChangeCr) !== Math.sign(unhedgedImpact) &&
    inputs.derivativeFvChangeCr !== 0 &&
    unhedgedImpact !== 0;
  const hedgeRatio = isOffsetting ? -offsetMagnitude : offsetMagnitude;

  const diagnostics: string[] = [];
  let verdict: HedgeVerdict;

  if (!isOffsetting && Math.abs(inputs.derivativeFvChangeCr) > 0.05 * Math.abs(unhedgedImpact)) {
    verdict = "speculative";
    diagnostics.push(
      "Derivative position moves WITH spot exposure — directional bet, not hedge.",
    );
  } else if (offsetMagnitude >= effectiveThreshold) {
    verdict = "effective";
  } else if (offsetMagnitude >= ineffectiveThreshold) {
    verdict = "partial";
    diagnostics.push(
      `Hedge offsets ${(offsetMagnitude * 100).toFixed(0)}% of exposure — partial coverage.`,
    );
  } else {
    verdict = "ineffective";
    diagnostics.push(
      `Hedge offsets only ${(offsetMagnitude * 100).toFixed(0)}% of exposure — substantial residual P&L risk.`,
    );
  }

  return {
    unhedgedImpactCr: unhedgedImpact,
    hedgeRatio,
    verdict,
    diagnostics,
  };
}
