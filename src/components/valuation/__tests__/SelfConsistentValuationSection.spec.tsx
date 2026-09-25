import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RecastPeriod } from "../../../engine/types";
import { computeSelfConsistentValuation } from "../../../engine/selfConsistentValuation";
import SelfConsistentValuationSection from "../SelfConsistentValuationSection";

function period(periodEnd: string, NOA: number, NFO: number, CSE: number, CoreOI: number, NFE: number): RecastPeriod {
  return { period_end: periodEnd, bs: { NOA, NFO, CSE, MI: 0 }, is: { OI: CoreOI, NFE }, cu: { CoreOI } } as unknown as RecastPeriod;
}

describe("SelfConsistentValuationSection", () => {
  it("renders the value build, both kw figures and the market-implied persistence", () => {
    const history = Array.from({ length: 6 }, (_, i) => period(`${2020 + i}-03-31`, 1000, 300, 700, 200, 15));
    const unpriced = computeSelfConsistentValuation({ history, ke: 0.12, g: 0.04, kdFallback: 0.06, shares: 100 });
    if (unpriced.status !== "ok") throw new Error("expected a value");
    // Priced 10% above the model: reachable with somewhat more persistence.
    const result = computeSelfConsistentValuation({ history, ke: 0.12, g: 0.04, kdFallback: 0.06, shares: 100, marketPrice: unpriced.perShare! * 1.1 });
    const html = renderToStaticMarkup(<SelfConsistentValuationSection result={result} />);
    expect(html).toContain("Self-consistent ReOI fade valuation");
    expect(html).toContain("kw — value vs book weights");
    expect(html).toContain("Common equity value");
    expect(html).toContain("Anchored at <b>2025-03-31</b>");
    expect(html).toMatch(/market price requires the spread to persist/);
  });

  it("says so when no persistence reconciles the model to the price", () => {
    const history = Array.from({ length: 6 }, (_, i) => period(`${2020 + i}-03-31`, 1000, 300, 700, 200, 15));
    const result = computeSelfConsistentValuation({ history, ke: 0.12, g: 0.04, kdFallback: 0.06, shares: 100, marketPrice: 500 });
    const html = renderToStaticMarkup(<SelfConsistentValuationSection result={result} />);
    expect(html).toContain("No persistence up to ω = 0.98 reconciles this model to the market price");
  });

  it("says why it did not compute instead of rendering a number", () => {
    const html = renderToStaticMarkup(
      <SelfConsistentValuationSection result={{ status: "skipped", modelVersion: "2026-09-scv-v1", reason: "Net operating assets are not positive." }} />,
    );
    expect(html).toContain("Not computed: Net operating assets are not positive.");
  });
});
