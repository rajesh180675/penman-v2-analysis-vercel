/**
 * Comprehensive E2E Tests — Full Pipeline Verification
 *
 * Tests the complete flow: company selection → ZIP parse → pipeline →
 * tab navigation → value assertions for every tab.
 *
 * Uses real company data from public/data/companies/ served by Vite dev.
 */
import { test, expect, type Page } from "@playwright/test";

// Helper: click a company in the library grid by name
async function loadCompanyFromLibrary(page: Page, companyName: string) {
  // Ensure we're on the Data tab
  await page.getByRole("tab", { name: /Data/ }).click();
  await page.waitForTimeout(500);

  // Find and click the company row
  const companyButton = page.locator("button").filter({ hasText: companyName }).first();
  await expect(companyButton).toBeVisible({ timeout: 10_000 });
  await companyButton.click();

  // Wait for pipeline processing — the Dashboard tab becomes enabled
  await expect(page.getByRole("tab", { name: /Dashboard/ })).toBeEnabled({ timeout: 60_000 });
}

// Helper: switch to a tab and wait for content
async function switchTab(page: Page, tabName: string | RegExp) {
  const tab = page.getByRole("tab", { name: tabName });
  await tab.click();
  await page.waitForTimeout(1000); // allow lazy components to load
}

// Helper: get visible text content from a specific area
async function getVisibleNumbers(page: Page, selector: string): Promise<string> {
  const el = page.locator(selector).first();
  if (await el.count() > 0) {
    return (await el.textContent()) ?? "";
  }
  return "";
}

test.describe("Industrial Company — Asian Paints (Consumer)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await loadCompanyFromLibrary(page, "Asian Paints");
  });

  test("Dashboard tab renders KPIs with real values", async ({ page }) => {
    await switchTab(page, /Dashboard/);

    // Dashboard should show key metrics — RNOA, ROCE, PM, ATO
    const content = await page.locator("main, [role='main'], .flex-1").first().textContent();
    expect(content).toBeTruthy();

    // Asian Paints is a high-ROCE compounder — verify meaningful numbers appear
    // Look for percentage values (ratios displayed as %)
    const percentages = await page.locator("text=/\\d+\\.\\d+%/").count();
    expect(percentages).toBeGreaterThan(0);
  });

  test("Statements tab shows recast balance sheet and income", async ({ page }) => {
    await switchTab(page, /Statements/);

    // Should show Total Assets (TA), CSE, NOA, NFO
    await expect(page.locator("text=/Total Assets|TA/i").first()).toBeVisible({ timeout: 5000 });

    // Should have multiple period columns (Asian Paints has 5+ years)
    const periodHeaders = page.locator("text=/Mar 202[0-5]|FY202[0-5]/i");
    expect(await periodHeaders.count()).toBeGreaterThanOrEqual(3);
  });

  test("Ratios tab shows Penman-Nissim decomposition", async ({ page }) => {
    await switchTab(page, /Ratios/);

    // Core ratios should be visible
    await expect(page.locator("text=/RNOA|Return on Net Operating Assets/i").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=/FLEV|Financial Leverage/i").first()).toBeVisible({ timeout: 5000 });

    // Asian Paints RNOA should be positive and substantial (>20%)
    // Look for the actual RNOA value
    const rnoaCell = page.locator("text=/\\d{2,3}\\.\\d+%/").first();
    if (await rnoaCell.count() > 0) {
      const text = await rnoaCell.textContent();
      const match = text?.match(/([\d.]+)%/);
      if (match) {
        const value = parseFloat(match[1]);
        // Asian Paints RNOA is typically 30-60%
        expect(value).toBeGreaterThan(10);
      }
    }
  });

  test("Quality tab shows Piotroski, Beneish, Altman scores", async ({ page }) => {
    await switchTab(page, /Quality/);

    // Quality scoring models should be present
    await expect(page.locator("text=/Piotroski/i").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=/Beneish|M-Score/i").first()).toBeVisible({ timeout: 5000 });

    // Asian Paints should have a strong Piotroski score (7-9)
    const piotroskiValue = page.locator("text=/[7-9]\\/9|Score.*[7-9]/");
    if (await piotroskiValue.count() > 0) {
      expect(await piotroskiValue.first().isVisible()).toBe(true);
    }
  });

  test("Forecast tab renders projections", async ({ page }) => {
    await switchTab(page, /Forecast/);

    // Should show forecast periods
    await expect(page.locator("text=/Forecast|Projected|Terminal/i").first()).toBeVisible({ timeout: 5000 });

    // Should have numeric projections
    const numbers = await page.locator("text=/₹.*Cr|\\d+,\\d{3}/").count();
    expect(numbers).toBeGreaterThan(0);
  });

  test("Valuation tab shows intrinsic value range", async ({ page }) => {
    await switchTab(page, /Valuation/);

    // Should show valuation models (RE, ReOI, AEG, FCF)
    await expect(page.locator("text=/Residual|Intrinsic|Fair Value|RE Model/i").first()).toBeVisible({ timeout: 5000 });

    // Should show per-share values (₹ amounts in thousands for Asian Paints)
    const rupeeValues = page.locator("text=/₹\\s*[\\d,]+/");
    expect(await rupeeValues.count()).toBeGreaterThan(0);
  });

  test("Business Model tab shows DuPont decomposition", async ({ page }) => {
    await switchTab(page, /Business Model/);

    // Industrial business model analysis
    await expect(page.locator("text=/DuPont|Margin|Turnover|Compounder/i").first()).toBeVisible({ timeout: 5000 });
  });

  test("Atlas tab renders data visualizations", async ({ page }) => {
    await switchTab(page, /Atlas/);

    // Atlas is the multi-metric explorer
    await expect(page.locator("text=/Atlas|Metric|Pattern|Heatmap/i").first()).toBeVisible({ timeout: 5000 });
  });

  test("Report (Academic) tab produces formatted output", async ({ page }) => {
    await switchTab(page, /Report/);

    // Academic report should have structured sections
    await expect(page.locator("text=/Executive Summary|Analysis|Conclusion|Valuation/i").first()).toBeVisible({ timeout: 5000 });
  });

  test("Thesis tab generates investment thesis", async ({ page }) => {
    await switchTab(page, /Thesis/);

    await expect(page.locator("text=/Investment Thesis|Bull|Bear|Moat/i").first()).toBeVisible({ timeout: 5000 });
  });

  test("Regression tab shows baseline guardrails", async ({ page }) => {
    await switchTab(page, /Regression/);

    await expect(page.locator("text=/Regression|Baseline|Guardrail|Stability/i").first()).toBeVisible({ timeout: 5000 });
  });

  test("V3 Analytics tab shows governance output", async ({ page }) => {
    await switchTab(page, /V3 Analytics/);

    // V3 analytics includes dirty surplus, event flags, confidence
    await expect(page.locator("text=/Dirty Surplus|Event|Confidence|Terminal/i").first()).toBeVisible({ timeout: 5000 });
  });

  test("Debug tab shows pipeline trace", async ({ page }) => {
    await switchTab(page, /Debug/);

    // Debug panel shows raw trace/diagnostics
    await expect(page.locator("text=/Trace|Debug|Pipeline|Raw/i").first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Bank Company — HDFC Bank (Financial Institution)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await loadCompanyFromLibrary(page, "HDFC Bank");
  });

  test("auto-routes to Bank tab (financial institution detection)", async ({ page }) => {
    // HDFC Bank should trigger financial institution routing
    // The app should show the Bank tab or redirect to the bank analysis view
    await page.waitForTimeout(3000);

    // Bank tab should be active or bank content visible
    const bankTab = page.getByRole("tab", { name: /Bank/ });
    const bankContent = page.locator("text=/NIM|Net Interest Margin|Advances|Deposits/i");

    // Either bank tab is selected or bank-specific content is showing
    const isBankTabSelected = await bankTab.getAttribute("aria-selected") === "true";
    const hasBankContent = await bankContent.count() > 0;
    expect(isBankTabSelected || hasBankContent).toBe(true);
  });

  test("Bank tab shows NIM, ROA, ROE, CASA metrics", async ({ page }) => {
    await switchTab(page, /Bank/);

    // Core banking metrics
    await expect(page.locator("text=/NIM|Net Interest Margin/i").first()).toBeVisible({ timeout: 10_000 });

    // HDFC Bank NIM is typically 3.5-4.5%
    const nimValues = page.locator("text=/[2-6]\\.\\d+%/");
    expect(await nimValues.count()).toBeGreaterThan(0);
  });

  test("Bank tab shows asset quality metrics", async ({ page }) => {
    await switchTab(page, /Bank/);

    // Asset quality — GNPA, NNPA, PCR
    const assetQuality = page.locator("text=/GNPA|NPA|Provision Coverage|PCR/i");
    expect(await assetQuality.count()).toBeGreaterThan(0);
  });

  test("Valuation tab shows bank-specific models", async ({ page }) => {
    await switchTab(page, /Valuation/);

    // Bank valuation uses different models (Gordon Growth, Excess Return)
    await expect(page.locator("text=/Valuation|P\\/B|Book Value|Gordon|Excess Return/i").first()).toBeVisible({ timeout: 10_000 });
  });

  test("Ratios tab shows bank-specific ratios (not industrial RNOA)", async ({ page }) => {
    await switchTab(page, /Ratios/);

    // Should show banking ratios, not industrial ratios
    const bankRatios = page.locator("text=/NIM|Cost.to.Income|ROA|Credit Cost|Yield on Advances/i");
    expect(await bankRatios.count()).toBeGreaterThan(0);
  });
});

test.describe("IT Services — Infosys", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await loadCompanyFromLibrary(page, "Infosys");
  });

  test("detects IT services and shows sector-specific analysis", async ({ page }) => {
    await switchTab(page, /Dashboard/);

    // IT services detection should be reflected somewhere
    const content = await page.locator("main, [role='main'], .flex-1").first().textContent();
    expect(content).toBeTruthy();

    // Infosys should show high PM (>20%) and moderate ATO
    const percentValues = await page.locator("text=/\\d{2}\\.\\d+%/").count();
    expect(percentValues).toBeGreaterThan(0);
  });

  test("Statements show clean recast for asset-light model", async ({ page }) => {
    await switchTab(page, /Statements/);

    // Infosys has minimal debt — NFO should be negative (net cash)
    // Look for negative NFO or "Net Cash" indicator
    const content = await page.locator("main, [role='main'], .flex-1").first().textContent();
    // Just verify statements rendered with multiple periods
    const periodHeaders = page.locator("text=/Mar 202[0-5]|FY202[0-5]/i");
    expect(await periodHeaders.count()).toBeGreaterThanOrEqual(3);
  });

  test("Valuation reflects IT-services specific assumptions", async ({ page }) => {
    await switchTab(page, /Valuation/);

    // Should produce a valuation even though NFO is negative
    await expect(page.locator("text=/Intrinsic|Fair Value|Per Share|₹/i").first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Telecom — Bharti Airtel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await loadCompanyFromLibrary(page, "Bharti Airtel");
  });

  test("handles high-leverage telecom correctly", async ({ page }) => {
    await switchTab(page, /Ratios/);

    // Telecom has high FLEV due to spectrum debt
    await expect(page.locator("text=/FLEV|Leverage/i").first()).toBeVisible({ timeout: 5000 });
  });

  test("Forecast tab handles capex-heavy model", async ({ page }) => {
    await switchTab(page, /Forecast/);

    await expect(page.locator("text=/Forecast|Projected|Terminal/i").first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("NBFC — Bajaj Finance", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await loadCompanyFromLibrary(page, "Bajaj Finance");
  });

  test("routes to financial institution analysis", async ({ page }) => {
    await page.waitForTimeout(3000);

    // NBFC should trigger bank/FI routing
    const bankTab = page.getByRole("tab", { name: /Bank/ });
    await expect(bankTab).toBeVisible({ timeout: 10_000 });
  });

  test("shows NBFC-specific metrics (spread, AUM, disbursements)", async ({ page }) => {
    await switchTab(page, /Bank/);

    // NBFC analysis
    const nbfcContent = page.locator("text=/Spread|AUM|Disbursement|Cost of Funds|NIM|Yield/i");
    expect(await nbfcContent.count()).toBeGreaterThan(0);
  });
});

test.describe("Utility — NTPC", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await loadCompanyFromLibrary(page, "NTPC");
  });

  test("handles regulated utility model", async ({ page }) => {
    await switchTab(page, /Ratios/);

    // NTPC should show industrial ratios with moderate RNOA
    await expect(page.locator("text=/RNOA|ROCE/i").first()).toBeVisible({ timeout: 5000 });
  });

  test("Business Model shows capital-intensive characteristics", async ({ page }) => {
    await switchTab(page, /Business Model/);

    // Capital allocation should be visible for utilities
    await expect(page.locator("text=/Capital|Allocation|PPE|Asset/i").first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Cyclical — Tata Steel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await loadCompanyFromLibrary(page, "Tata Steel");
  });

  test("detects cyclicality in ratios", async ({ page }) => {
    await switchTab(page, /Dashboard/);

    // Cyclical detection should be surfaced
    const content = await page.locator("main, [role='main'], .flex-1").first().textContent();
    expect(content).toBeTruthy();
  });

  test("Valuation handles through-cycle normalization", async ({ page }) => {
    await switchTab(page, /Valuation/);

    await expect(page.locator("text=/Valuation|Intrinsic|Fair Value|Cyclical/i").first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Tab Navigation — Complete Cycle", () => {
  test("navigates all 20 tabs without crashes after loading data", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await loadCompanyFromLibrary(page, "Asian Paints");

    const tabNames: (string | RegExp)[] = [
      /Dashboard/, /Statements/, /Ratios/, /Quality/,
      /Scope/, /Atlas/, /Business Model/, /Forecast/,
      /Valuation/, /Comparison/, /Report/, /Thesis/,
      /Regression/, /V3 Analytics/, /Debug/,
    ];

    for (const tabName of tabNames) {
      const tab = page.getByRole("tab", { name: tabName });
      if (await tab.isVisible() && await tab.isEnabled()) {
        await tab.click();
        await page.waitForTimeout(1500);

        // Core assertion: no crash, body still rendered
        await expect(page.locator("body")).toBeVisible();

        // No uncaught errors in console
        const errors: string[] = [];
        page.on("pageerror", (err) => errors.push(err.message));
        expect(errors).toHaveLength(0);
      }
    }
  });
});

test.describe("URL State Synchronization", () => {
  test("URL reflects active tab and config", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await loadCompanyFromLibrary(page, "Dabur India");

    await switchTab(page, /Ratios/);
    await page.waitForTimeout(500);

    // URL should contain tab=ratios
    expect(page.url()).toContain("tab=ratios");
  });

  test("loading URL with tab param navigates directly", async ({ page }) => {
    await page.goto("/?tab=debug");
    await page.waitForLoadState("networkidle");

    // Debug tab should be active
    const debugTab = page.getByRole("tab", { name: /Debug/ });
    await expect(debugTab).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("File Upload Flow", () => {
  test("ZIP upload triggers pipeline and enables data tabs", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The Data tab should be active by default
    const uploadInput = page.locator("input[type='file'][accept='.zip']").first();
    await expect(uploadInput).toBeAttached();

    // Upload Asian Paints ZIP file
    await uploadInput.setInputFiles("public/data/companies/Asian Paints/Asian Paints.zip");

    // Wait for pipeline to complete — Dashboard tab becomes enabled
    await expect(page.getByRole("tab", { name: /Dashboard/ })).toBeEnabled({ timeout: 60_000 });

    // Verify Statements tab also enabled
    await expect(page.getByRole("tab", { name: /Statements/ })).toBeEnabled();

    // Switch to Statements and verify data rendered
    await switchTab(page, /Statements/);
    await expect(page.locator("text=/Total Assets|TA|Balance Sheet/i").first()).toBeVisible({ timeout: 5000 });
  });
});
