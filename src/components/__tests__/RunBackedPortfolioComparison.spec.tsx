import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPortfolioRunComparison } from "../../engine/portfolioRunComparison";
import RunBackedPortfolioComparison from "../RunBackedPortfolioComparison";

describe("immutable-run portfolio comparison surface", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it("shows exclusion reasons and constrained target weights", async () => {
    const base = { family: "industrial", reproducibilityHash: "sha256:abc", runSchemaVersion: "run-v1", policyBundleHash: "policy-1", asOf: "2026-03-31", status: "completed" as const, confidence: "production-ready", rangeEligible: true, lowPerShare: 80, midPerShare: 100, highPerShare: 120, opportunityScore: 70, qualityScore: 80, expectedCagrStress: 0.12 };
    const comparison = buildPortfolioRunComparison([
      { ...base, issuerId: "A", label: "Issuer A", runId: "run-a" },
      { ...base, issuerId: "B", label: "Issuer B", runId: "run-b", policyBundleHash: "policy-other" },
    ], { maximumAsOfSkewDays: 90, requireSameRunSchema: true, requireSamePolicyBundle: true, maximumIssuerWeight: 0.25, maximumFamilyWeight: 0.5 });
    await act(async () => root.render(<RunBackedPortfolioComparison comparison={comparison} />));
    expect(container.textContent).toContain("Issuer A");
    expect(container.textContent).toContain("POLICY_BUNDLE_MISMATCH");
    expect(container.textContent).toContain("Residual cash / unallocated weight: 100.0%");
  });
});
