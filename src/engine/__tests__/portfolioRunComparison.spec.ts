import { describe, expect, it } from "vitest";
import { buildPortfolioRunComparison, type PortfolioRunCandidate } from "../portfolioRunComparison";

function candidate(issuerId: string, overrides: Partial<PortfolioRunCandidate> = {}): PortfolioRunCandidate {
  return {
    issuerId, label: issuerId, family: "industrial", runId: `run-${issuerId}`, reproducibilityHash: `sha256:${issuerId}`,
    runSchemaVersion: "run-v1", policyBundleHash: "policy-1", asOf: "2026-03-31", status: "completed",
    confidence: "production-ready", rangeEligible: true, lowPerShare: 80, midPerShare: 100, highPerShare: 120,
    opportunityScore: 70, qualityScore: 80, expectedCagrStress: 0.12, ...overrides,
  };
}

describe("run-backed portfolio comparison", () => {
  const policy = { maximumAsOfSkewDays: 90, requireSameRunSchema: true, requireSamePolicyBundle: true, maximumIssuerWeight: 0.35, maximumFamilyWeight: 0.6 };

  it("excludes incomparable or blocked runs and penalizes wide uncertainty", () => {
    const result = buildPortfolioRunComparison([
      candidate("A"),
      candidate("B", { family: "bank", lowPerShare: 95, highPerShare: 105 }),
      candidate("C", { policyBundleHash: "policy-2" }),
    ], policy);
    expect(result.status).toBe("guarded");
    expect(result.rows.find((row) => row.issuerId === "C")?.exclusionCodes).toContain("POLICY_BUNDLE_MISMATCH");
    expect(result.rows.find((row) => row.issuerId === "B")!.score).toBeGreaterThan(result.rows.find((row) => row.issuerId === "A")!.score!);
  });

  it("enforces issuer and family allocation caps", () => {
    const result = buildPortfolioRunComparison([candidate("A"), candidate("B"), candidate("C", { family: "bank" })], policy);
    expect(result.rows.every((row) => row.targetWeight <= 0.35)).toBe(true);
    const industrialWeight = result.rows.filter((row) => row.family === "industrial").reduce((sum, row) => sum + row.targetWeight, 0);
    expect(industrialWeight).toBeLessThanOrEqual(0.6);
    expect(result.residualCashWeight).toBeCloseTo(1 - result.rows.reduce((sum, row) => sum + row.targetWeight, 0));
  });

  it("fails closed with zero allocations when fewer than two trusted runs are comparable", () => {
    const result = buildPortfolioRunComparison([candidate("A"), candidate("B", { confidence: "unknown" })], policy);
    expect(result.status).toBe("blocked");
    expect(result.rows.every((row) => row.targetWeight === 0)).toBe(true);
    expect(result.residualCashWeight).toBe(1);
    expect(result.rows.find((row) => row.issuerId === "B")?.exclusionCodes).toContain("TRUST_NOT_ELIGIBLE");
  });

  it("rejects non-finite, negative, and out-of-domain portfolio policy", () => {
    const result = buildPortfolioRunComparison([candidate("A"), candidate("B")], { ...policy, maximumIssuerWeight: Number.NaN, maximumFamilyWeight: -0.1 });
    expect(result.status).toBe("blocked");
    expect(result.rows.every((row) => row.exclusionCodes.includes("COMPARISON_POLICY_INVALID") && row.targetWeight === 0)).toBe(true);
  });
});
