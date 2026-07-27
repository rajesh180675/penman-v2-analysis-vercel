/** @vitest-environment jsdom (mounts through react-dom/client) */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import RunBackedForecastReport from "../forecast/RunBackedForecastReport";

describe("run-backed forecast scenario governance", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows range eligibility while withholding an uncalibrated point estimate", async () => {
    await act(async () => root.render(
      <RunBackedForecastReport
        results={[]}
        analysisWindow={null}
        assumptions={null}
        ordering={null}
        traceability={null}
        traceabilitySummary={null}
        governance={{
          schemaVersion: "2026-07-scenario-governance-v1",
          status: "guarded",
          rangeEligible: true,
          pointEstimateEligible: false,
          scenarioCount: 3,
          computedScenarioCount: 3,
          calibratedProbabilityCount: 0,
          probabilitySum: null,
          uncertaintyRange: { lowPerShare: 80, basePerShare: 110, highPerShare: 150, method: "ordered-scenario-band" },
          assumptionProvenance: { referencedCount: 5, resolvedCount: 5, intrinsicEligibleCount: 5, missingAssumptionIds: [], ineligibleAssumptionIds: [], coverageRatio: 1 },
          blockerCodes: [],
          warningCodes: ["PROBABILITIES_NOT_CALIBRATED"],
          summary: "Scenario range is eligible, but the point estimate is withheld.",
        }}
      />,
    ));

    expect(container.querySelector('[data-testid="scenario-governance"]')?.textContent).toContain("Range eligible");
    expect(container.textContent).toContain("Point estimate withheld");
    expect(container.textContent).toContain("Assumption provenance: 100%");
  });
});
