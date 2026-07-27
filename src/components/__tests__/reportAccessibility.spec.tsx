/** @vitest-environment jsdom (axe-core needs a real DOM) */
/* ================================================================
   P7 — accessibility checks on the real report surfaces.

   This is the follow-up `src/__tests__/a11y.smoke.spec.ts` (Plan 7 PR-7.1)
   explicitly deferred: that harness proved the axe + jsdom wiring works by
   asserting on hand-written good and bad HTML fragments, and its header says
   "subsequent PRs will sweep the real app surfaces". Nothing had swept them.
   This file does, against components rendered from a real Capitaline fixture
   through the real pipeline.

   THE VACUITY PROBLEM, AND WHY THE SELF-CHECK EXISTS
   An axe assertion is uniquely easy to fake. `axe.run` on an empty body
   returns zero violations, and so does `axe.run` on a component that threw
   during render and produced nothing. Either way the test passes and the suite
   reports accessibility coverage it does not have.

   Two guards against that:
   1. A negative control routed through this file's own `violationsFor`
      helper. The PR-7.1 smoke spec already proves axe works under jsdom in
      general, but it does not exercise the rule configuration below — a typo
      in `DISABLED_RULES` that silenced everything would leave the surface
      tests passing on nothing while that spec stayed green.
   2. Every surface asserts a minimum rendered HTML length. A surface that
      collapses to an empty div fails on the length assertion rather than
      passing an accessibility check it never performed.

   SCOPE
   Three surfaces whose props are a plain `RecastPeriod[]`, driven by the real
   VST fixture through the real pipeline. Deliberately not covered yet:
   ValuationReport / ForecastReport / ComparisonReport need a command center,
   a registry and market data to render meaningfully, and a surface rendered
   with hollow props would report accessibility of an empty state. Those are
   worth adding, as their own change, with fixtures that actually populate them.

   These checks are colour-blind by construction: `color-contrast` needs real
   layout and jsdom has none, so axe skips it. Contrast has to come from a
   browser-based run (Playwright + @axe-core/playwright), which is why this
   file is a floor, not a WCAG sign-off. Full conformance also requires manual
   testing with assistive technology and expert review.
================================================================ */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import axe from "axe-core";
import RecastStatements from "../RecastStatements";
import RatioReport from "../RatioReport";
import QualityReport from "../QualityReport";
import { processCompanyData } from "../../engine/pipeline";
import { DEFAULT_CONFIG, type RecastPeriod } from "../../engine/types";
import { vstRealCompanySample } from "../../engine/goldenCompanySuite/fixtures";

/**
 * Rules that cannot be evaluated without layout, or that only apply to a whole
 * document rather than the fragment a single report renders. Disabled with a
 * reason each, so the exclusion list stays auditable rather than becoming a
 * place to bury failures.
 */
const DISABLED_RULES = {
  // Needs computed colour and geometry; jsdom has neither.
  "color-contrast": { enabled: false },
  // These assert document-level structure (one <main>, <html lang>, a
  // <title>). A report component renders a fragment inside the app shell and
  // is not responsible for them.
  "landmark-one-main": { enabled: false },
  "page-has-heading-one": { enabled: false },
  "html-has-lang": { enabled: false },
  "document-title": { enabled: false },
  region: { enabled: false },
} as const;

async function violationsFor(markup: string) {
  // Wrapped in <main> so region-scoped rules see a landmark, matching how the
  // app shell mounts these surfaces.
  document.body.innerHTML = `<main>${markup}</main>`;
  const results = await axe.run(document.body, {
    resultTypes: ["violations"],
    rules: DISABLED_RULES as unknown as axe.RuleObject,
  });
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodeCount: violation.nodes.length,
    // First offending selector: enough for a developer to find it without
    // dumping the whole node list into the failure output.
    firstTarget: String(violation.nodes[0]?.target?.[0] ?? "(unknown)"),
  }));
}

let cachedPeriods: RecastPeriod[] | null = null;
function periods(): RecastPeriod[] {
  cachedPeriods ??= processCompanyData(vstRealCompanySample, DEFAULT_CONFIG);
  return cachedPeriods;
}

describe("axe harness self-check", () => {
  it("detects violations in broken markup", async () => {
    // If this ever returns zero, axe is not really running and every
    // surface assertion below is meaningless.
    const found = await violationsFor(`
      <img src="x.png">
      <button></button>
      <input type="text">
      <div role="nonsense-role">bad role</div>
      <ul><div>not a list item</div></ul>
    `);

    const ids = found.map((violation) => violation.id);
    expect(ids).toContain("image-alt");
    expect(ids).toContain("button-name");
    expect(ids).toContain("label");
    expect(found.length).toBeGreaterThanOrEqual(4);
  }, 60_000);
});

describe("report surfaces have no axe violations", () => {
  it("the fixture recasts, so the surfaces below render real content", () => {
    expect(periods().length).toBeGreaterThan(1);
  });

  const SURFACES: readonly (readonly [string, () => React.ReactElement, number])[] = [
    ["RecastStatements", () => <RecastStatements data={periods()} />, 20_000],
    ["RatioReport", () => <RatioReport data={periods()} config={DEFAULT_CONFIG} />, 20_000],
    ["QualityReport", () => <QualityReport data={periods()} />, 10_000],
  ];

  for (const [name, render, minHtmlLength] of SURFACES) {
    it(`${name} renders substantive markup with no violations`, async () => {
      const markup = renderToStaticMarkup(render());
      // Non-vacuity: a surface that rendered nothing would otherwise pass the
      // axe assertion by having nothing to check.
      expect(markup.length).toBeGreaterThan(minHtmlLength);

      const found = await violationsFor(markup);
      // toEqual([]) rather than a length check: on failure the diff names the
      // rule, the impact and the offending selector.
      expect(found).toEqual([]);
    }, 60_000);
  }
});
