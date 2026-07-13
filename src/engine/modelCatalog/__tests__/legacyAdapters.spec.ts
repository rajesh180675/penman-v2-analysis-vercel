import { describe, expect, it } from "vitest";
import type { ValuationCommandCenterOutput, ValuationScenarioCard } from "../../valuationCommandCenter";
import {
  adaptLegacyCommandCenterModelResults,
  countFiniteComputedModels,
  countIndependentModelEvidenceGroups,
  CURRENT_MODEL_REGISTRY,
} from "../index";

function scenario(): ValuationScenarioCard {
  return {
    key: "base",
    label: "Base",
    scenario: {} as ValuationScenarioCard["scenario"],
    intrinsicPerShare: 120,
    ownerEarningsDcfPerShare: 100,
    upsidePct: null,
    marginOfSafetyPct: null,
    expectedCagr: null,
    valuation: {
      V_RE_CV3: 1_100,
      V_ReOI_CV03: 1_000,
      EV_ReOI: 1_200,
      continuingValueGuards: [],
      perShare: {
        intrinsic_re_per_share: 110,
        intrinsic_reoi_per_share: 100,
        intrinsic_fcff_per_share: null,
        intrinsic_fcfe_per_share: null,
        intrinsic_ddm_per_share: null,
        intrinsic_aeg_per_share: null,
        implied_pb_re: null,
        implied_pe_re: null,
        margin_of_safety_re: null,
        implied_growth_rate: null,
      },
    } as unknown as ValuationScenarioCard["valuation"],
    assumptions: { ke: 0.12, kw: 0.1, g: 0.04, salesGrowthYear1: 0.08, corePmYear1: 0.15, reinvestmentRateYear1: 0.4, incrementalRoicYear1: 0.2 },
  };
}

function output(): ValuationCommandCenterOutput {
  return {
    scenarios: [scenario()],
    shareBasis: { shares: 10, sharesForPerShare: 10 },
    cashFlowDcf: { enterpriseValue: 1_300, equityValue: 1_200, perShare: 120 },
    epv: { epvOperations: 900, epvEquity: 800, epvPerShare: 80 },
    sotp: null,
    evEbitda: { evFromMedian: null, equityFromMedian: null },
    reverseDcf: { impliedOwnerEarningsGrowth: 0.2, impliedTerminalROIC: 0.15, impliedKE: 0.11 },
    evidenceWeightedSynthesis: { intrinsicRange: { lowPerShare: 90, midPerShare: 105, highPerShare: 120 } },
  } as unknown as ValuationCommandCenterOutput;
}

describe("legacy command-center model adapter", () => {
  it("emits explicit results without counting market-implied or aggregator outputs", () => {
    const results = adaptLegacyCommandCenterModelResults(output());
    expect(results.find((result) => result.modelId === "industrial.reverse-dcf")?.status).toBe("insufficient-evidence");
    expect(results.find((result) => result.modelId === "industrial.evidence-weighted-synthesis")?.status).toBe("computed");
    expect(countFiniteComputedModels(results, CURRENT_MODEL_REGISTRY)).toBeGreaterThan(0);
    const countedIds = results
      .filter((result) => result.status === "computed")
      .map((result) => result.modelId);
    expect(countedIds).toContain("industrial.evidence-weighted-synthesis");
    expect(CURRENT_MODEL_REGISTRY.get("industrial.evidence-weighted-synthesis")?.category).toBe("aggregator");
  });

  it("collapses correlated RE/ReOI evidence using catalog independence groups", () => {
    const results = adaptLegacyCommandCenterModelResults(output());
    const groups = countIndependentModelEvidenceGroups(results, CURRENT_MODEL_REGISTRY);
    const finiteModels = countFiniteComputedModels(results, CURRENT_MODEL_REGISTRY);
    expect(groups).toBeLessThan(finiteModels);
  });

  it("marks a failed terminal guard invalid instead of a computed zero", () => {
    const value = output();
    value.scenarios[0]!.valuation.V_RE_CV3 = null;
    value.scenarios[0]!.valuation.perShare!.intrinsic_re_per_share = null;
    value.scenarios[0]!.valuation.continuingValueGuards = [{
      model: "RE_CV3",
      basis: "equity",
      discountRate: 0.1,
      terminalGrowth: 0.1,
      spread: 0,
      reason: "Invalid spread",
    }];
    const result = adaptLegacyCommandCenterModelResults(value)
      .find((entry) => entry.modelId === "industrial.penman.residual-income");
    expect(result?.status).toBe("invalid");
  });
});
