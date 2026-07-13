import { describe, expect, it } from "vitest";
import { buildScenarioGovernanceReport } from "../scenarioGovernance";

function forecast(caseId: string, probability: number | null, probabilityStatus: "calibrated" | "not-assigned" = "not-assigned") {
  return {
    status: "computed" as const,
    forecastCase: { caseId, probability, probabilityStatus, assumptionIds: ["ke", "growth"] },
  } as never;
}

function input(probabilityStatus: "calibrated" | "not-assigned") {
  return {
    forecastResults: [
      forecast("stress", probabilityStatus === "calibrated" ? 0.25 : null, probabilityStatus),
      forecast("base", probabilityStatus === "calibrated" ? 0.5 : null, probabilityStatus),
      forecast("bull", probabilityStatus === "calibrated" ? 0.25 : null, probabilityStatus),
    ],
    scenarioOrdering: { status: "passed", checks: [], summary: "ordered" } as const,
    assumptions: {
      status: "confirmed",
      assumptions: [{ assumptionId: "ke" }, { assumptionId: "growth" }],
      intrinsicEligibleAssumptionIds: ["ke", "growth"],
    } as never,
    commandCenter: {
      scenarios: [
        { key: "stress", intrinsicPerShare: 80 },
        { key: "base", intrinsicPerShare: 110 },
        { key: "bull", intrinsicPerShare: 150 },
      ],
      evidenceWeightedSynthesis: { defensibility: { status: "confirmed" } },
    } as never,
  };
}

describe("scenario governance", () => {
  it("allows an evidenced range but withholds an uncalibrated point estimate", () => {
    const report = buildScenarioGovernanceReport(input("not-assigned"));
    expect(report.status).toBe("guarded");
    expect(report.rangeEligible).toBe(true);
    expect(report.pointEstimateEligible).toBe(false);
    expect(report.uncertaintyRange).toEqual(expect.objectContaining({ lowPerShare: 80, basePerShare: 110, highPerShare: 150 }));
    expect(report.warningCodes).toContain("PROBABILITIES_NOT_CALIBRATED");
    expect(report.assumptionProvenance.coverageRatio).toBe(1);
  });

  it("permits a point estimate only for calibrated probabilities summing to one", () => {
    const report = buildScenarioGovernanceReport(input("calibrated"));
    expect(report.status).toBe("confirmed");
    expect(report.pointEstimateEligible).toBe(true);
    expect(report.probabilitySum).toBe(1);
  });

  it("fails closed when a referenced assumption lacks intrinsic evidence", () => {
    const candidate = input("calibrated");
    candidate.assumptions = {
      status: "confirmed",
      assumptions: [{ assumptionId: "ke" }, { assumptionId: "growth" }],
      intrinsicEligibleAssumptionIds: ["ke"],
    } as never;
    const report = buildScenarioGovernanceReport(candidate);
    expect(report.status).toBe("blocked");
    expect(report.blockerCodes).toContain("ASSUMPTION_PROVENANCE_INELIGIBLE");
    expect(report.assumptionProvenance.ineligibleAssumptionIds).toEqual(["growth"]);
  });
});
