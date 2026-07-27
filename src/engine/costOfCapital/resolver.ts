import { SECTOR_EQUITY_WEIGHTS } from "../types/config";
import type { EngineConfig, RecastPeriod } from "../types";
import {
  resolveCapitalCostAssumptions,
  type PeerLeveredBeta,
} from "../assumptions/capitalCostAssumptions";
import type { EquityBetaPack, MacroPack } from "../marketPacks";
import {
  COST_OF_CAPITAL_POLICY_VERSION,
  type CapitalStructureWeights,
  type CostEvidence,
  type CostOfCapitalGuard,
  type CostOfCapitalResult,
  type CostOfDebtPolicy,
  type CostOfEquityPolicy,
  type ResolveCostOfCapitalInput,
} from "./types";

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function resolveEquity(policy: CostOfEquityPolicy): {
  ke: number;
  beta: number | null;
  erp: number | null;
  riskFree: number;
  evidence: CostEvidence[];
  warnings: string[];
} {
  if (policy.mode === "manual") {
    return {
      ke: policy.ke,
      beta: null,
      erp: null,
      riskFree: 0,
      evidence: [{
        component: "risk-free",
        source: `Manual cost of equity: ${policy.rationale || "rationale unavailable"}`,
        asOf: null,
        value: policy.ke,
        evidenceRefs: policy.evidenceRefs,
      }],
      warnings: [
        ...(policy.rationale.trim() ? [] : ["Manual cost of equity has no reviewer rationale."]),
        ...(policy.evidenceRefs.length ? [] : ["Manual cost of equity has no evidence reference."]),
      ],
    };
  }
  // When tiers are present, each row carries its own observation date. Stamping
  // the market snapshot date onto a sector beta prior would date a number that
  // has no date, which is the exact confusion the tiers exist to remove.
  const tiers = policy.assumptions;
  const priorKeys = tiers?.priorTierKeys ?? [];
  return {
    ke: policy.riskFreeRate + policy.beta * policy.equityRiskPremium,
    beta: policy.beta,
    erp: policy.equityRiskPremium,
    riskFree: policy.riskFreeRate,
    evidence: [
      {
        component: "risk-free",
        source: policy.riskFreeSource,
        asOf: tiers ? tiers.riskFreeRate.asOf : policy.asOf,
        value: policy.riskFreeRate,
        evidenceRefs: policy.evidenceRefs,
        tier: tiers?.riskFreeRate.tier,
        fallbackReason: tiers?.riskFreeRate.fallbackReason,
      },
      {
        component: "beta",
        source: policy.betaSource,
        asOf: tiers ? tiers.beta.asOf : policy.asOf,
        value: policy.beta,
        evidenceRefs: policy.evidenceRefs,
        tier: tiers?.beta.tier,
        fallbackReason: tiers?.beta.fallbackReason,
      },
      {
        component: "erp",
        source: policy.erpSource,
        asOf: tiers ? tiers.equityRiskPremium.asOf : policy.asOf,
        value: policy.equityRiskPremium,
        evidenceRefs: policy.evidenceRefs,
        tier: tiers?.equityRiskPremium.tier,
        fallbackReason: tiers?.equityRiskPremium.fallbackReason,
      },
    ],
    warnings: [
      ...(policy.asOf ? [] : ["CAPM inputs are not pinned to an as-of date."]),
      ...(policy.evidenceRefs.length ? [] : ["CAPM inputs have no evidence reference."]),
      ...(priorKeys.length
        ? [`CAPM inputs resting on undated priors rather than sourced data: ${priorKeys.join(", ")}.`]
        : []),
    ],
  };
}

function reportedDebtCost(current: RecastPeriod | null | undefined, previous: RecastPeriod | null | undefined): number | null {
  if (!current || !previous) return null;
  const averageDebt = (Math.abs(current.bs.FO) + Math.abs(previous.bs.FO)) / 2;
  if (!Number.isFinite(averageDebt) || averageDebt <= 1 || !Number.isFinite(current.is.FinanceCost)) return null;
  return clamp(current.is.FinanceCost / averageDebt, 0.03, 0.35);
}

function resolveDebt(
  policy: CostOfDebtPolicy,
  current: RecastPeriod | null | undefined,
  previous: RecastPeriod | null | undefined,
  riskFreeFallback: number,
): { kdPretax: number; evidence: CostEvidence[]; warnings: string[] } {
  if (policy.mode === "manual") {
    return {
      kdPretax: policy.kdPretax,
      evidence: [{ component: "debt-cost", source: `Manual debt cost: ${policy.rationale || "rationale unavailable"}`, asOf: null, value: policy.kdPretax, evidenceRefs: policy.evidenceRefs }],
      warnings: [
        ...(policy.rationale.trim() ? [] : ["Manual debt cost has no reviewer rationale."]),
        ...(policy.evidenceRefs.length ? [] : ["Manual debt cost has no evidence reference."]),
      ],
    };
  }
  if (policy.mode === "credit-spread") {
    return {
      kdPretax: policy.riskFreeRate + policy.spread,
      evidence: [{ component: "debt-cost", source: `${policy.curveSource}; ${policy.ratingSource}`, asOf: policy.asOf, value: policy.riskFreeRate + policy.spread, evidenceRefs: policy.evidenceRefs }],
      warnings: [
        ...(policy.asOf ? [] : ["Credit-spread debt cost is not pinned to an as-of date."]),
        ...(policy.evidenceRefs.length ? [] : ["Credit-spread debt cost has no evidence reference."]),
      ],
    };
  }
  const reported = reportedDebtCost(current, previous);
  if (reported != null) {
    return {
      kdPretax: reported,
      evidence: [{ component: "debt-cost", source: "Reported finance cost / average financial obligations", asOf: current?.period_end ?? null, value: reported, evidenceRefs: [] }],
      warnings: ["Reported-effective debt cost lacks fact-level evidence until canonical fact wiring is complete."],
    };
  }
  const fallback = Math.max(0.04, riskFreeFallback + policy.fallbackSpread);
  return {
    kdPretax: fallback,
    evidence: [{ component: "debt-cost", source: "Risk-free plus guarded fallback spread", asOf: null, value: fallback, evidenceRefs: [] }],
    warnings: ["Reported-effective debt cost unavailable; used a guarded risk-free spread fallback."],
  };
}

function capitalWeights(config: EngineConfig, current: RecastPeriod | null | undefined): CapitalStructureWeights {
  const noa = current ? Math.abs(current.bs.NOA) : 0;
  if (current && noa > 0 && Number.isFinite(current.bs.CSE + current.bs.MI) && Number.isFinite(current.bs.NFO)) {
    return {
      period: current.period_end,
      equityClaims: current.bs.CSE + current.bs.MI,
      netFinancialObligations: current.bs.NFO,
      operatingAssetBase: noa,
      equityWeight: (current.bs.CSE + current.bs.MI) / noa,
      debtWeight: current.bs.NFO / noa,
      source: "structural",
    };
  }
  const companyType = config.company_type ?? "auto";
  const fallbackWeight = config.equity_weight != null && config.equity_weight > 0
    ? clamp(config.equity_weight, 0.1, 0.99)
    : SECTOR_EQUITY_WEIGHTS[companyType] ?? 0.8;
  return {
    period: null,
    equityClaims: null,
    netFinancialObligations: null,
    operatingAssetBase: null,
    equityWeight: fallbackWeight,
    debtWeight: 1 - fallbackWeight,
    source: "config-fallback",
  };
}

export function resolveCostOfCapital(input: ResolveCostOfCapitalInput): CostOfCapitalResult {
  const equity = resolveEquity(input.equityPolicy);
  const riskFreeRate = input.equityPolicy.mode === "capm"
    ? input.equityPolicy.riskFreeRate
    : input.config.risk_free_rate;
  const debt = resolveDebt(input.debtPolicy, input.current, input.previous, riskFreeRate);
  const taxRate = input.current?.is.taxRate != null && input.current.is.taxRate > 0.01
    ? clamp(input.current.is.taxRate, 0, 0.5)
    : clamp(input.config.tax_rate_for_kd ?? input.config.statutory_tax_rate, 0, 0.5);
  const kdAfterTax = debt.kdPretax * (1 - taxRate);
  const weights = capitalWeights(input.config, input.current);
  const rawKw = equity.ke * weights.equityWeight + kdAfterTax * weights.debtWeight;
  const kw = Math.max(riskFreeRate, rawKw);
  const guards: CostOfCapitalGuard[] = [
    {
      guardId: "ke-plausibility",
      status: finitePositive(equity.ke) && equity.ke <= 0.5 ? "passed" : "failed",
      observed: equity.ke,
      summary: "Cost of equity must be finite and in (0, 50%].",
    },
    {
      guardId: "kd-plausibility",
      status: finitePositive(debt.kdPretax) && debt.kdPretax <= 0.5 ? "passed" : "failed",
      observed: debt.kdPretax,
      summary: "Pre-tax debt cost must be finite and in (0, 50%].",
    },
    {
      guardId: "structural-weights",
      status: weights.source === "structural" ? "passed" : "warned",
      observed: weights.operatingAssetBase,
      summary: weights.source === "structural"
        ? "Capital weights are derived from the selected balance sheet."
        : "Capital weights use a configuration/sector fallback.",
    },
    {
      guardId: "kw-plausibility",
      status: finitePositive(kw) && kw <= 0.5 ? "passed" : "failed",
      observed: kw,
      summary: "Operating capital cost must be finite and in (0, 50%].",
    },
  ];
  const warnings = [
    ...equity.warnings,
    ...debt.warnings,
    ...(weights.source === "structural" ? [] : ["Structural capital weights unavailable; kw is guarded."]),
  ];
  const status = guards.some((guard) => guard.status === "failed")
    ? "blocked"
    : guards.some((guard) => guard.status === "warned") || warnings.length > 0
      ? "guarded"
      : "confirmed";
  const evidence: CostEvidence[] = [...equity.evidence, ...debt.evidence, {
    component: "tax",
    source: input.current?.is.taxRate != null ? "Selected-period effective tax rate" : "Configuration tax rate",
    asOf: input.current?.period_end ?? null,
    value: taxRate,
    evidenceRefs: [],
  }, {
    component: "capital-structure",
    source: weights.source,
    asOf: weights.period,
    value: weights.equityWeight,
    evidenceRefs: [],
  }];
  return Object.freeze({
    policyVersion: COST_OF_CAPITAL_POLICY_VERSION,
    status,
    ke: equity.ke,
    kdPretax: debt.kdPretax,
    kdAfterTax,
    kw,
    equityMode: input.equityPolicy.mode,
    debtMode: input.debtPolicy.mode,
    beta: equity.beta,
    riskFreeRate,
    equityRiskPremium: equity.erp,
    // Manual ke reports no tiers: the reviewer supplied the number directly, so
    // there is nothing to attribute. Absent is honest; "sourced" would not be.
    assumptions: input.equityPolicy.mode === "capm" ? input.equityPolicy.assumptions : undefined,
    taxRate,
    weights,
    evidence,
    warnings,
    guards,
  });
}

export function costPoliciesFromConfig(
  config: EngineConfig,
  options?: {
    readonly riskFreeRate?: number | undefined;
    readonly marketAsOf?: string | null | undefined;
    /** Pinned macro pack. When absent, rf/ERP/terminal ceiling resolve as priors. */
    readonly macroPack?: MacroPack | null | undefined;
    /**
     * Pinned regressed betas, keyed by exchange ticker. When absent, beta
     * resolves from peers if deep enough and otherwise as a sector prior, which
     * is what every caller got before this pack existed.
     */
    readonly betaPack?: EquityBetaPack | null | undefined;
    /** Analysis date, for the pack's staleness and look-ahead checks. */
    readonly analysisAsOf?: string | null | undefined;
    /** Peer levered betas, for a bottom-up beta instead of the sector prior. */
    readonly peerBetas?: readonly PeerLeveredBeta[] | undefined;
    /** Target leverage to relever a bottom-up beta at, from structural weights. */
    readonly targetDebtToEquity?: number | null | undefined;
    readonly taxRate?: number | null | undefined;
  },
): { equityPolicy: CostOfEquityPolicy; debtPolicy: CostOfDebtPolicy } {
  // Beta and the ERP used to be read straight off `SECTOR_BETAS` and
  // `config.equity_risk_premium` and stamped `erpSource: "Engine configuration"`.
  // Both still resolve to those values when nothing better exists, but now they
  // arrive labelled, so the provenance gate can tell a sourced ERP from a guess.
  const assumptions = resolveCapitalCostAssumptions({
    config,
    macroPack: options?.macroPack,
    betaPack: options?.betaPack,
    analysisAsOf: options?.analysisAsOf,
    liveRiskFreeRate: options?.riskFreeRate != null
      ? { value: options.riskFreeRate, asOf: options?.marketAsOf ?? null, source: "Pinned market snapshot" }
      : null,
    peerBetas: options?.peerBetas,
    targetDebtToEquity: options?.targetDebtToEquity,
    taxRate: options?.taxRate,
  });

  const equityPolicy: CostOfEquityPolicy = config.cost_of_equity_mode === "manual"
    ? {
        mode: "manual",
        ke: config.ke,
        rationale: config.ke_manual_rationale ?? "",
        evidenceRefs: config.ke_evidence_refs ?? [],
      }
    : {
        mode: "capm",
        riskFreeRate: assumptions.riskFreeRate.value,
        beta: assumptions.beta.value,
        equityRiskPremium: assumptions.equityRiskPremium.value,
        riskFreeSource: assumptions.riskFreeRate.source,
        betaSource: assumptions.beta.source,
        erpSource: assumptions.equityRiskPremium.source,
        asOf: options?.marketAsOf ?? null,
        evidenceRefs: [],
        assumptions,
      };

  let debtPolicy: CostOfDebtPolicy;
  if (config.cost_of_debt_mode === "manual") {
    debtPolicy = {
      mode: "manual",
      kdPretax: config.kd_pretax,
      rationale: config.kd_manual_rationale ?? "",
      evidenceRefs: config.kd_evidence_refs ?? [],
    };
  } else if (config.cost_of_debt_mode === "credit-spread") {
    debtPolicy = {
      mode: "credit-spread",
      // Same resolved rate the equity side used, so kd and ke cannot sit on
      // different risk-free rates within one run.
      riskFreeRate: assumptions.riskFreeRate.value,
      spread: config.credit_spread ?? 0.03,
      curveSource: "Configured credit curve",
      ratingSource: "Configured rating/spread",
      asOf: config.credit_spread_as_of ?? null,
      evidenceRefs: config.kd_evidence_refs ?? [],
    };
  } else {
    debtPolicy = { mode: "reported-effective", fallbackSpread: 0.03 };
  }
  return { equityPolicy, debtPolicy };
}

export function resolveCostOfCapitalFromConfig(input: {
  readonly config: EngineConfig;
  readonly current?: RecastPeriod | null | undefined;
  readonly previous?: RecastPeriod | null | undefined;
  readonly riskFreeRate?: number | undefined;
  readonly marketAsOf?: string | null | undefined;
  readonly macroPack?: MacroPack | null | undefined;
  readonly betaPack?: EquityBetaPack | null | undefined;
  readonly analysisAsOf?: string | null | undefined;
  readonly peerBetas?: readonly PeerLeveredBeta[] | undefined;
}): CostOfCapitalResult {
  // A bottom-up beta must be relevered at the target's own leverage, so it is
  // derived from the same selected-period balance sheet the weights come from
  // rather than passed in separately and risking a mismatch.
  const structural = capitalWeights(input.config, input.current);
  const targetDebtToEquity = structural.source === "structural"
    && structural.equityClaims != null && structural.equityClaims > 0
    && structural.netFinancialObligations != null
    ? Math.max(0, structural.netFinancialObligations / structural.equityClaims)
    : null;

  const policies = costPoliciesFromConfig(input.config, {
    riskFreeRate: input.riskFreeRate,
    marketAsOf: input.marketAsOf,
    macroPack: input.macroPack,
    betaPack: input.betaPack,
    analysisAsOf: input.analysisAsOf,
    peerBetas: input.peerBetas,
    targetDebtToEquity,
    taxRate: input.current?.is.taxRate != null && input.current.is.taxRate > 0.01
      ? clamp(input.current.is.taxRate, 0, 0.5)
      : clamp(input.config.tax_rate_for_kd ?? input.config.statutory_tax_rate, 0, 0.5),
  });
  return resolveCostOfCapital({
    ...policies,
    config: input.config,
    current: input.current,
    previous: input.previous,
  });
}
