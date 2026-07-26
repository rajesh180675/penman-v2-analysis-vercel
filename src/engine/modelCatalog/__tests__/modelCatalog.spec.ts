import { describe, expect, it } from "vitest";
import {
  CURRENT_MODEL_DEFINITIONS,
  CURRENT_MODEL_REGISTRY,
  ModelCatalogValidationError,
  ValuationModelRegistry,
  countFiniteComputedModels,
  countIndependentModelEvidenceGroups,
  evaluateModelApplicability,
  generateModelCatalog,
  groupIndependentModelEvidence,
  independenceGroupsForModelIds,
  validateModelCatalog,
  type ModelGuardResult,
  type ValuationModelDefinition,
  type ValuationModelResult,
} from "..";

function computed(
  modelId: string,
  perShare: number | null,
  overrides: Partial<Extract<ValuationModelResult, { status: "computed" }>> = {},
): Extract<ValuationModelResult, { status: "computed" }> {
  const definition = CURRENT_MODEL_REGISTRY.require(modelId);
  return {
    status: "computed",
    modelId,
    modelVersion: definition.modelVersion,
    caseId: "base",
    enterpriseValue: null,
    equityValue: null,
    perShare,
    unit: "INR_PER_SHARE",
    evidenceRefs: [],
    transformationRefs: [],
    diagnostics: {},
    guardResults: [],
    ...overrides,
  };
}

function skipped(modelId: string): ValuationModelResult {
  const definition = CURRENT_MODEL_REGISTRY.require(modelId);
  return {
    status: "skipped",
    modelId,
    modelVersion: definition.modelVersion,
    caseId: "base",
    reasonCode: "test-skip",
    missingRequirementIds: [],
  };
}

describe("ValuationModelRegistry validation", () => {
  const base = CURRENT_MODEL_REGISTRY.require("industrial.penman.residual-income");

  it("rejects duplicate model IDs", () => {
    expect(() => ValuationModelRegistry.create("duplicate-test", [base, { ...base }]))
      .toThrow(ModelCatalogValidationError);
    expect(validateModelCatalog([base, { ...base }]).map((entry) => entry.code))
      .toContain("duplicate-model-id");
  });

  it("rejects category values outside the runtime contract", () => {
    const invalid = { ...base, modelId: "test.invalid-category", category: "optionality" };
    expect(validateModelCatalog([invalid]).map((entry) => entry.code)).toContain("invalid-category");
    expect(() => ValuationModelRegistry.create("invalid-category-test", [invalid]))
      .toThrow(ModelCatalogValidationError);
  });

  it("rejects lifecycle values outside the runtime contract", () => {
    const invalid = { ...base, modelId: "test.invalid-lifecycle", lifecycle: "beta" };
    expect(validateModelCatalog([invalid]).map((entry) => entry.code)).toContain("invalid-lifecycle");
    expect(() => ValuationModelRegistry.create("invalid-lifecycle-test", [invalid]))
      .toThrow(ModelCatalogValidationError);
  });

  it("generates a deterministic honest catalog", () => {
    const first = generateModelCatalog(CURRENT_MODEL_REGISTRY);
    const second = generateModelCatalog(CURRENT_MODEL_REGISTRY);
    expect(first).toEqual(second);
    expect(first.summary.total).toBe(CURRENT_MODEL_DEFINITIONS.length);
    expect(first.entries.find((entry) => entry.modelId === "industrial.reverse-dcf")?.category)
      .toBe("market-implied");
    expect(first.entries.find((entry) => entry.modelId === "industrial.evidence-weighted-synthesis")?.category)
      .toBe("aggregator");
    expect(first.entries.find((entry) => entry.modelId === "advanced.real-options-rd-pipeline"))
      .toMatchObject({ lifecycle: "experimental", implementation: { integration: "wired" } });
    expect(first.entries.some((entry) => /telecom-native|utility-rab/.test(entry.modelId))).toBe(false);
  });

  it("derives applicability from family and explicit evidence, never a strategy stamp", () => {
    const definition = CURRENT_MODEL_REGISTRY.require("fi.bank.justified-pb-gordon");
    expect(evaluateModelApplicability(definition, {
      family: "industrial",
      requirementEvidence: [],
    })).toMatchObject({ status: "not-applicable", reasonCode: "family-not-applicable" });

    const missing = evaluateModelApplicability(definition, {
      family: "bank",
      requirementEvidence: [],
    });
    expect(missing).toMatchObject({ status: "insufficient-evidence", reasonCode: "missing-required-evidence" });

    const applicable = evaluateModelApplicability(definition, {
      family: "bank",
      requirementEvidence: definition.requirements.map((requirement) => ({
        requirementId: requirement.requirementId,
        status: "available" as const,
        observations: requirement.minimumObservations,
        evidenceRefs: [`evidence:${requirement.requirementId}`],
      })),
    });
    expect(applicable).toMatchObject({ status: "applicable", modelId: definition.modelId });
  });
});

describe("finite computed model evidence", () => {
  it("excludes reverse DCF and aggregators even when they contain finite values", () => {
    const results = [
      computed("industrial.reverse-dcf", 120),
      computed("industrial.reverse-dcf-monte-carlo", 121),
      computed("industrial.evidence-weighted-synthesis", 130),
    ];
    expect(countFiniteComputedModels(results, CURRENT_MODEL_REGISTRY)).toBe(0);
    expect(groupIndependentModelEvidence(results, CURRENT_MODEL_REGISTRY)).toEqual([]);
  });

  it("collapses correlated models to one declared independence group", () => {
    const results = [
      computed("industrial.penman.residual-income", 100),
      computed("industrial.penman.residual-operating-income", 104),
    ];
    expect(countFiniteComputedModels(results, CURRENT_MODEL_REGISTRY)).toBe(2);
    expect(countIndependentModelEvidenceGroups(results, CURRENT_MODEL_REGISTRY)).toBe(1);
    expect(groupIndependentModelEvidence(results, CURRENT_MODEL_REGISTRY)).toEqual([
      expect.objectContaining({
        independenceGroup: "accrual-residual-income",
        modelIds: [
          "industrial.penman.residual-income",
          "industrial.penman.residual-operating-income",
        ],
      }),
    ]);
  });

  it("counts only unique finite computed production intrinsic/relative definitions", () => {
    const blockingGuard: ModelGuardResult = {
      guardId: "terminal.discount-growth-spread",
      guardVersion: "1.0.0",
      status: "failed",
      blocksResult: true,
      observed: -0.01,
      threshold: 0.005,
      evidenceRefs: [],
      summary: "Invalid terminal spread.",
    };
    const results: ValuationModelResult[] = [
      computed("industrial.penman.residual-income", 100),
      computed("industrial.penman.residual-income", 110, { caseId: "bull" }),
      computed("industrial.penman.residual-operating-income", Number.POSITIVE_INFINITY),
      computed("industrial.cash-statement-fcff-dcf", Number.NaN),
      computed("industrial.ev-ebitda-peer", null, { equityValue: 500 }),
      computed("industrial.owner-earnings-dcf", 120, { guardResults: [blockingGuard] }),
      computed("industrial.reverse-dcf", 95),
      computed("industrial.scenario-headline", 105),
      computed("advanced.real-options-rd-pipeline", 30),
      skipped("industrial.graham-dodd-epv"),
    ];

    expect(countFiniteComputedModels(results, CURRENT_MODEL_REGISTRY)).toBe(2);
    expect(groupIndependentModelEvidence(results, CURRENT_MODEL_REGISTRY).map((group) => group.independenceGroup))
      .toEqual(["accrual-residual-income", "peer-market"]);
  });

  it("can include experimental definitions only when a caller opts in", () => {
    const results = [computed("advanced.real-options-rd-pipeline", 30)];
    expect(countFiniteComputedModels(results, CURRENT_MODEL_REGISTRY)).toBe(0);
    expect(countFiniteComputedModels(results, CURRENT_MODEL_REGISTRY, { productionOnly: false })).toBe(1);
  });
});

describe("independenceGroupsForModelIds", () => {
  it("collapses justified P/B and equity residual income into one group", () => {
    // The defect this function exists to fix. The audit harness kept its own
    // switch mapping PB -> "book-value" and ERI -> "residual-income", so a bank
    // valued only by those two reported TWO independent confirmations. Justified
    // P/B under Gordon growth is the closed form of the equity residual-income
    // model: same algebra, same inputs, one piece of evidence.
    const groups = independenceGroupsForModelIds(
      ["fi.bank.justified-pb-gordon", "fi.bank.equity-residual-income"],
      CURRENT_MODEL_REGISTRY,
    );

    expect(groups).toEqual(["fi-book-residual-income"]);
    expect(groups).toHaveLength(1);
  });

  it("also collapses the NBFC ROA x leverage residual-income variant", () => {
    expect(independenceGroupsForModelIds(
      [
        "fi.bank.justified-pb-gordon",
        "fi.bank.equity-residual-income",
        "fi.nbfc.roa-leverage-residual-income",
      ],
      CURRENT_MODEL_REGISTRY,
    )).toEqual(["fi-book-residual-income"]);
  });

  it("keeps genuinely independent bank lenses apart", () => {
    // Dividend discount and embedded value rest on different evidence than book
    // residual income, so a bank reaching all three has real triangulation.
    expect(independenceGroupsForModelIds(
      [
        "fi.bank.justified-pb-gordon",
        "fi.bank.equity-residual-income",
        "fi.bank.sustainable-ddm",
        "fi.insurance.embedded-value-vnb",
        "fi.nbfc.p-aum",
      ],
      CURRENT_MODEL_REGISTRY,
    )).toEqual([
      "actuarial-embedded-value",
      "fi-asset-market-multiple",
      "fi-book-residual-income",
      "fi-distribution",
    ]);
  });

  it("reports the industrial audit lenses as five distinct groups", () => {
    // The industrial fallback's five names were already one-to-one with distinct
    // groups, so moving it onto the registry changes the vocabulary, not the
    // count — the correctness fix here is FI-only.
    expect(independenceGroupsForModelIds(
      [
        "industrial.penman.residual-income",
        "industrial.segment-sotp",
        "industrial.graham-dodd-epv",
        "industrial.cash-statement-fcff-dcf",
        "industrial.ev-ebitda-peer",
      ],
      CURRENT_MODEL_REGISTRY,
    )).toEqual([
      "accrual-residual-income",
      "cash-statement",
      "earnings-power",
      "peer-market",
      "segment-sotp",
    ]);
  });

  it("returns nothing for no models", () => {
    expect(independenceGroupsForModelIds([], CURRENT_MODEL_REGISTRY)).toEqual([]);
  });

  it("throws on an unknown model id rather than silently dropping it", () => {
    // Silently skipping would quietly lower an independence count that gates
    // release claims, and callers map a closed set of names, so a miss is a bug.
    expect(() => independenceGroupsForModelIds(
      ["fi.bank.sustainable-ddm", "industrial.not-a-real-model"],
      CURRENT_MODEL_REGISTRY,
    )).toThrow(/industrial.not-a-real-model/);
  });
});

// Compile-time check: consumers can preserve a concrete input-contract ID in
// their own registry extensions without weakening the common registry type.
const _typedDefinition: ValuationModelDefinition<"custom-input-v1"> = {
  ...CURRENT_MODEL_REGISTRY.require("industrial.penman.residual-income"),
  modelId: "test.typed-definition",
  inputContract: "custom-input-v1",
};
void _typedDefinition;
