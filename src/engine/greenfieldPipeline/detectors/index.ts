import { maxSeverity } from "../adapters";
import type { AnomalySignal, GreenfieldRunContext, NormalizedPeriod, SeverityLevel } from "../types";

type DetectorFn = (periods: readonly NormalizedPeriod[], context: GreenfieldRunContext) => AnomalySignal[];

const severityOrder: Record<SeverityLevel, number> = { INFO: 1, WARNING: 2, BLOCKING: 3, CRITICAL: 4 };

function finite(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

function absRatio(numerator: number | null, denominator: number | null): number | null {
  if (!finite(numerator) || !finite(denominator) || denominator === 0) return null;
  return Math.abs(numerator) / Math.max(Math.abs(denominator), 1);
}

function signal(input: Omit<AnomalySignal, "id" | "suppresses" | "blocksValuation" | "blocksAdjustment"> & Partial<Pick<AnomalySignal, "suppresses" | "blocksValuation" | "blocksAdjustment">>): AnomalySignal {
  const p = Math.max(0, Math.min(1, input.p_artifact));
  return {
    ...input,
    id: `${input.detectorId}:${input.period}:${input.label}`,
    p_artifact: p,
    suppresses: input.suppresses ?? [],
    blocksValuation: input.blocksValuation ?? false,
    blocksAdjustment: input.blocksAdjustment ?? false,
  };
}

function latest(periods: readonly NormalizedPeriod[]): NormalizedPeriod | null {
  return periods.length > 0 ? periods[periods.length - 1]! : null;
}

function longestNegativeRun(periods: readonly NormalizedPeriod[]): number {
  let current = 0;
  let longest = 0;
  for (const period of periods) {
    if (finite(period.values.cse) && period.values.cse <= 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function detectStandardAdoption(periods: readonly NormalizedPeriod[]): AnomalySignal[] {
  const signals: AnomalySignal[] = [];
  const hasPreIndAs = periods.some((p) => p.accountingStandard === "revised-sch-vi" || p.periodEnd < "2016-04-01");
  const hasPostIndAs = periods.some((p) => p.accountingStandard === "ind-as" || p.periodEnd >= "2017-03-31");
  for (const period of periods) {
    const adoptionWindow = period.periodEnd.startsWith("2017") || period.periodEnd.startsWith("2020");
    if ((hasPreIndAs && hasPostIndAs && adoptionWindow) || (period.standardAdoptions.indAS116 && period.periodEnd.startsWith("2020"))) {
      signals.push(signal({
        detectorId: "D1_STANDARD_ADOPTION",
        period: period.periodEnd,
        severity: "WARNING",
        p_artifact: 0.9,
        label: period.periodEnd.startsWith("2020") ? "IND_AS_116_ADOPTION_WINDOW" : "ACCOUNTING_STANDARD_TRANSITION",
        message: period.periodEnd.startsWith("2020")
          ? "Ind AS 116 lease adoption window; balance-sheet leverage and asset base may not be comparable with pre-2019 periods."
          : "Accounting-standard transition window; pre/post periods should not be treated as one clean trend without caveats.",
        affectedFields: ["accountingStandard", "values.leaseLiabilities", "values.rightOfUseAssets"],
        evidence: { accountingStandard: period.accountingStandard, indAS116: period.standardAdoptions.indAS116 },
        suggestedAdjusters: period.periodEnd.startsWith("2020") ? ["A1_LEASE_ADJUSTER", "A3_PRE_BREAK_TRUNCATOR"] : ["A3_PRE_BREAK_TRUNCATOR"],
      }));
    }
  }
  return signals;
}

function detectDirtySurplus(periods: readonly NormalizedPeriod[]): AnomalySignal[] {
  return periods.flatMap((period) => {
    const ratio = absRatio(period.derived.dirtySurplusSeed, period.values.cse);
    if (ratio == null || ratio < 0.05) return [];
    const adoptionArtifact = period.periodEnd <= "2020-03-31" || period.standardAdoptions.indAS116;
    return [signal({
      detectorId: "D2_DIRTY_SURPLUS",
      period: period.periodEnd,
      severity: ratio >= 0.2 ? "CRITICAL" : "WARNING",
      p_artifact: adoptionArtifact ? 0.82 : 0.45,
      label: "DIRTY_SURPLUS_SPIKE",
      message: `Clean-surplus residual is ${(ratio * 100).toFixed(1)}% of CSE; classify before using equity anchors.`,
      affectedFields: ["derived.dirtySurplusSeed", "values.cse", "values.netIncome"],
      evidence: { dirtySurplusSeed: period.derived.dirtySurplusSeed, ratioToCse: ratio, adoptionArtifact },
      suggestedAdjusters: adoptionArtifact ? ["A2_DIRTY_SURPLUS_ADJUSTER", "A3_PRE_BREAK_TRUNCATOR"] : [],
      blocksValuation: ratio >= 0.2 && !adoptionArtifact,
    })];
  });
}

function detectLeaseAccounting(periods: readonly NormalizedPeriod[]): AnomalySignal[] {
  return periods.flatMap((period) => {
    const materiality = absRatio(Math.max(Math.abs(period.values.leaseLiabilities ?? 0), Math.abs(period.values.rightOfUseAssets ?? 0)), period.values.totalAssets);
    if (materiality == null || materiality < 0.03 || !period.standardAdoptions.indAS116) return [];
    return [signal({
      detectorId: "D3_LEASE_ACCOUNTING",
      period: period.periodEnd,
      severity: materiality >= 0.15 ? "WARNING" : "INFO",
      p_artifact: 0.9,
      label: "LEASE_ACCOUNTING_DISTORTION",
      message: `Lease liabilities/ROU assets are material (${(materiality * 100).toFixed(1)}% of assets); separate lease mechanics from insolvency risk.`,
      affectedFields: ["values.leaseLiabilities", "values.rightOfUseAssets", "values.financialDebtExLease"],
      evidence: { leaseLiabilities: period.values.leaseLiabilities, rightOfUseAssets: period.values.rightOfUseAssets, materiality },
      suggestedAdjusters: ["A1_LEASE_ADJUSTER"],
    })];
  });
}

function detectFxOciTranslation(periods: readonly NormalizedPeriod[]): AnomalySignal[] {
  return periods.flatMap((period) => {
    const seed = period.derived.dirtySurplusSeed;
    const oci = period.values.oci;
    if (!finite(seed) || !finite(oci) || Math.abs(seed) < 1) return [];
    const coverage = Math.abs(oci) / Math.abs(seed);
    if (coverage < 0.7) return [];
    return [signal({
      detectorId: "D4_FX_OCI_TRANSLATION",
      period: period.periodEnd,
      severity: "INFO",
      p_artifact: 0.9,
      label: "OCI_EXPLAINS_DIRTY_SURPLUS",
      message: `OCI explains ${(coverage * 100).toFixed(0)}% of dirty-surplus residual; downgrade the dirty-surplus spike if same-period.`,
      affectedFields: ["values.oci", "derived.dirtySurplusSeed"],
      evidence: { oci, dirtySurplusSeed: seed, coverage },
      suggestedAdjusters: ["A2_DIRTY_SURPLUS_ADJUSTER"],
      suppresses: [{ detectorId: "D2_DIRTY_SURPLUS", period: period.periodEnd, reason: "OCI/FX translation explains same-period dirty-surplus residual." }],
    })];
  });
}

function detectNegativeEquitySolvency(periods: readonly NormalizedPeriod[]): AnomalySignal[] {
  const last = latest(periods);
  if (!last) return [];
  const negativePeriods = periods.filter((period) => finite(period.values.cse) && period.values.cse <= 0);
  if (negativePeriods.length === 0) return [];
  const latestNegative = finite(last.values.cse) && last.values.cse <= 0;
  const runLength = longestNegativeRun(periods);
  const currentSolvencyHealthy = !latestNegative && finite(last.values.cfo) && last.values.cfo > 0 && (!finite(last.values.nfoExLease) || last.values.nfoExLease <= Math.max(Math.abs(last.values.cse ?? 0) * 0.5, 1));
  const hasLeaseEvidence = periods.some((period) => finite(period.values.leaseLiabilities) || finite(period.values.rightOfUseAssets));

  if (!latestNegative) {
    return [signal({
      detectorId: "D5_NEGATIVE_EQUITY_SOLVENCY",
      period: last.periodEnd,
      severity: "WARNING",
      p_artifact: currentSolvencyHealthy || hasLeaseEvidence ? 0.88 : 0.62,
      label: "HISTORICAL_NEGATIVE_EQUITY_ARTIFACT",
      message: `${negativePeriods.length} historical negative-equity period(s), but latest CSE is positive. Treat as historical/accounting caveat, not current distress.`,
      affectedFields: ["values.cse", "values.leaseNeutralEquity", "values.nfoExLease"],
      evidence: { negativePeriods: negativePeriods.length, longestNegativeRun: runLength, latestCse: last.values.cse, latestCfo: last.values.cfo, latestNfoExLease: last.values.nfoExLease, currentSolvencyHealthy },
      suggestedAdjusters: hasLeaseEvidence ? ["A1_LEASE_ADJUSTER", "A3_PRE_BREAK_TRUNCATOR"] : ["A3_PRE_BREAK_TRUNCATOR"],
    })];
  }

  const severity: SeverityLevel = runLength >= 3 && finite(last.values.cfo) && last.values.cfo <= 0 ? "CRITICAL" : "BLOCKING";
  return [signal({
    detectorId: "D5_NEGATIVE_EQUITY_SOLVENCY",
    period: last.periodEnd,
    severity,
    p_artifact: hasLeaseEvidence && finite(last.values.leaseNeutralEquity) && last.values.leaseNeutralEquity > 0 ? 0.55 : 0.1,
    label: severity === "CRITICAL" ? "CURRENT_NEGATIVE_EQUITY_CASH_BURN" : "CURRENT_NEGATIVE_EQUITY",
    message: severity === "CRITICAL"
      ? "Latest CSE is non-positive with sustained negative equity and non-positive CFO; current solvency is stressed."
      : "Latest CSE is non-positive; equity-side valuation anchors must fail closed unless lease-adjusted evidence rescues the signal.",
    affectedFields: ["values.cse", "values.cfo", "values.nfoExLease"],
    evidence: { negativePeriods: negativePeriods.length, longestNegativeRun: runLength, latestCse: last.values.cse, latestCfo: last.values.cfo, latestNfoExLease: last.values.nfoExLease },
    suggestedAdjusters: hasLeaseEvidence ? ["A1_LEASE_ADJUSTER"] : [],
    blocksValuation: true,
  })];
}

function detectStructuralBreakDemerger(periods: readonly NormalizedPeriod[]): AnomalySignal[] {
  return periods.flatMap((period) => {
    const ratio = absRatio(period.derived.dirtySurplusSeed, period.values.cse);
    const window = period.periodEnd.startsWith("2016") || period.periodEnd.startsWith("2017") || period.periodEnd.startsWith("2020");
    if (!window && (ratio == null || ratio < 0.12)) return [];
    return [signal({
      detectorId: "D6_STRUCTURAL_BREAK_DEMERGER",
      period: period.periodEnd,
      severity: ratio != null && ratio >= 0.2 ? "WARNING" : "INFO",
      p_artifact: window ? 0.88 : 0.65,
      label: "STRUCTURAL_BREAK_WINDOW",
      message: "Structural-break/adoption window detected; post-break valuation window should be preferred by default.",
      affectedFields: ["periodEnd", "derived.dirtySurplusSeed"],
      evidence: { dirtySurplusRatio: ratio, regimeWindow: window },
      suggestedAdjusters: ["A3_PRE_BREAK_TRUNCATOR"],
    })];
  });
}

function detectBuybackCapitalReturn(periods: readonly NormalizedPeriod[]): AnomalySignal[] {
  return periods.flatMap((period) => {
    const ratio = absRatio(period.values.buybacks, period.values.cse);
    if (ratio == null || ratio < 0.02) return [];
    return [signal({
      detectorId: "D7_BUYBACK_CAPITAL_RETURN",
      period: period.periodEnd,
      severity: ratio >= 0.08 ? "WARNING" : "INFO",
      p_artifact: 0.85,
      label: "CAPITAL_RETURN_DISTORTION",
      message: `Buybacks/capital returns are ${(ratio * 100).toFixed(1)}% of CSE; do not misclassify distribution mechanics as operating deterioration.`,
      affectedFields: ["values.buybacks", "values.cse", "derived.dirtySurplusSeed"],
      evidence: { buybacks: period.values.buybacks, ratioToCse: ratio },
      suggestedAdjusters: ["A4_BUYBACK_ADJUSTER", "A2_DIRTY_SURPLUS_ADJUSTER"],
    })];
  });
}

function detectComponentReclassification(periods: readonly NormalizedPeriod[]): AnomalySignal[] {
  const signals: AnomalySignal[] = [];
  for (let index = 1; index < periods.length; index++) {
    const previous = periods[index - 1]!;
    const period = periods[index]!;
    const leaseDelta = finite(period.values.leaseLiabilities) && finite(previous.values.leaseLiabilities) ? period.values.leaseLiabilities - previous.values.leaseLiabilities : null;
    const ratio = absRatio(leaseDelta, period.values.totalAssets);
    if (ratio == null || ratio < 0.10) continue;
    signals.push(signal({
      detectorId: "D8_COMPONENT_RECLASSIFICATION",
      period: period.periodEnd,
      severity: "WARNING",
      p_artifact: 0.72,
      label: "COMPONENT_RECLASSIFICATION",
      message: `Lease/financial-obligation component moved ${(ratio * 100).toFixed(1)}% of assets year-on-year; classify before trend analysis.`,
      affectedFields: ["values.leaseLiabilities", "values.financialDebtExLease"],
      evidence: { leaseDelta, ratioToAssets: ratio },
      suggestedAdjusters: ["A1_LEASE_ADJUSTER", "A3_PRE_BREAK_TRUNCATOR"],
    }));
  }
  return signals;
}

function detectMetricStepChange(periods: readonly NormalizedPeriod[]): AnomalySignal[] {
  const signals: AnomalySignal[] = [];
  for (let index = 1; index < periods.length; index++) {
    const previous = periods[index - 1]!;
    const period = periods[index]!;
    const rnoaDelta = finite(period.derived.rnoa) && finite(previous.derived.rnoa) ? period.derived.rnoa - previous.derived.rnoa : null;
    const pmDelta = finite(period.derived.pm) && finite(previous.derived.pm) ? period.derived.pm - previous.derived.pm : null;
    const flevDelta = finite(period.derived.flev) && finite(previous.derived.flev) ? period.derived.flev - previous.derived.flev : null;
    if (Math.max(Math.abs(rnoaDelta ?? 0), Math.abs(pmDelta ?? 0)) < 0.30 && Math.abs(flevDelta ?? 0) < 2) continue;
    signals.push(signal({
      detectorId: "D9_METRIC_STEP_CHANGE",
      period: period.periodEnd,
      severity: "WARNING",
      p_artifact: period.isPartialPeriod ? 0.7 : 0.4,
      label: "METRIC_STEP_CHANGE",
      message: "RNOA/PM/FLEV step change exceeds reviewer threshold; verify cause before extrapolating.",
      affectedFields: ["derived.rnoa", "derived.pm", "derived.flev"],
      evidence: { rnoaDelta, pmDelta, flevDelta, isPartialPeriod: period.isPartialPeriod },
      suggestedAdjusters: period.isPartialPeriod ? ["A3_PRE_BREAK_TRUNCATOR"] : [],
    }));
  }
  return signals;
}

function detectExpansionCapexFcf(periods: readonly NormalizedPeriod[]): AnomalySignal[] {
  return periods.flatMap((period) => {
    if (!finite(period.values.fcfCash) || !finite(period.values.cfo) || !finite(period.values.capex)) return [];
    if (!(period.values.fcfCash < 0 && period.values.cfo > 0 && Math.abs(period.values.capex) > period.values.cfo)) return [];
    const capexToCfo = Math.abs(period.values.capex) / Math.max(period.values.cfo, 1);
    return [signal({
      detectorId: "D10_EXPANSION_CAPEX_FCF",
      period: period.periodEnd,
      severity: "INFO",
      p_artifact: 0.15,
      label: "NEGATIVE_FCF_EXPANSION_CAPEX",
      message: `FCF is negative because capex is ${capexToCfo.toFixed(1)}x CFO; this is a reinvestment burden, not automatic distress.`,
      affectedFields: ["values.fcfCash", "values.cfo", "values.capex"],
      evidence: { fcfCash: period.values.fcfCash, cfo: period.values.cfo, capex: period.values.capex, capexToCfo },
      suggestedAdjusters: [],
    })];
  });
}

function monthsSince(periodEnd: string, asOf: Date): number | null {
  const end = new Date(periodEnd).getTime();
  if (!Number.isFinite(end)) return null;
  return (asOf.getTime() - end) / (30.4375 * 86_400_000);
}

function detectFreshnessFrequency(periods: readonly NormalizedPeriod[], context: GreenfieldRunContext): AnomalySignal[] {
  const signals: AnomalySignal[] = [];
  const asOf = context.asOf instanceof Date ? context.asOf : new Date(context.asOf ?? Date.now());
  const last = latest(periods);
  if (last) {
    const staleMonths = monthsSince(last.periodEnd, asOf);
    if (staleMonths != null && staleMonths > 12) {
      signals.push(signal({
        detectorId: "D11_FRESHNESS_FREQUENCY",
        period: last.periodEnd,
        severity: staleMonths > 18 ? "WARNING" : "INFO",
        p_artifact: 0.75,
        label: "STALE_FINANCIALS",
        message: `Latest financial period is ${staleMonths.toFixed(1)} months old; cap confidence, but do not convert staleness into distress.`,
        affectedFields: ["periodEnd"],
        evidence: { staleMonths, asOf: asOf.toISOString().slice(0, 10) },
        suggestedAdjusters: [],
      }));
    }
  }
  for (const period of periods) {
    if (!period.isPartialPeriod) continue;
    signals.push(signal({
      detectorId: "D11_FRESHNESS_FREQUENCY",
      period: period.periodEnd,
      severity: "WARNING",
      p_artifact: 0.8,
      label: "PARTIAL_OR_MIXED_PERIOD",
      message: `Period length is ${period.periodLengthDays ?? "unknown"} days; growth and step-change detectors should not overreact.`,
      affectedFields: ["periodLengthDays", "isPartialPeriod"],
      evidence: { periodLengthDays: period.periodLengthDays, isPartialPeriod: period.isPartialPeriod },
      suggestedAdjusters: ["A3_PRE_BREAK_TRUNCATOR"],
    }));
  }
  return signals;
}

function detectMarketExpectationSaturation(periods: readonly NormalizedPeriod[], context: GreenfieldRunContext): AnomalySignal[] {
  const last = latest(periods);
  const market = context.marketExpectation;
  if (!last || !market) return [];
  const signals: AnomalySignal[] = [];
  if (market.marginOfSafetyPct != null && market.marginOfSafetyPct <= -0.5) {
    signals.push(signal({
      detectorId: "D12_MARKET_EXPECTATION_SATURATION",
      period: last.periodEnd,
      severity: market.marginOfSafetyPct <= -0.8 ? "WARNING" : "INFO",
      p_artifact: 0.05,
      label: "OVERVALUATION_SIGNAL",
      message: `Margin of safety is ${(market.marginOfSafetyPct * 100).toFixed(0)}%; valuation concern is real and must not be adjusted away.`,
      affectedFields: ["marketExpectation.marginOfSafetyPct"],
      evidence: { marginOfSafetyPct: market.marginOfSafetyPct, price: market.price ?? null, intrinsicValue: market.intrinsicValue ?? null },
      suggestedAdjusters: [],
    }));
  }
  if (market.reverseDcfSaturated) {
    signals.push(signal({
      detectorId: "D12_MARKET_EXPECTATION_SATURATION",
      period: last.periodEnd,
      severity: "WARNING",
      p_artifact: 0.05,
      label: "REVERSE_DCF_SATURATION",
      message: "Reverse-DCF hit model caps; market is pricing in perfection, not an accounting artifact.",
      affectedFields: ["marketExpectation.reverseDcfSaturated"],
      evidence: { reverseDcfSaturated: true },
      suggestedAdjusters: [],
    }));
  }
  return signals;
}

export const GREENFIELD_DETECTORS: readonly DetectorFn[] = [
  detectStandardAdoption,
  detectDirtySurplus,
  detectLeaseAccounting,
  detectFxOciTranslation,
  detectNegativeEquitySolvency,
  detectStructuralBreakDemerger,
  detectBuybackCapitalReturn,
  detectComponentReclassification,
  detectMetricStepChange,
  detectExpansionCapexFcf,
  detectFreshnessFrequency,
  detectMarketExpectationSaturation,
];

export function runAllDetectors(periods: readonly NormalizedPeriod[], context: GreenfieldRunContext = {}): AnomalySignal[] {
  const clonedPeriods = periods.map((period) => ({ ...period, values: { ...period.values }, derived: { ...period.derived } }));
  const signals = GREENFIELD_DETECTORS.flatMap((detector) => detector(clonedPeriods, context));
  return signals.sort((a, b) => a.period.localeCompare(b.period) || severityOrder[b.severity] - severityOrder[a.severity] || a.detectorId.localeCompare(b.detectorId));
}

export function detectorAggregateSeverity(signals: readonly AnomalySignal[]): SeverityLevel | "NONE" {
  return maxSeverity(signals.map((item) => item.severity));
}

export type { DetectorFn };
