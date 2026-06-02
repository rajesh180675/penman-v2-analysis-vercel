import type { CashFlowDcfResult } from "../cashFlowDcf";
import type { ReverseDcfDiagnostics, ValuationScenarioCard } from "../valuationCommandCenter";
import type {
  EvidenceIndependenceGroup,
  EvidenceWeightedModelContribution,
  EvidenceWeightedValuationSynthesis,
  ForecastHoldoutSummary,
  ValuationEvidenceLedger,
} from "./types";

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function baseScenario(scenarios: ValuationScenarioCard[]): ValuationScenarioCard | null {
  return scenarios.find((scenario) => scenario.key === "base") ?? scenarios[0] ?? null;
}

function accrualPerShare(card: ValuationScenarioCard | null): number | null {
  if (!card) return null;
  return median([
    card.valuation.perShare?.intrinsic_re_per_share ?? null,
    card.valuation.perShare?.intrinsic_reoi_per_share ?? null,
  ].filter((value): value is number => value != null && Number.isFinite(value)));
}

function contribution(args: {
  modelKey: string;
  label: string;
  independenceGroup: EvidenceIndependenceGroup;
  perShare: number | null;
  baseReliability: number;
  evidenceCoveragePenalty: number;
  forecastSkillPenalty: number;
  priceDerivedPenalty?: number | undefined;
  includedInIntrinsicRange: boolean;
  reason: string;
}): EvidenceWeightedModelContribution {
  const finalWeight = args.includedInIntrinsicRange && args.perShare != null && args.perShare > 0
    ? clamp(args.baseReliability * (1 - args.evidenceCoveragePenalty) * (1 - args.forecastSkillPenalty) * (1 - (args.priceDerivedPenalty ?? 0)), 0, 1)
    : 0;
  return {
    modelKey: args.modelKey,
    label: args.label,
    independenceGroup: args.independenceGroup,
    perShare: finiteOrNull(args.perShare),
    baseReliability: args.baseReliability,
    evidenceCoveragePenalty: args.evidenceCoveragePenalty,
    forecastSkillPenalty: args.forecastSkillPenalty,
    priceDerivedPenalty: args.priceDerivedPenalty ?? 0,
    finalWeight,
    includedInIntrinsicRange: args.includedInIntrinsicRange && finalWeight > 0,
    reason: args.reason,
  };
}

function weightedMid(contributions: EvidenceWeightedModelContribution[]): number | null {
  const included = contributions.filter((item) => item.includedInIntrinsicRange && item.perShare != null && item.finalWeight > 0);
  const denominator = included.reduce((sum, item) => sum + item.finalWeight, 0);
  if (!included.length || denominator <= 0) return null;
  return included.reduce((sum, item) => sum + item.perShare! * item.finalWeight, 0) / denominator;
}

function criticalDivergence(contributions: EvidenceWeightedModelContribution[]): boolean {
  const values = contributions
    .filter((item) => item.includedInIntrinsicRange && item.perShare != null && item.perShare > 0)
    .map((item) => item.perShare!);
  if (values.length < 2) return false;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const mid = median(values) ?? low;
  return (high - low) / Math.max(Math.abs(mid), 1) > 0.5;
}

export function buildEvidenceWeightedSynthesis(args: {
  scenarios: ValuationScenarioCard[];
  cashFlowDcf: CashFlowDcfResult | null;
  evEbitdaPerShare: number | null;
  reverseDcf: ReverseDcfDiagnostics | null;
  evidenceLedger: ValuationEvidenceLedger;
  forecastHoldout: ForecastHoldoutSummary;
  marketPrice: number | null;
}): EvidenceWeightedValuationSynthesis {
  const card = baseScenario(args.scenarios);
  const evidenceCoveragePenalty = args.evidenceLedger.summary.total > 0
    ? clamp(args.evidenceLedger.summary.unsupportedCount / args.evidenceLedger.summary.total, 0, 0.5)
    : 0.5;
  const forecastSkillPenalty = args.forecastHoldout.aggregate.confidencePenaltyPct;
  const contributions: EvidenceWeightedModelContribution[] = [
    contribution({
      modelKey: "accrual-riv-reoi",
      label: "Accrual RIV/ReOI family",
      independenceGroup: "accrual-history",
      perShare: accrualPerShare(card),
      baseReliability: 0.62,
      evidenceCoveragePenalty,
      forecastSkillPenalty,
      includedInIntrinsicRange: true,
      reason: "RE and ReOI are treated as one accrual-history family, not two independent confirmations.",
    }),
    contribution({
      modelKey: "cash-fcff-dcf",
      label: "Cash-statement FCFF DCF",
      independenceGroup: "cash-statement",
      perShare: args.cashFlowDcf?.perShare ?? null,
      baseReliability: 0.72,
      evidenceCoveragePenalty: Math.min(evidenceCoveragePenalty, 0.3),
      forecastSkillPenalty,
      includedInIntrinsicRange: Boolean(args.cashFlowDcf?.perShare != null && args.cashFlowDcf.perShare > 0),
      reason: args.cashFlowDcf
        ? "Direct cash-statement FCFF lens; independent from the NOA/OI accrual algebra."
        : "Cash-statement FCFF lens unavailable or skipped honestly.",
    }),
    contribution({
      modelKey: "relative-ev-ebitda",
      label: "Relative EV/EBITDA cross-check",
      independenceGroup: "peer-market",
      perShare: args.evEbitdaPerShare,
      baseReliability: 0.38,
      evidenceCoveragePenalty: args.evEbitdaPerShare == null ? 0.5 : evidenceCoveragePenalty,
      forecastSkillPenalty: Math.min(forecastSkillPenalty, 0.15),
      includedInIntrinsicRange: args.evEbitdaPerShare != null && args.evEbitdaPerShare > 0,
      reason: args.evEbitdaPerShare != null
        ? "Peer-market lens included at a lower weight because multiples challenge assumptions but should not dominate intrinsic value."
        : "Peer-market lens unavailable because usable peer multiple data is missing.",
    }),
    contribution({
      modelKey: "reverse-dcf",
      label: "Reverse DCF market-implied expectations",
      independenceGroup: "market-price",
      perShare: args.marketPrice,
      baseReliability: 0,
      evidenceCoveragePenalty: 0,
      forecastSkillPenalty: 0,
      priceDerivedPenalty: 1,
      includedInIntrinsicRange: false,
      reason: "Reverse DCF is quarantined: it explains market expectations but carries zero intrinsic-range weight.",
    }),
  ];

  const included = contributions.filter((item) => item.includedInIntrinsicRange && item.perShare != null);
  const rawLow = included.length ? Math.min(...included.map((item) => item.perShare!)) : null;
  const rawHigh = included.length ? Math.max(...included.map((item) => item.perShare!)) : null;
  const mid = weightedMid(contributions);
  const widening = args.forecastHoldout.aggregate.valuationRangeWideningPct;
  const lowPerShare = rawLow != null && mid != null ? Math.max(0, rawLow * (1 - widening)) : rawLow;
  const highPerShare = rawHigh != null ? rawHigh * (1 + widening) : null;
  const uniqueIntrinsicGroups = new Set(included.map((item) => item.independenceGroup));
  const priceDerivedMisuse = args.evidenceLedger.rows.filter((row) => row.priceDerived && row.eligibleForIntrinsicConfidence).length;
  const diverged = criticalDivergence(contributions);
  const checklist = [
    {
      key: "assumption-evidence" as const,
      label: "Assumptions independently sourced",
      passed: args.evidenceLedger.summary.unsupportedCount === args.evidenceLedger.summary.priceDerivedCount,
      detail: `${args.evidenceLedger.summary.unsupportedCount} unsupported rows; price-derived rows are expected to be unsupported.`,
    },
    {
      key: "forecast-holdout-skill" as const,
      label: "Forecast holdout skill",
      passed: args.forecastHoldout.aggregate.status === "confirmed",
      detail: `Holdout status ${args.forecastHoldout.aggregate.status}; weighted MAPE ${args.forecastHoldout.aggregate.weightedMape == null ? "n/a" : (args.forecastHoldout.aggregate.weightedMape * 100).toFixed(1) + "%"}.`,
    },
    {
      key: "price-derived-isolation" as const,
      label: "Price-derived assumptions excluded",
      passed: priceDerivedMisuse === 0,
      detail: `${priceDerivedMisuse} price-derived assumption(s) eligible for intrinsic confidence.`,
    },
    {
      key: "paradigm-independence" as const,
      label: "Independent valuation lenses",
      passed: uniqueIntrinsicGroups.size >= 2,
      detail: `${uniqueIntrinsicGroups.size} independent intrinsic lens group(s) available.`,
    },
    {
      key: "range-widening" as const,
      label: "Range widened for weak evidence",
      passed: widening >= 0,
      detail: `Intrinsic range widened by ${(widening * 100).toFixed(1)}% for forecast/evidence quality.`,
    },
  ];

  const status: EvidenceWeightedValuationSynthesis["defensibility"]["status"] =
    priceDerivedMisuse > 0 || !included.length
      ? "blocked"
      : checklist.every((item) => item.passed) && !diverged
        ? "confirmed"
        : "guarded";

  return {
    contributions,
    intrinsicRange: {
      lowPerShare,
      midPerShare: mid,
      highPerShare,
      rangeWideningPct: widening,
    },
    marketExpectationRange: {
      pricePerShare: args.marketPrice,
      requiredGrowth: args.reverseDcf?.impliedOwnerEarningsGrowth ?? null,
      requiredRnoa: args.reverseDcf?.impliedTerminalROIC ?? null,
      saturated: Boolean(
        (args.reverseDcf?.impliedOwnerEarningsGrowth ?? 0) >= 0.4
        || (args.reverseDcf?.impliedTerminalROIC ?? 0) >= 0.8,
      ),
    },
    defensibility: {
      status,
      checklist,
      summary: status === "confirmed"
        ? "Intrinsic range is supported by multiple independent non-price lenses and confirmed holdout evidence."
        : status === "blocked"
          ? "Intrinsic defensibility is blocked because price-derived or missing evidence would otherwise contaminate confidence."
          : diverged
            ? "Intrinsic range is guarded because independent lenses diverge materially."
            : "Intrinsic range is usable but guarded because evidence, forecast skill, or lens independence is incomplete.",
    },
  };
}
