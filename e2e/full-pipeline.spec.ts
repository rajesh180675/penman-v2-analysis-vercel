/**
 * Current full-pipeline E2E smoke.
 *
 * Exercises the real bundled Capitaline ZIP flow through the live UI, but uses
 * current app contracts instead of historical tab names that no longer exist.
 */
import { expect, test, type Page } from "@playwright/test";

test.setTimeout(180_000);

type CompanyTypeValue =
  | "bank"
  | "nbfc"
  | "insurance"
  | "industrial"
  | "it-services"
  | "consumer"
  | "utility"
  | "telecom"
  | "cyclical";

async function openApp(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Company Library/i })).toBeVisible({ timeout: 30_000 });
}

async function loadCompanyFromLibrary(
  page: Page,
  companyName: string,
  expectedType: CompanyTypeValue,
  marketBasis?: { price: number; sharesCrore: number },
) {
  await page.getByRole("tab", { name: /Data/ }).click();

  const companyButton = page.locator("button").filter({ hasText: companyName }).first();
  await expect(companyButton).toBeVisible({ timeout: 20_000 });
  await companyButton.click();

  const pipelineSelect = page.locator("select").filter({ hasText: /Auto \(detect from data\)/ }).first();
  await expect(pipelineSelect).toBeVisible({ timeout: 10_000 });
  await expect(pipelineSelect).toHaveValue(expectedType);

  if (marketBasis) {
    await page.locator('label:has-text("Market Price") + input').fill(String(marketBasis.price));
    await page.locator('label:has-text("Shares (Cr)") + input').fill(String(marketBasis.sharesCrore));
  }

  await page.getByRole("button", { name: /^Load$/ }).click();
  await expect(page.getByRole("tab", { name: /Dashboard/ })).toBeEnabled({ timeout: 75_000 });
}

async function switchTab(page: Page, tabName: string | RegExp) {
  const tab = page.getByRole("tab", { name: tabName });
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await expect(tab).toBeEnabled({ timeout: 10_000 });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });
}

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function readImmutableRunIdentity(page: Page) {
  const status = page.getByRole("region", { name: "Immutable analysis run identity" });
  await expect(status).toBeVisible({ timeout: 120_000 });
  const runId = await status.getAttribute("data-run-id");
  const hash = await status.getAttribute("data-reproducibility-hash");
  const windowHash = await status.getAttribute("data-analysis-window-hash");
  const marketHash = await status.getAttribute("data-market-snapshot-hash");
  expect(runId).toBeTruthy();
  expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(windowHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(marketHash === "" || /^sha256:[0-9a-f]{64}$/.test(marketHash ?? "")).toBe(true);
  return { runId, hash, windowHash, marketHash };
}

async function readStableImmutableRunIdentity(page: Page) {
  let identity = await readImmutableRunIdentity(page);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.waitForTimeout(2_000);
    const next = await readImmutableRunIdentity(page);
    if (next.runId === identity.runId) return next;
    identity = next;
  }
  return identity;
}

test.describe("Bundled company pipeline", () => {
  test("loads Asian Paints as a consumer company and shows industrial ratios", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openApp(page);
    await loadCompanyFromLibrary(page, "Asian Paints", "consumer");

    await expect(page.locator("body")).toContainText(/ASIANPAINT/i);
    await expect(page.locator("body")).toContainText(/consumer/i);

    await switchTab(page, /Ratios/);
    const main = page.locator("main").first();
    await expect(main).toContainText(/RNOA|Return on Net Operating|FLEV|Financial Leverage/i, { timeout: 15_000 });
    await expect(main).not.toContainText(/Financial Institution Analysis/i);
    expect(errors).toEqual([]);
  });

  test("loads HDFC Bank as a bank and shows financial-institution metrics", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openApp(page);
    await loadCompanyFromLibrary(page, "HDFC Bank", "bank");

    await switchTab(page, /Bank/);
    const main = page.locator("main").first();
    await expect(main).toContainText(/Financial Institution Analysis|NIM|ROA|ROE|CASA|Deposits/i, { timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  test("keeps one industrial run identity across valuation, forecast, and report", async ({ page }) => {
    await openApp(page);
    await loadCompanyFromLibrary(page, "Asian Paints", "consumer");
    const expected = await readStableImmutableRunIdentity(page);

    for (const tabName of [/Forecast/, /Valuation/, /Report/]) {
      await switchTab(page, tabName);
      expect(await readImmutableRunIdentity(page)).toEqual(expected);
    }

    await expect(page.locator("main").first()).toContainText(expected.hash!, { timeout: 30_000 });
  });

  test("uses crore shares directly for FI market cap and preserves the run hash", async ({ page }) => {
    await openApp(page);
    await loadCompanyFromLibrary(page, "HDFC Bank", "bank", { price: 2_000, sharesCrore: 760 });
    const expected = await readStableImmutableRunIdentity(page);

    await switchTab(page, /Bank/);
    const marketBasis = page.getByTestId("fi-market-basis");
    await expect(marketBasis).toBeVisible({ timeout: 30_000 });
    const price = Number(await marketBasis.getAttribute("data-market-price"));
    const marketCapCr = Number(await marketBasis.getAttribute("data-market-cap-cr"));
    expect(Number.isFinite(price) && price > 0).toBe(true);
    expect(Number.isFinite(marketCapCr) && marketCapCr > 0).toBe(true);
    expect(marketCapCr).toBe(1_520_000);
    // HDFC has hundreds of crore shares. The former extra /1e7 conversion
    // made market cap smaller than one share price; this invariant kills it.
    expect(marketCapCr / price).toBeGreaterThan(10);
    expect(await readImmutableRunIdentity(page)).toEqual(expected);
  });

  test("loads DMART as consumer retail without turning lease accounting into distress", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openApp(page);
    await loadCompanyFromLibrary(page, "Avenue Supermarts", "consumer");

    await switchTab(page, /Dashboard/);
    const main = page.locator("main").first();
    await expect(page.locator("body")).toContainText(/DMART|Avenue Supermarts/i);
    await expect(main).toContainText(/overvalu|margin of safety|MoS|valuation|price/i, { timeout: 15_000 });
    await expect(main).not.toContainText(/bankrupt|insolvency|financial distress/i);
    expect(errors).toEqual([]);
  });
});

test.describe("Navigation and URL state", () => {
  test("cycles the current top-level tabs without crashes", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openApp(page);
    await loadCompanyFromLibrary(page, "Asian Paints", "consumer");

    const tabNames = [
      /Data/,
      /Dashboard/,
      /Watchlist/,
      /Workspace/,
      /Runs/,
      /Statements/,
      /Ratios/,
      /Quality/,
      /Scope/,
      /Atlas/,
      /Business Model/,
      /Forecast/,
      /Valuation/,
      /Bank/,
      /Report/,
      /Thesis/,
      /Regression/,
      /V3 Analytics/,
      /Debug/,
    ];

    for (const tabName of tabNames) {
      await switchTab(page, tabName);
      await expect(page.locator("body")).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test("updates URL state when a loaded-analysis tab is selected", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openApp(page);
    await loadCompanyFromLibrary(page, "Dabur India", "consumer");

    await switchTab(page, /Ratios/);
    await expect(page).toHaveURL(/tab=ratios/);
    expect(errors).toEqual([]);
  });
});
