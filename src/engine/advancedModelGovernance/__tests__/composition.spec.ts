import { describe, expect, it } from "vitest";
import type { ValuationModelResult } from "../../modelCatalog";
import {
  applyRealOptionsCompositionCandidate,
  evaluateRealOptionsCompositionApproval,
  evaluateRealOptionsCompositionCandidate,
  executeGovernedAdvancedModel,
  type RealOptionsCompositionDossier,
} from "..";

const dossier: RealOptionsCompositionDossier = {
  modelId: "advanced.real-options-rd-pipeline", issuerId: "issuer-1", sidecarId: "options-1", effectiveAsOf: "2026-07-12",
  baseModelId: "industrial.penman.residual-income", baseCaseId: "base", baseExcludesOptionality: true,
  synthesisTargetModelKey: "accrual-riv-reoi", synthesisTargetIndependenceGroup: "accrual-history", substitutionMode: "replace-exact-base-vote-once",
  advancedInputHash: `sha256:${"f".repeat(64)}`,
  excludedProjectIds: ["drug-1"], maximumAdjustmentToBaseRatio: 0.5,
  evidenceRefs: ["artifact:composition"], transformationRefs: ["transform:composition"],
};

const reviews = [
  { reviewerPrincipalId: "reviewer-1", decision: "approved" as const, evidenceRef: "artifact:review-1", reviewedAt: "2026-07-12T01:00:00.000Z" },
  { reviewerPrincipalId: "reviewer-2", decision: "approved" as const, evidenceRef: "artifact:review-2", reviewedAt: "2026-07-12T02:00:00.000Z" },
];

function advancedResult() {
  return executeGovernedAdvancedModel({
    modelId: "advanced.real-options-rd-pipeline", issuerId: "issuer-1", asOf: "2026-07-12", sidecarId: "options-1", sidecarStatus: "approved",
    evidenceRefs: ["artifact:options"], transformationRefs: ["transform:options"], outputBridge: { sourceMonetaryUnit: "INR_CRORE", sharesOutstandingCr: 10, valueRole: "incremental-equity-adjustment" },
    input: { riskFreeRate: 0.07, projects: [{ id: "drug-1", stage: "phase-3", underlyingValue: 100, developmentCost: 80, timeToDecisionYears: 2, probabilityOfSuccess: 0.5, volatility: 0.4 }] },
  }, { schemaVersion: "2026-07-model-promotion-v1", modelId: "advanced.real-options-rd-pipeline", fromLifecycle: "experimental", eligibleLifecycle: "production", status: "eligible", checkResults: [], blockerCodes: [] });
}

const baseResult: ValuationModelResult = {
  modelId: dossier.baseModelId, modelVersion: "v1", caseId: "base", status: "computed",
  enterpriseValue: null, equityValue: 1_000, perShare: 100, unit: "INR_PER_SHARE",
  evidenceRefs: ["artifact:base"], transformationRefs: ["transform:base"], diagnostics: {}, guardResults: [],
};

describe("real-options composition governance", () => {
  it("requires independent approvals and treats any rejection as a veto", () => {
    const hash = `sha256:${"a".repeat(64)}`;
    expect(evaluateRealOptionsCompositionApproval(hash, dossier, reviews.slice(0, 1)).blockerCodes).toContain("DUAL_REVIEW_REQUIRED");
    expect(evaluateRealOptionsCompositionApproval(hash, dossier, [...reviews, { ...reviews[0]!, reviewerPrincipalId: "reviewer-3", decision: "rejected" as const }]).blockerCodes).toContain("REVIEW_REJECTED");
    expect(evaluateRealOptionsCompositionApproval(hash, dossier, reviews).status).toBe("approved");
    expect(evaluateRealOptionsCompositionApproval(hash, { ...dossier, synthesisTargetModelKey: "cash-fcff-dcf", synthesisTargetIndependenceGroup: "cash-statement" }, reviews).blockerCodes)
      .toContain("SYNTHESIS_TARGET_MODEL_BINDING_INVALID");
  });

  it("creates a bounded candidate while keeping synthesis disabled", () => {
    const approval = evaluateRealOptionsCompositionApproval(`sha256:${"a".repeat(64)}`, dossier, reviews);
    if (approval.status !== "approved") throw new Error("Expected approved composition policy.");
    const candidate = evaluateRealOptionsCompositionCandidate({ request: {
      modelId: "advanced.real-options-rd-pipeline", issuerId: "issuer-1", asOf: "2026-07-12", sidecarId: "options-1", sidecarStatus: "approved",
      evidenceRefs: ["artifact:options"], transformationRefs: ["transform:options"], outputBridge: { sourceMonetaryUnit: "INR_CRORE", sharesOutstandingCr: 10, valueRole: "incremental-equity-adjustment" },
      input: { riskFreeRate: 0.07, projects: [{ id: "drug-1", stage: "phase-3", underlyingValue: 100, developmentCost: 80, timeToDecisionYears: 2, probabilityOfSuccess: 0.5, volatility: 0.4 }] },
    }, result: advancedResult(), policy: approval.policy, baseResult });
    expect(candidate).toMatchObject({ status: "eligible-candidate", basePerShare: 100, eligibleForIntrinsicSynthesis: false });
    if (candidate.status === "eligible-candidate") expect(candidate.composedPerShare).toBeCloseTo(candidate.basePerShare + candidate.optionalityPerShare);
  });

  it("blocks project-set mismatches and excessive adjustments", () => {
    const approval = evaluateRealOptionsCompositionApproval(`sha256:${"a".repeat(64)}`, dossier, reviews);
    if (approval.status !== "approved") throw new Error("Expected approved composition policy.");
    const request = {
      modelId: "advanced.real-options-rd-pipeline" as const, issuerId: "issuer-1", asOf: "2026-07-12", sidecarId: "options-1", sidecarStatus: "approved" as const,
      evidenceRefs: ["artifact:options"], transformationRefs: ["transform:options"], outputBridge: { sourceMonetaryUnit: "INR_CRORE" as const, sharesOutstandingCr: 10, valueRole: "incremental-equity-adjustment" as const },
      input: { riskFreeRate: 0.07, projects: [{ id: "other-project", stage: "phase-3", underlyingValue: 100, developmentCost: 80, timeToDecisionYears: 2, probabilityOfSuccess: 0.5, volatility: 0.4 }] },
    };
    expect(evaluateRealOptionsCompositionCandidate({ request, result: advancedResult(), policy: approval.policy, baseResult })).toMatchObject({ status: "blocked", blockerCodes: ["PROJECT_EXCLUSION_MISMATCH"] });
    const lowLimit = evaluateRealOptionsCompositionApproval(`sha256:${"b".repeat(64)}`, { ...dossier, maximumAdjustmentToBaseRatio: 0.000001 }, reviews);
    if (lowLimit.status !== "approved") throw new Error("Expected approved low-limit policy.");
    expect(evaluateRealOptionsCompositionCandidate({ request: { ...request, input: { ...request.input, projects: [{ ...request.input.projects[0]!, id: "drug-1" }] } }, result: advancedResult(), policy: lowLimit.policy, baseResult })).toMatchObject({ status: "blocked", blockerCodes: ["ADJUSTMENT_LIMIT_EXCEEDED"] });
    const futureApproval = evaluateRealOptionsCompositionApproval(`sha256:${"c".repeat(64)}`, dossier, reviews.map((review) => ({ ...review, reviewedAt: "2026-07-13T01:00:00.000Z" })));
    if (futureApproval.status !== "approved") throw new Error("Expected structurally approved future policy.");
    expect(evaluateRealOptionsCompositionCandidate({ request: { ...request, input: { ...request.input, projects: [{ ...request.input.projects[0]!, id: "drug-1" }] } }, result: advancedResult(), policy: futureApproval.policy, baseResult })).toMatchObject({ status: "blocked", blockerCodes: ["POLICY_BINDING_MISMATCH"] });
  });

  it("replaces the exact base vote once and blocks duplicate application", () => {
    const approval = evaluateRealOptionsCompositionApproval(`sha256:${"a".repeat(64)}`, dossier, reviews);
    if (approval.status !== "approved") throw new Error("Expected approved composition policy.");
    const request = {
      modelId: "advanced.real-options-rd-pipeline" as const, issuerId: "issuer-1", asOf: "2026-07-12", sidecarId: "options-1", sidecarStatus: "approved" as const,
      evidenceRefs: ["artifact:options"], transformationRefs: ["transform:options"], outputBridge: { sourceMonetaryUnit: "INR_CRORE" as const, sharesOutstandingCr: 10, valueRole: "incremental-equity-adjustment" as const },
      input: { riskFreeRate: 0.07, projects: [{ id: "drug-1", stage: "phase-3", underlyingValue: 100, developmentCost: 80, timeToDecisionYears: 2, probabilityOfSuccess: 0.5, volatility: 0.4 }] },
    };
    const candidate = evaluateRealOptionsCompositionCandidate({ request, result: advancedResult(), policy: approval.policy, baseResult });
    const synthesis = {
      contributions: [{ modelKey: "accrual-riv-reoi", label: "Accrual", independenceGroup: "accrual-history" as const, perShare: 100, baseReliability: 0.6, evidenceCoveragePenalty: 0, forecastSkillPenalty: 0, priceDerivedPenalty: 0, finalWeight: 0.6, includedInIntrinsicRange: true, reason: "fixture" }],
      intrinsicRange: { lowPerShare: 100, midPerShare: 100, highPerShare: 100, rangeWideningPct: 0 },
      marketExpectationRange: { pricePerShare: null, requiredGrowth: null, requiredRnoa: null, saturated: false },
      defensibility: { status: "guarded" as const, checklist: [{ key: "paradigm-independence" as const, label: "Independent valuation lenses", passed: false, detail: "1 group" }], summary: "fixture" },
    };
    const activated = applyRealOptionsCompositionCandidate({ synthesis, policy: approval.policy, candidate });
    expect(activated).toMatchObject({ status: "applied", eligibleForIntrinsicSynthesis: true, synthesis: { contributions: [{ perShare: candidate.status === "eligible-candidate" ? candidate.composedPerShare : null }], compositionDiagnostics: { appliedCount: 1, countingPolicy: "replace-exact-base-vote-once" } } });
    if (activated.status !== "applied") throw new Error("Expected applied composition.");
    const duplicate = applyRealOptionsCompositionCandidate({ synthesis: activated.synthesis, policy: approval.policy, candidate });
    expect(duplicate.status).toBe("blocked");
    expect(duplicate.blockerCodes).toEqual(expect.arrayContaining(["SUBSTITUTION_TARGET_ALREADY_REPLACED", "SUBSTITUTION_DOSSIER_ALREADY_APPLIED"]));
  });
});
