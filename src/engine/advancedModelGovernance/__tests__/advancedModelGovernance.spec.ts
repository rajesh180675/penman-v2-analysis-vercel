import { describe, expect, it } from "vitest";
import { CURRENT_MODEL_REGISTRY } from "../../modelCatalog";
import { executeGovernedAdvancedModel } from "../execution";
import { evaluateModelPromotion } from "../promotion";

describe("advanced model production governance", () => {
  it("keeps existing experimental models blocked without real promotion evidence", () => {
    const definition = CURRENT_MODEL_REGISTRY.require("advanced.real-options-rd-pipeline");
    const decision = evaluateModelPromotion(definition, null);
    expect(decision.status).toBe("blocked");
    expect(decision.blockerCodes).toContain("REAL_ISSUER_GOLDEN");
  });

  it("executes approved evidence but excludes it from production synthesis until promotion", () => {
    const definition = CURRENT_MODEL_REGISTRY.require("advanced.esg-adjusted-ke");
    const promotion = evaluateModelPromotion(definition, null);
    const result = executeGovernedAdvancedModel({
      modelId: "advanced.esg-adjusted-ke", issuerId: "issuer-1", asOf: "2026-07-12",
      sidecarId: "esg-1", sidecarStatus: "approved", evidenceRefs: ["source:esg"], transformationRefs: ["transform:esg-ke"],
      input: { baseKe: 0.12, bucket: "BB" },
    }, promotion);
    expect(result).toMatchObject({ status: "computed", eligibleForProductionUse: false, eligibleForIntrinsicSynthesis: false });
  });

  it("requires two reviewers, full lineage, guards, and calibration for promotion", () => {
    const definition = CURRENT_MODEL_REGISTRY.require("advanced.real-options-rd-pipeline");
    const dossier = {
      modelId: definition.modelId, implementationIntegration: "wired", realIssuerGoldenCount: 2,
      factCoverageRatio: 0.9, guardCoverageRatio: 1, lineageCoverageRatio: 1,
      calibration: { status: "passed", asOf: "2026-06-30", sampleSize: 30, metric: 0.12 },
      reviewerPrincipalIds: ["reviewer-1", "reviewer-2"], evidenceRefs: ["artifact:promotion"],
    } as const;
    expect(definition).toMatchObject({ lifecycle: "experimental", implementation: { integration: "wired" } });
    const decision = evaluateModelPromotion(definition, dossier);
    expect(decision).toMatchObject({ status: "eligible", eligibleLifecycle: "production" });
    const mismatched = evaluateModelPromotion(definition, {
      modelId: "advanced.esg-adjusted-ke", implementationIntegration: "wired", realIssuerGoldenCount: 2,
      factCoverageRatio: 1, guardCoverageRatio: 1, lineageCoverageRatio: 1,
      calibration: { status: "passed", asOf: "2026-06-30", sampleSize: 30, metric: 0.1 },
      reviewerPrincipalIds: ["reviewer-1", "reviewer-2"], evidenceRefs: ["artifact:wrong-model"],
    });
    expect(mismatched.blockerCodes).toContain("DOSSIER_MODEL_MATCH");
  });

  it("turns invalid ESG inputs and unsafe overrides into blocked results", () => {
    const definition = CURRENT_MODEL_REGISTRY.require("advanced.esg-adjusted-ke");
    const promotion = evaluateModelPromotion(definition, null);
    const base = { modelId: "advanced.esg-adjusted-ke" as const, issuerId: "issuer-1", asOf: "2026-07-12", sidecarId: "esg-1", sidecarStatus: "approved" as const, evidenceRefs: ["source:esg"], transformationRefs: ["transform:esg-ke"] };
    expect(executeGovernedAdvancedModel({ ...base, input: { baseKe: 0.12 } }, promotion)).toMatchObject({ status: "blocked", reasonCodes: ["ESG_INPUT_INVALID"] });
    expect(executeGovernedAdvancedModel({ ...base, input: { baseKe: 0.12, bucket: "BBB", customBpsOverride: -5_000 } }, promotion)).toMatchObject({ status: "blocked", reasonCodes: ["ESG_INPUT_INVALID"] });
  });

  it("normalizes promoted real-option adjustments per share without treating them as standalone fair value", () => {
    const definition = CURRENT_MODEL_REGISTRY.require("advanced.real-options-rd-pipeline");
    const wiredDefinition = { ...definition, implementation: { ...definition.implementation, integration: "wired" as const } };
    const promotion = evaluateModelPromotion(wiredDefinition, {
      modelId: definition.modelId, implementationIntegration: "wired", realIssuerGoldenCount: 2,
      factCoverageRatio: 1, guardCoverageRatio: 1, lineageCoverageRatio: 1,
      calibration: { status: "passed", asOf: "2026-06-30", sampleSize: 30, metric: 0.1 },
      reviewerPrincipalIds: ["reviewer-1", "reviewer-2"], evidenceRefs: ["artifact:promotion"],
    });
    const base = {
      modelId: "advanced.real-options-rd-pipeline" as const, issuerId: "issuer-1", asOf: "2026-07-12",
      sidecarId: "options-1", sidecarStatus: "approved" as const, evidenceRefs: ["source:pipeline"], transformationRefs: ["transform:options"],
      input: { riskFreeRate: 0.07, projects: [{ id: "drug-1", stage: "phase-3", underlyingValue: 1_000, developmentCost: 400, timeToDecisionYears: 2, probabilityOfSuccess: 0.7, volatility: 0.5 }] },
    };
    expect(executeGovernedAdvancedModel(base, promotion)).toMatchObject({ status: "blocked", reasonCodes: ["OUTPUT_BRIDGE_REQUIRED"] });
    const result = executeGovernedAdvancedModel({ ...base, outputBridge: { sourceMonetaryUnit: "INR_CRORE", sharesOutstandingCr: 10, valueRole: "incremental-equity-adjustment" } }, promotion);
    expect(result).toMatchObject({ status: "computed", eligibleForProductionUse: true, eligibleForIntrinsicComposition: true, eligibleForIntrinsicSynthesis: false, valuationBridge: { sharesOutstandingCr: 10, role: "incremental-equity-adjustment" } });
    if (result.status !== "computed") throw new Error("Expected a computed real-options result.");
    expect(result.valuationBridge?.perShareAdjustment).toBeCloseTo((result.output as { totalExpectedValue: number }).totalExpectedValue / 10);
    expect(executeGovernedAdvancedModel({ ...base, outputBridge: { sourceMonetaryUnit: "INR_CRORE", sharesOutstandingCr: 0, valueRole: "incremental-equity-adjustment" } }, promotion))
      .toMatchObject({ status: "blocked", reasonCodes: ["OUTPUT_BRIDGE_INVALID"] });
  });
});
