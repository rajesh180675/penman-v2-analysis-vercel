import type { BankPeriodMetrics } from "../bankPipeline";
import { EngineConfig } from "../types";
import { resolveCostOfCapitalFromConfig } from "../costOfCapital";
import { trace } from "../../lib/traceLogger";
import type {
  BankValuationModelResult,
  CreditCostCycleCheck,
  SpreadCompressionCheck,
  CrarGovernorResult,
  EclStressGovernorResult,
  BankValuationBundle,
} from "./types";
import { DEFAULT_TERMINAL_GROWTH, median, skipped } from "./shared";
import {
  computeSustainableROE,
  justifiedPBGordon,
  equityResidualIncome,
  sustainableDDM,
  evBasedValuation,
} from "./coreModels";
import {
  pAumLens,
  roaLeverageRI,
  crarGovernor,
  creditCostCycle,
  spreadCompressionCheck,
  eclStressGovernor,
} from "./nbfcLenses";
import { buildBankScenarioBundle } from "./scenarios";

// ─── Public entry ───────────────────────────────────────────────────────────

/**
 * Compute the bank valuation bundle. Returns a structured result with
 * three core models, each independently computed or skipped with a reason.
 *
 * Caller passes the BankPeriodMetrics array from bankPipeline.ts plus
 * the standard EngineConfig. marketCap is optional — when provided each
 * model's premium-over-market is computed; otherwise null.
 *
 * Per S-9.4C: ke comes from the shared CostOfCapitalResult.
 * Terminal growth uses cfg.terminal_growth_rate when present else
 * DEFAULT_TERMINAL_GROWTH.
 *
 * Phase D2 — when subtype is "nbfc", four additional NBFC-specific lenses
 * fire (P/AUM, ROA × Leverage RI, CRAR governor, credit-cost cycle check).
 * The CRAR governor adjusts effective `g` for the three core models too,
 * so an NBFC near the regulatory floor can't claim a 5% growth assumption.
 */

export function computeBankValuation(
  metrics: BankPeriodMetrics[],
  cfg: EngineConfig,
  marketCap: number | null = null,
  payoutRatio: number | null = null,
  isInsurance: boolean = false,
  isNbfc: boolean = false,
): BankValuationBundle {
  if (metrics.length === 0) {
    const skip = skipped("no bank metrics provided");
    return {
      sustainableROE: null,
      ke: resolveCostOfCapitalFromConfig({ config: cfg }).ke,
      terminalGrowth: DEFAULT_TERMINAL_GROWTH,
      latestBookValue: null,
      usableHistory: 0,
      payoutRatio,
      justifiedPB: skip,
      equityResidualIncome: skip,
      sustainableDDM: skip,
      // evBased / pAum / roaLeverageRI intentionally omitted — no metrics.
      triangulatedValue: null,
      modelsContributing: [],
    };
  }

  const ke = resolveCostOfCapitalFromConfig({ config: cfg }).ke;
  const originalG = cfg.terminal_growth_rate ?? DEFAULT_TERMINAL_GROWTH;

  // Phase D2 — apply CRAR-buffer governor for NBFCs so all downstream
  // models see the throttled g. Banks/insurance unaffected (no governor).
  let g = originalG;
  let crarGovernorResult: CrarGovernorResult | undefined;
  if (isNbfc) {
    const gov = crarGovernor(metrics, originalG);
    g = gov.effectiveG;
    crarGovernorResult = gov.result;
  }

  const latest = metrics[metrics.length - 1]!;
  const latestBV = latest.totalEquity;

  const { value: sustainableROE, obsCount } = computeSustainableROE(metrics);

  let justifiedPB = justifiedPBGordon(latestBV, sustainableROE, ke, g, marketCap, isInsurance);
  const eri = equityResidualIncome(metrics, ke, g, marketCap, payoutRatio);
  const ddm = sustainableDDM(latestBV, latest.pat, sustainableROE, ke, g, payoutRatio, marketCap);
  const evBased = evBasedValuation(metrics, marketCap, cfg);

  // Phase D3 — ECL Stress Governor: fade justified P/B when uncovered Stage 3
  // + restructured exceeds healthy thresholds. Only for NBFCs with IndAS 109 data.
  let eclStressResult: EclStressGovernorResult | undefined;
  if (isNbfc && justifiedPB.status === "computed" && justifiedPB.intrinsicValue != null && latestBV != null && latestBV > 0) {
    const originalFairPB = justifiedPB.intrinsicValue / latestBV;
    const gov = eclStressGovernor(metrics, originalFairPB);
    eclStressResult = gov.result;

    // If the governor faded the P/B, rebuild the justifiedPB result with the new value
    if (gov.result.status === "computed" && gov.result.fadeFactor < 1.0) {
      const fadedValue = gov.effectivePB * latestBV;
      const fadedPremium = marketCap != null && marketCap > 0
        ? fadedValue / marketCap - 1
        : null;
      justifiedPB = {
        status: "computed",
        intrinsicValue: fadedValue,
        premiumOverMarket: fadedPremium,
        reason: justifiedPB.reason +
          ` → ECL stress fade ${gov.result.fadeFactor.toFixed(3)}× (uncovered ${gov.result.uncoveredStressPct!.toFixed(2)}%) → effective P/B ${gov.effectivePB.toFixed(2)}`,
        diagnostics: {
          ...justifiedPB.diagnostics,
          eclFadeFactor: gov.result.fadeFactor,
          eclUncoveredStressPct: gov.result.uncoveredStressPct,
          eclOriginalPB: originalFairPB,
          eclEffectivePB: gov.effectivePB,
        },
      };
    }
  }

  // Phase D2 — NBFC-only lenses.
  let pAum: BankValuationModelResult | undefined;
  let roaLevRI: BankValuationModelResult | undefined;
  let creditCostCycleResult: CreditCostCycleCheck | undefined;
  let spreadCompressionResult: SpreadCompressionCheck | undefined;
  if (isNbfc) {
    pAum = pAumLens(metrics, marketCap);
    roaLevRI = roaLeverageRI(metrics, ke, g, marketCap, payoutRatio);
    creditCostCycleResult = creditCostCycle(metrics);
    spreadCompressionResult = spreadCompressionCheck(metrics);
  }

  const computedValues: Array<[string, number]> = [];
  if (justifiedPB.status === "computed" && justifiedPB.intrinsicValue != null) {
    computedValues.push(["Justified P/B Gordon", justifiedPB.intrinsicValue]);
  }
  if (eri.status === "computed" && eri.intrinsicValue != null) {
    computedValues.push(["Equity Residual Income", eri.intrinsicValue]);
  }
  if (ddm.status === "computed" && ddm.intrinsicValue != null) {
    computedValues.push(["Sustainable DDM", ddm.intrinsicValue]);
  }
  if (evBased.status === "computed" && evBased.intrinsicValue != null) {
    computedValues.push(["EV Based Valuation", evBased.intrinsicValue]);
  }
  // NBFC lenses also contribute to triangulation (median of all computed).
  if (pAum && pAum.status === "computed" && pAum.intrinsicValue != null) {
    computedValues.push(["P/AUM (NBFC)", pAum.intrinsicValue]);
  }
  if (roaLevRI && roaLevRI.status === "computed" && roaLevRI.intrinsicValue != null) {
    computedValues.push(["ROA × Leverage RI (NBFC)", roaLevRI.intrinsicValue]);
  }

  // For insurance: EV-based is the IRDAI-mandated actuarial primary. When it is
  // computed we use it directly as the triangulated value; the other three models
  // (Gordon, RI, DDM) are displayed as sanity range brackets rather than being
  // averaged with EV (which would dramatically dilute the actuarial estimate).
  // When EV is NOT computed we FAIL CLOSED (triangulatedValue = null): the
  // bank-framed book-value models are inappropriate for an insurer and must not
  // silently substitute for a missing embedded value. The caller can read
  // evBased.reason ("Embedded Value sidecar data unavailable …") to surface why.
  // For banks/NBFCs the original median-of-all-computed-models is preserved.
  let triangulatedValue: number | null = null;
  if (isInsurance) {
    triangulatedValue = evBased.status === "computed" && evBased.intrinsicValue != null
      ? evBased.intrinsicValue
      : null;
  } else {
    triangulatedValue = computedValues.length > 0
      ? median(computedValues.map(([, v]) => v))
      : null;
  }

  // Phase E — Build three-scenario bundle
  const scenarioBundle = buildBankScenarioBundle({
    sustainableROE, ke, terminalGrowth: g,
    latestBookValue: latestBV, marketCap,
    isNbfc,
  });

  trace("valuation", "computeBankValuation:result", {
    sustainableROE,
    ke,
    g,
    latestBV,
    justifiedPBStatus: justifiedPB?.status ?? null,
    eriStatus: eri?.status ?? null,
    ddmStatus: ddm?.status ?? null,
    triangulated: triangulatedValue,
    eclFadeFactor: eclStressResult?.fadeFactor ?? null,
    triangulatedValue: triangulatedValue ?? null,
  });

  return {
    sustainableROE,
    ke,
    terminalGrowth: g,
    latestBookValue: latestBV,
    usableHistory: obsCount,
    payoutRatio,
    justifiedPB,
    equityResidualIncome: eri,
    sustainableDDM: ddm,
    evBased,
    pAum,
    roaLeverageRI: roaLevRI,
    creditCostCycle: creditCostCycleResult,
    crarGovernor: crarGovernorResult,
    eclStressGovernor: eclStressResult,
    spreadCompression: spreadCompressionResult,
    scenarios: scenarioBundle,
    triangulatedValue,
    modelsContributing: computedValues.map(([name]) => name),
  };
}
