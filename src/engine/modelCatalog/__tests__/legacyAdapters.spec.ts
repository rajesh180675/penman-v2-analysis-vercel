import { describe, expect, it } from "vitest";
import type { ValuationCommandCenterOutput, ValuationScenarioCard } from "../../valuationCommandCenter";
import {
  adaptLegacyCommandCenterModelResults,
  adaptValuationStageModelResults,
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
    valueAtPriceDate: 120,
    dividendsPerShare: [],
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

  it("reads each result from the stage that computed it", () => {
    const center = output();
    const results = adaptValuationStageModelResults({
      shareBasis: center.shareBasis,
      models: {
        scenarios: center.scenarios,
        cashFlowDcf: { enterpriseValue: 2_300, equityValue: 2_200, perShare: 220 },
        epv: center.epv,
        sotpResult: { totalEnterpriseValue: 5_000 },
        evEbitda: { evFromMedian: 1_500, equityFromMedian: 1_400 },
        reverseDcf: center.reverseDcf,
      },
      synthesis: { evidenceWeightedSynthesis: { intrinsicRange: { lowPerShare: 190, midPerShare: 205, highPerShare: 220 } } },
    } as unknown as Parameters<typeof adaptValuationStageModelResults>[0]);
    const byId = (modelId: string) => results.find((result) => result.modelId === modelId);
    expect(byId("industrial.cash-statement-fcff-dcf")).toMatchObject({ status: "computed", perShare: 220, equityValue: 2_200 });
    expect(byId("industrial.segment-sotp")).toMatchObject({ status: "computed", enterpriseValue: 5_000 });
    // The peer value is spread over the share basis it is handed: 1,400 / 10.
    expect(byId("industrial.ev-ebitda-peer")).toMatchObject({ status: "computed", perShare: 140 });
    expect(byId("industrial.evidence-weighted-synthesis")).toMatchObject({ status: "computed", perShare: 205, diagnostics: { lowPerShare: 190, highPerShare: 220 } });
    // The command-center adapter is this one, over the read model's copies.
    expect(adaptLegacyCommandCenterModelResults(center)).toEqual(adaptValuationStageModelResults({
      shareBasis: center.shareBasis,
      models: { scenarios: center.scenarios, cashFlowDcf: center.cashFlowDcf, epv: center.epv, sotpResult: center.sotp, evEbitda: center.evEbitda, reverseDcf: center.reverseDcf },
      synthesis: { evidenceWeightedSynthesis: center.evidenceWeightedSynthesis },
    } as unknown as Parameters<typeof adaptValuationStageModelResults>[0]));
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
