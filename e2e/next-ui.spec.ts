/**
 * The next UI (?ui=next, docs/ui-revamp-plan.md) end to end: Library → Case,
 * with the company's analysis run completing in the real worker. Unit tests
 * cover the pieces; only a browser proves the worker, the lazy chunk and the
 * hash routing work together.
 */
import { test, expect } from "@playwright/test";

test.describe("Next UI (?ui=next)", () => {
  test("opens a company's Case from the Library and completes its analysis run", async ({ page }) => {
    // Parsing and the worker run take tens of seconds on a CI runner.
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/?ui=next", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/^\d+ companies$/)).toBeVisible();

    await page.locator('a[href="#/case/TCS/verdict"]').click();
    await expect(page).toHaveURL(/#\/case\/TCS\/verdict$/);
    await expect(page.getByRole("heading", { name: /TCS/ })).toBeVisible();
    // The run settles in the worker: the header then carries the rigor level.
    await expect(page.getByText(/Rigor: /)).toBeVisible({ timeout: 120_000 });
    // Phase 1: the Verdict renders from the run's command center.
    await expect(page.getByRole("region", { name: "Verdict" })).toBeVisible();
    await expect(page.getByText("Base value")).toBeVisible();

    await page.getByRole("link", { name: "Valuation" }).click();
    await expect(page).toHaveURL(/#\/case\/TCS\/valuation$/);
    await expect(page.getByText("Valuation arrives in Phase 3")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("leaves the current interface untouched without the flag", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Company Library/i })).toBeVisible({ timeout: 60_000 });
  });
});
