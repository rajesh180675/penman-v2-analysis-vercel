/* ================================================================
   P7 — browser-based accessibility gate.

   WHY A BROWSER RUN WHEN TWO JSDOM HARNESSES ALREADY EXIST
   `src/__tests__/a11y.smoke.spec.ts` and
   `src/components/__tests__/reportAccessibility.spec.tsx` both disable
   `color-contrast` with the same reason: jsdom has no layout or canvas, so axe
   cannot compute it. The second one names Playwright + axe as the follow-up
   that would own contrast. This file is that follow-up, so `color-contrast` is
   ENABLED here. Disabling it would leave this spec asserting only what the
   jsdom harnesses already assert, at e2e cost.

   Document-level rules (`page-has-heading-one`, `landmark-one-main`, `region`,
   `html-has-lang`, `document-title`) are also enabled. The jsdom specs disable
   them because a report component renders a fragment and is not responsible for
   document structure — here we load the real document, so it is.

   THE VACUITY PROBLEM
   `axe.run` returns zero violations on an empty body, and equally on a page
   that failed to load. Either way the assertion passes and the suite reports
   accessibility coverage it does not have. Two guards, mirroring
   reportAccessibility.spec.tsx:
     1. A negative control routed through this file's own `runAxe` helper, so a
        mistake in the options below cannot silence everything while staying
        green.
     2. A minimum rendered-content assertion before each sweep.

   SCOPE
   The initial app surface (Company Library + upload panel), which is what a
   first-time visitor and a keyboard user meet first. Loaded-analysis surfaces
   (Dashboard, Valuation, Report) render only after a ~75s company load and are
   worth their own pass with their own fixes; asserting them here would either
   balloon this spec's runtime or bury a disable list. Not a WCAG sign-off:
   full conformance needs manual testing with assistive technology and expert
   review.
================================================================ */
import { test, expect, type Page } from "@playwright/test";

/** The compact shape this spec asserts on. */
interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodeCount: number;
  targets: string[];
}

/**
 * The subset of axe's own violation shape this spec reads. Declared locally
 * because axe is injected into the page at runtime, so `window.axe` has no
 * ambient type inside the browser context.
 */
interface AxeRawViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { target?: unknown[] }[];
}

interface InjectedAxe {
  axe: { run: (root: Document, options: unknown) => Promise<{ violations: AxeRawViolation[] }> };
}

/**
 * Injects the axe-core browser bundle already vendored as a devDependency and
 * runs it over the whole document. Deliberately NOT `@axe-core/playwright`:
 * that package bundles its own axe-core, so the jsdom harnesses and this one
 * would drift onto different rule sets and disagree about the same markup.
 */
async function runAxe(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  return page.evaluate(async () => {
    const results = await (window as unknown as InjectedAxe).axe.run(document, {
      resultTypes: ["violations"],
      // Nothing disabled. See the header: contrast and document-structure rules
      // are the entire reason this spec runs in a browser.
    });
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      help: violation.help,
      nodeCount: violation.nodes.length,
      // First three selectors: enough to find the markup without dumping every
      // node into the failure output.
      targets: violation.nodes.slice(0, 3).map((node) => String(node.target?.[0] ?? "(unknown)")),
    }));
  });
}

async function openInitialSurface(page: Page): Promise<number> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Company Library/i })).toBeVisible({ timeout: 60_000 });
  return (await page.content()).length;
}

test.describe("browser accessibility gate", () => {
  test("the harness reports violations in broken markup", async ({ page }) => {
    // Negative control. If this finds nothing, the options in runAxe have
    // silenced axe and the sweep below is meaningless.
    await openInitialSurface(page);
    await page.evaluate(() => {
      const bad = document.createElement("div");
      bad.id = "a11y-negative-control";
      bad.innerHTML = `
        <img src="x.png">
        <button></button>
        <input type="text">
      `;
      document.body.appendChild(bad);
    });

    const found = await runAxe(page);
    const ids = found.map((violation) => violation.id);
    expect(ids).toContain("image-alt");
    expect(ids).toContain("button-name");
    expect(ids).toContain("label");
  });

  test("the initial surface has no violations, contrast included", async ({ page }) => {
    const markupLength = await openInitialSurface(page);
    // Non-vacuity: a page that failed to render would otherwise pass by having
    // nothing for axe to check. The real surface is ~800 KB of markup.
    expect(markupLength).toBeGreaterThan(100_000);

    const found = await runAxe(page);
    // toEqual([]) rather than a count check: the failure diff names the rule,
    // the impact and the offending selectors.
    expect(found).toEqual([]);
  });
});
