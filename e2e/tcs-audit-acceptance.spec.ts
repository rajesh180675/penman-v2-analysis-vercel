import { expect, test } from "@playwright/test";

test.describe("TCS deep-link audit acceptance", () => {
  test("loads bundled TCS data, persists a bounded snapshot, and verifies its artifact", async ({ page }) => {
    test.setTimeout(240_000);
    const oversizedResponses: Array<{ url: string; status: number }> = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/audit/") && response.status() === 413) {
        oversizedResponses.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto("/?rf=7.00&erp=6.00&tab=upload&dark=0&company=TCS", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/TCS|Tata Consultancy Services/i, { timeout: 90_000 });
    await expect(page.getByRole("region", { name: "Immutable analysis run identity" })).toBeVisible({ timeout: 150_000 });

    const runsTab = page.getByRole("tab", { name: /Runs/ });
    await expect(runsTab).toBeEnabled({ timeout: 30_000 });
    await runsTab.click();
    await expect(page.getByText(/Integrity: verified/i)).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText(/Retention cleanup:/i)).toBeVisible();
    expect(oversizedResponses).toEqual([]);
  });
});
