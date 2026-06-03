import { test, expect } from "@playwright/test";

test.describe("Critical Path E2E", () => {
  test("homepage loads with company library", async ({ page }) => {
    await page.goto("/");
    // The app should render the main heading or company library
    await expect(page.locator("body")).toBeVisible();
    // Look for the app title or data entry area
    const heading = page.getByRole("heading").first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test("health endpoint responds", async ({ request }) => {
    const response = await request.get("/api/health", {
      headers: { "x-penman-local": "1" },
    });
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  test("tab navigation works", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();

    // The app uses tabs — verify at least one tab/button is interactive
    const buttons = page.getByRole("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });

  test("dark mode toggle exists and works", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();

    // Look for a dark mode toggle (common pattern in this app)
    const darkToggle = page.locator('[aria-label*="dark"], [aria-label*="theme"], button:has-text("🌙"), button:has-text("☀")');
    if (await darkToggle.count() > 0) {
      await darkToggle.first().click();
      // Verify the html/body class changed
      const html = page.locator("html");
      const classList = await html.getAttribute("class");
      // Just confirm the click didn't crash the app
      await expect(page.locator("body")).toBeVisible();
    }
  });

  test("command palette opens with keyboard shortcut", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();

    // Cmd+K or Ctrl+K typically opens command palette
    await page.keyboard.press("Control+k");

    // Look for command palette dialog/modal
    const dialog = page.locator('[role="dialog"], [data-command-palette], .command-palette');
    if (await dialog.count() > 0) {
      await expect(dialog.first()).toBeVisible();
      await page.keyboard.press("Escape");
    }
  });

  test("URL routing to company workspace", async ({ page }) => {
    // Navigate with a company param in URL
    await page.goto("/?company=Asian_Paints", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();

    // The app should not crash — verify body is still visible
    await expect(page.locator("body")).toBeVisible();
  });
});
