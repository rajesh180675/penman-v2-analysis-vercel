/**
 * Fast pre-ingestion smoke checks.
 *
 * Scope is deliberately narrow: this spec covers only what nothing else does,
 * and only on the initial surface, so it stays a few seconds rather than the
 * three minutes full-pipeline.spec.ts needs.
 *
 * What was here before did not test the things it named. Three of its six tests
 * asserted nothing beyond `expect(page.locator("body")).toBeVisible()`, which
 * holds for any page that renders at all — including one whose bundle threw on
 * boot. Two of those three, dark mode and the command palette, wrapped every
 * real assertion in `if (await x.count() > 0)` against locators that match
 * nothing in this app: the palette renders no `role="dialog"`, and the toggle
 * carries `title="Toggle dark mode"` with an SVG icon rather than an
 * `aria-label` or emoji text. Those bodies never executed, so both features were
 * reported as covered while being entirely untested — and neither has coverage
 * anywhere else, which is why this spec was strengthened instead of deleted.
 * Both are now asserted unconditionally: a locator that stops matching fails
 * instead of silently skipping.
 *
 * Tab cycling and company deep-linking are not here: full-pipeline.spec.ts
 * cycles all 19 tabs and tcs-audit-acceptance.spec.ts drives a real deep-link
 * load end to end.
 */
import { test, expect, type Page } from "@playwright/test";

async function openInitialSurface(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // A named heading, not `body`: this fails if the bundle throws on boot.
  await expect(page.getByRole("heading", { name: /Company Library/i })).toBeVisible({ timeout: 60_000 });
  return errors;
}

test.describe("Pre-ingestion smoke", () => {
  test("boots to the company library without a page error", async ({ page }) => {
    const errors = await openInitialSurface(page);
    expect(errors).toEqual([]);
  });

  test("health endpoint responds", async ({ request }) => {
    const response = await request.get("/api/health", {
      headers: { "x-penman-local": "1" },
    });
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  test("dark mode toggle adds and removes the document class", async ({ page }) => {
    await openInitialSurface(page);
    // `dark` on <html> is what every dark: variant in the app keys off
    // (useConfigManager toggles it), so it is the assertion that means the
    // feature worked rather than merely that a click landed.
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);

    const toggle = page.getByTitle("Toggle dark mode");
    await toggle.click();
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);

    await toggle.click();
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  });

  test("dark mode can be deep-linked with ?dark=1", async ({ page }) => {
    await page.goto("/?dark=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Company Library/i })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  });

  test("command palette opens on Ctrl+K, filters, and closes on Escape", async ({ page }) => {
    await openInitialSurface(page);
    // The palette has no dialog role, so its search field is the handle.
    // Matched on placeholder rather than the searchbox role: the company
    // library has its own search input, and it only fails to match that role
    // today because it is type="text" — a coincidence this test should not
    // depend on.
    const search = page.getByPlaceholder(/Type to search/i);
    await expect(search).toHaveCount(0);

    await page.keyboard.press("Control+k");
    await expect(search).toBeVisible();

    await search.fill("data");
    await expect(page.getByRole("button", { name: /Go to Data/i })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);
  });
});
