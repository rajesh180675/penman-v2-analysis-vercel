import { describe, expect, it } from "vitest";
import { GOLDEN_COMPANY_CASES, runGoldenCompanyCase } from "../goldenCompanySuite";

function expectRatioInRange(value: number | null | undefined, range: [number, number], label: string) {
  expect(value, `${label} should be present`).not.toBeNull();
  expect(value!, `${label} should be >= ${range[0]}`).toBeGreaterThanOrEqual(range[0]);
  expect(value!, `${label} should be <= ${range[1]}`).toBeLessThanOrEqual(range[1]);
}

describe("golden company acceptance suite", () => {
  for (const testCase of GOLDEN_COMPANY_CASES) {
    it(`validates ${testCase.id}`, () => {
      const result = runGoldenCompanyCase(testCase);
      const latestFlags = result.latestPeriod.spec_flags?.map((flag) => flag.label) ?? [];

      expect(result.periods.length).toBeGreaterThanOrEqual(testCase.expectation.minPeriods);
      expect(result.qualityGate.tier).toBe(testCase.expectation.qualityGateTier);
      expect(result.qualityGate.valuationBlocked).toBe(testCase.expectation.valuationBlocked);
      expect(result.valuationReadiness.status).toBe(testCase.expectation.valuationStatus);
      if (testCase.expectation.persistenceStatus) {
        expect(result.valuationReadiness.persistenceStatus).toBe(testCase.expectation.persistenceStatus);
      }
      expect(result.policyVersions.engineVersion).toBeTruthy();
      expect(result.policyVersions.mappingPolicyVersion).toBeTruthy();
      expect(result.policyVersions.valuationPolicyVersion).toBeTruthy();
      expect(result.policyVersions.scopePolicyVersion).toBeTruthy();
      expect(result.qualityGate.scopeAssessment.blocked).toBe(false);

      for (const requiredFlag of testCase.expectation.requiredTerminalFlags ?? []) {
        expect(latestFlags).toContain(requiredFlag);
      }

      for (const forbiddenFlag of testCase.expectation.forbiddenTerminalFlags ?? []) {
        expect(latestFlags).not.toContain(forbiddenFlag);
      }

      const ranges = testCase.expectation.ratioRanges ?? {};
      if (ranges.ROCE) expectRatioInRange(result.latestPeriod.ratios?.ROCE, ranges.ROCE, `${testCase.id} ROCE`);
      if (ranges.RNOA) expectRatioInRange(result.latestPeriod.ratios?.RNOA, ranges.RNOA, `${testCase.id} RNOA`);
      if (ranges.NBC) expectRatioInRange(result.latestPeriod.ratios?.NBC, ranges.NBC, `${testCase.id} NBC`);
      if (ranges.FLEV) expectRatioInRange(result.latestPeriod.ratios?.FLEV, ranges.FLEV, `${testCase.id} FLEV`);
      if (ranges.cash_conversion_ratio) {
        expectRatioInRange(
          result.latestPeriod.ratios?.cash_conversion_ratio,
          ranges.cash_conversion_ratio,
          `${testCase.id} cash conversion ratio`,
        );
      }
    }, 60000);
  }
});
