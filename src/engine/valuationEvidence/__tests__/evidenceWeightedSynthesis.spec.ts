import { describe, expect, it } from "vitest";
import {
  buildEvidenceWeightedSynthesis,
  collapseEvidenceWeightedContributions,
  substituteEvidenceWeightedSynthesisContribution,
} from "../evidenceWeightedSynthesis";
import type { EvidenceWeightedModelContribution } from "../types";
import type { ValuationScenarioCard, ReverseDcfDiagnostics } from "../../valuationCommandCenter";
import type { CashFlowDcfResult } from "../../cashFlowDcf";
import type { ValuationEvidenceLedger, ForecastHoldoutSummary } from "../types";

function valuation(perShare: { re?: number | null; reoi?: number | null; fcff?: number | null; fcfe?: number | null }): ValuationScenarioCard["valuation"] {
  return {
    perShare: {
      intrinsic_re_per_share: perShare.re ?? null,
      intrinsic_reoi_per_share: perShare.reoi ?? null,
      intrinsic_fcff_per_share: perShare.fcff ?? null,
      intrinsic_fcfe_per_share: perShare.fcfe ?? null,
    },
  } as ValuationScenarioCard["valuation"];
}

function scenario(v: ValuationScenarioCard["valuation"]): ValuationScenarioCard {
  return {
    key: "base",
    label: "Base",
    intrinsicPerShare: 100,
    upsidePct: null,
    marginOfSafetyPct: null,
    expectedCagr: null,
    scenario: {} as ValuationScenarioCard["scenario"],
    valuation: v,
    assumptions: { ke: 0.11, kw: 0.09, g: 0.04, salesGrowthYear1: 0.1, corePmYear1: 0.08, reinvestmentRateYear1: 0.4, incrementalRoicYear1: 0.18 },
  };
}

const ledger: ValuationEvidenceLedger = {
  schemaVersion: "2026-06-valuation-evidence-v1",
  periodEnd: "2025-03-31",
  rows: [],
  summary: { total: 10, unsupportedCount: 0, priceDerivedCount: 3, confidenceEligibleCount: 7, highConfidenceCount: 5, sourceUnavailableCount: 0 },
};

const confirmedHoldout: ForecastHoldoutSummary = {
  available: true,
  folds: [],
  aggregate: { metricMape: {}, weightedMape: 0.04, status: "confirmed", confidencePenaltyPct: 0, valuationRangeWideningPct: 0.03 },
};

const failedHoldout: ForecastHoldoutSummary = {
  available: true,
  folds: [],
  aggregate: { metricMape: {}, weightedMape: 0.42, status: "failed", confidencePenaltyPct: 0.25, valuationRangeWideningPct: 0.30 },
};

const reverseDcf: ReverseDcfDiagnostics = {
  impliedOwnerEarningsGrowth: 0.4,
  impliedTerminalROIC: 0.8,
  impliedKE: 0.05,
  normalizedGrowthAnchor: 0.08,
  expectationLabel: "saturated",
  narrativeSpace: [],
  spreadVsNormalizedGrowth: 0.32,
  marketExpectationLabel: "saturated",
};

const cashFlowDcf: CashFlowDcfResult = {
  enterpriseValue: 12000,
  equityValue: 11000,
  perShare: 110,
  baseFcf: 600,
  kw: 0.09,
  terminalGrowth: 0.04,
  windowPeriods: 5,
};

describe("buildEvidenceWeightedSynthesis", () => {
  it("does not count Penman variants as independent corroboration and excludes reverse DCF from intrinsic range", () => {
    const result = buildEvidenceWeightedSynthesis({
      scenarios: [scenario(valuation({ re: 100, reoi: 104, fcff: 102, fcfe: 101 }))],
      cashFlowDcf,
      evEbitdaPerShare: 108,
      reverseDcf,
      evidenceLedger: ledger,
      forecastHoldout: confirmedHoldout,
      marketPrice: 4072,
    });

    const accrual = result.contributions.filter((c) => c.independenceGroup === "accrual-history");
    expect(accrual).toHaveLength(1);
    expect(result.contributions.find((c) => c.modelKey === "reverse-dcf")?.includedInIntrinsicRange).toBe(false);
    expect(result.contributions.find((c) => c.modelKey === "reverse-dcf")?.finalWeight).toBe(0);
    expect(result.defensibility.checklist.find((item) => item.key === "price-derived-isolation")?.passed).toBe(true);
    expect(result.intrinsicRange.midPerShare).not.toBeNull();
  });

  it("widens the range and downgrades defensibility when forecast holdout fails", () => {
    const result = buildEvidenceWeightedSynthesis({
      scenarios: [scenario(valuation({ re: 100, reoi: 104 }))],
      cashFlowDcf,
      evEbitdaPerShare: null,
      reverseDcf: null,
      evidenceLedger: ledger,
      forecastHoldout: failedHoldout,
      marketPrice: 150,
    });

    expect(result.intrinsicRange.rangeWideningPct).toBeGreaterThanOrEqual(0.30);
    expect(result.defensibility.status).not.toBe("confirmed");
    expect(result.defensibility.checklist.find((item) => item.key === "forecast-holdout-skill")?.passed).toBe(false);
  });

  it("caps confidence when only one intrinsic independence group is available", () => {
    const result = buildEvidenceWeightedSynthesis({
      scenarios: [scenario(valuation({ re: 100, reoi: 104 }))],
      cashFlowDcf: null,
      evEbitdaPerShare: null,
      reverseDcf: null,
      evidenceLedger: ledger,
      forecastHoldout: confirmedHoldout,
      marketPrice: 150,
    });

    expect(result.defensibility.status).toBe("guarded");
    expect(result.defensibility.checklist.find((item) => item.key === "paradigm-independence")?.passed).toBe(false);
    const cashContribution = result.contributions.find((item) => item.modelKey === "cash-fcff-dcf");
    expect(cashContribution?.perShare).toBeNull();
    expect(cashContribution?.includedInIntrinsicRange).toBe(false);
    expect(cashContribution?.finalWeight).toBe(0);
  });

  it("collapses correlated variants to one max-reliability family vote", () => {
    const item = (
      modelKey: string,
      independenceGroup: EvidenceWeightedModelContribution["independenceGroup"],
      perShare: number,
      finalWeight: number,
    ): EvidenceWeightedModelContribution => ({
      modelKey,
      label: modelKey,
      independenceGroup,
      perShare,
      baseReliability: finalWeight,
      evidenceCoveragePenalty: 0,
      forecastSkillPenalty: 0,
      priceDerivedPenalty: 0,
      finalWeight,
      includedInIntrinsicRange: true,
      reason: "fixture",
    });
    const collapsed = collapseEvidenceWeightedContributions([
      item("reoi-base", "accrual-history", 100, 0.8),
      item("reoi-stress", "accrual-history", 80, 0.6),
      item("reoi-bull", "accrual-history", 130, 0.7),
      item("cash-dcf", "cash-statement", 95, 0.65),
    ]);

    expect(collapsed).toHaveLength(2);
    const forecastFamily = collapsed.find((group) => group.independenceGroup === "accrual-history");
    expect(forecastFamily?.memberContributionCount).toBe(3);
    expect(forecastFamily?.groupWeight).toBe(0.8);
    expect(forecastFamily?.modelKeys).toEqual(["reoi-base", "reoi-bull", "reoi-stress"]);
  });

  it("fails closed when an exact-base substitution is ambiguous or value-mismatched", () => {
    const synthesis = buildEvidenceWeightedSynthesis({
      scenarios: [scenario(valuation({ re: 100, reoi: 104 }))], cashFlowDcf, evEbitdaPerShare: 108,
      reverseDcf: null, evidenceLedger: ledger, forecastHoldout: confirmedHoldout, marketPrice: 150,
    });
    const substitution = {
      targetModelKey: "cash-fcff-dcf", targetIndependenceGroup: "cash-statement" as const,
      dossierHash: `sha256:${"a".repeat(64)}` as const, baseModelId: "industrial.cash-statement-fcff-dcf", baseCaseId: "base",
      basePerShare: 111, optionalityPerShare: 5, composedPerShare: 116,
      evidenceRefs: ["artifact:base", "artifact:review"], transformationRefs: ["transform:base", "transform:options"],
    };
    expect(substituteEvidenceWeightedSynthesisContribution({ synthesis, ...substitution })).toMatchObject({ status: "blocked", blockerCodes: ["SUBSTITUTION_BASE_VALUE_MISMATCH"] });
    const cash = synthesis.contributions.find((item) => item.modelKey === "cash-fcff-dcf")!;
    expect(substituteEvidenceWeightedSynthesisContribution({
      synthesis: { ...synthesis, contributions: [...synthesis.contributions, { ...cash }] },
      ...substitution, basePerShare: 110, composedPerShare: 115,
    })).toMatchObject({ status: "blocked", blockerCodes: expect.arrayContaining(["SUBSTITUTION_TARGET_AMBIGUOUS"]) });
  });
});
