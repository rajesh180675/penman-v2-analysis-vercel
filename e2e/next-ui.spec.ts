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
    await expect(page.getByRole("heading", { name: "What would change our mind" })).toBeVisible();
    // The backtest record is served to the browser and shown as counts.
    await expect(page.getByText(/beat .nothing changes. on sales in \d+ of \d+ years/)).toBeVisible();

    // Phase 2: Economics — select a number, the lineage drawer shows its source rows.
    await page.getByRole("link", { name: "Business & economics" }).click();
    await expect(page).toHaveURL(/#\/case\/TCS\/economics$/);
    await page.getByRole("button", { name: /^Sales, .* show where it comes from$/ }).last().click();
    const drawer = page.getByRole("complementary", { name: "Lineage" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Revenue From Operations(Net)")).toBeVisible();
    // Evidence: the rigor ladder from the run's trust envelope.
    await page.getByRole("link", { name: "Evidence & trust" }).click();
    await expect(page.getByRole("heading", { name: "Rigor ladder" })).toBeVisible();

    // Phase 3: Forecast — an edit re-values live.
    await page.getByRole("link", { name: "Forecast" }).click();
    await page.getByLabel(/Sales growth/).fill("2");
    await expect(page.getByText(/With your changes ₹/)).toBeVisible();
    // Valuation: every catalogued model, and the sensitivity grid.
    await page.getByRole("link", { name: "Valuation" }).click();
    await expect(page).toHaveURL(/#\/case\/TCS\/valuation$/);
    await expect(page.getByRole("heading", { name: "Models" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sensitivity" })).toBeVisible();
    // Phase 4: Peers offers the comparison; the Lab opens tools in the classic interface.
    await page.getByRole("link", { name: "Peers" }).click();
    await expect(page.getByRole("button", { name: /^Analyse \d+ peers?$/ })).toBeVisible();
    await page.goto("/?ui=next#/lab");
    await expect(page.getByRole("heading", { name: "Lab" })).toBeVisible();
    await expect(page.locator('a[href="/?ui=classic&tab=debug"]')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("leaves the current interface untouched without the flag", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Company Library/i })).toBeVisible({ timeout: 60_000 });
  });
});
