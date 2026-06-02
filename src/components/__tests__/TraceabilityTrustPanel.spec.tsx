/* ================================================================
   Phase 3.5 — TraceabilityTrustPanel contract spec.

   The shared trust panel is rendered by all 9 envelope-consuming
   surfaces but had no direct spec. These cases lock its rendering
   contract: the four trust metrics always show, the caution block
   appears only with blockers, and the analyticalDepth line (schema
   v18) renders only when summary.depthLine is present.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TraceabilityTrustPanel, { type TraceabilitySurfaceSummary } from "../TraceabilityTrustPanel";

function mkSummary(over: Partial<TraceabilitySurfaceSummary> = {}): TraceabilitySurfaceSummary {
  return {
    headline: "Production-ready · High confidence",
    detail: "All currently wired rigor gates are cleared.",
    confidenceLine: "production-ready · 0 blocking / 1 diagnostic",
    parserLine: "confirmed · 100/100",
    reconciliationLine: "confirmed · max residual 0.00%",
    nextGateLine: "All currently wired rigor gates are cleared.",
    blockers: [],
    ...over,
  };
}

function render(summary: TraceabilitySurfaceSummary, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <TraceabilityTrustPanel
      title="Valuation Trust Gate"
      summary={summary}
      confidenceStatus="production-ready"
      rigorLabel="Production-ready"
      parserStatus="confirmed"
      reconciliationStatus="confirmed"
      cautionHeading="Why this should be trusted cautiously"
      {...extra}
    />,
  );
}

describe("TraceabilityTrustPanel", () => {
  it("always renders the four trust metrics", () => {
    const html = render(mkSummary());
    expect(html).toContain("Confidence");
    expect(html).toContain("Rigor level");
    expect(html).toContain("Parser fidelity");
    expect(html).toContain("Reconciliation");
    expect(html).toContain("confirmed · 100/100");
  });

  it("omits the caution block when there are no blockers", () => {
    const html = render(mkSummary({ blockers: [] }));
    expect(html).not.toContain("Why this should be trusted cautiously");
  });

  it("renders the caution block listing each blocker", () => {
    const html = render(mkSummary({ blockers: ["Reconciliation failed", "Parser degraded"] }));
    expect(html).toContain("Why this should be trusted cautiously");
    expect(html).toContain("Reconciliation failed");
    expect(html).toContain("Parser degraded");
  });

  it("renders the analytical-depth line only when depthLine is present", () => {
    const withDepth = render(mkSummary({ depthLine: "rich · 4/4 depth analytics" }));
    expect(withDepth).toContain("Analytical depth");
    expect(withDepth).toContain("rich · 4/4 depth analytics");

    const withoutDepth = render(mkSummary());
    expect(withoutDepth).not.toContain("Analytical depth");
  });

  it("renders the anti-tautology line only when antiTautologyLine is present", () => {
    const withAntiTautology = render(mkSummary({ antiTautologyLine: "confirmed · 3 independent intrinsic lenses · reverse DCF quarantined" }));
    expect(withAntiTautology).toContain("Anti-tautology evidence");
    expect(withAntiTautology).toContain("confirmed · 3 independent intrinsic lenses");

    const withoutAntiTautology = render(mkSummary());
    expect(withoutAntiTautology).not.toContain("Anti-tautology evidence");
  });
});
