/**
 * @vitest-environment node
 *
 * The frozen forecast is the app's own run's: real Capitaline zips through
 * src/next/companyRun.ts, as the accountability runner freezes them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LibraryCompany } from "../../src/components/data-entry/companyRegistry";
import type { ValuationCommandCenterOutput } from "../../src/engine/valuationCommandCenter";
import { revalueBase } from "../../src/engine/valuationCommandCenter/breakEven";
import { snapshotFromAppRun } from "../accountability/appSnapshot";
import { runLibraryCompany } from "../lib/libraryCompanyRun";

const projectRoot = process.cwd();
const registry = JSON.parse(
  readFileSync(join(projectRoot, "public", "data", "companies", "registry.json"), "utf8"),
) as LibraryCompany[];
const MADE_AT = "2026-10-08";

async function appRun(ticker: string) {
  const company = registry.find((entry) => entry.ticker === ticker);
  if (!company) throw new Error(`Missing registry entry for ${ticker}`);
  const state = await runLibraryCompany(projectRoot, company, { now: new Date(`${MADE_AT}T00:00:00.000Z`) });
  if (state.status !== "ready") throw new Error(state.message);
  return { company, state };
}

describe("frozen forecast snapshots", () => {
  // The runner rebuilt the command center on the consolidated history, so it
  // froze M&M's forecast with its lending arm inside (year-1 sales ₹176,117 Cr,
  // ₹552 a share) while the app forecast the business without it (₹156,806 Cr,
  // ₹616).
  it("freezes the forecast and value the app shows, on its carved basis", async () => {
    const { company, state } = await appRun("M&M");
    const cc = state.result.materialization.commandCenter as unknown as ValuationCommandCenterOutput;
    const card = cc.scenarios.find((s) => s.key === "base")!;
    const shown = revalueBase(cc)!;
    const filedAnchor = state.result.materialization.pipelineResult!.periods.find((p) => p.period_end === cc.anchorPeriod.period_end)!;

    const snapshot = snapshotFromAppRun(state, company, MADE_AT);
    if ("skipped" in snapshot) throw new Error(snapshot.skipped);

    expect(snapshot.basis).toEqual({ accounts: "consolidated", lendingArm: "Mahindra & Mahindra Financial Services" });
    // The carved business is the smaller one, and the snapshot forecasts it.
    expect(cc.anchorPeriod.is.Sales).toBeLessThan(filedAnchor.is.Sales);
    expect(snapshot.cutoffPeriod).toBe(cc.anchorPeriod.period_end);
    expect(snapshot.years.map((y) => y.sales)).toEqual(shown.forecast!.map((f) => f.Sales_f));
    expect(snapshot.years.map((y) => y.operatingIncome)).toEqual(shown.forecast!.map((f) => f.OI_f));
    expect(snapshot.intrinsicPerShare).toBe(card.intrinsicPerShare);
    // The other cases as their cards forecast them, on the same carved basis.
    for (const [key, years] of [["stress", snapshot.scenarios.stress], ["bull", snapshot.scenarios.bull], ["historical-panic", snapshot.scenarios.historicalPanic]] as const) {
      const { assumptions } = cc.scenarios.find((s) => s.key === key)!;
      expect(years.map((y) => y.periodEnd)).toEqual(snapshot.years.map((y) => y.periodEnd));
      expect(years[0]!.sales / cc.anchorPeriod.is.Sales - 1).toBeCloseTo(assumptions.salesGrowthYear1, 9);
      expect(years[0]!.operatingIncome / years[0]!.sales).toBeCloseTo(assumptions.corePmYear1, 9);
    }
    expect(snapshot.scenarios.stress[0]!.sales).toBeLessThan(snapshot.years[0]!.sales);
    expect(snapshot.scenarios.bull[0]!.sales).toBeGreaterThan(snapshot.years[0]!.sales);
  }, 120_000);

  it("freezes nothing for a run the app stops before its valuation, and says why", async () => {
    const { company, state } = await appRun("PAYTM");
    expect(state.result.materialization.commandCenter).toBeNull();

    const snapshot = snapshotFromAppRun(state, company, MADE_AT);
    expect(snapshot).toEqual({ skipped: expect.stringContaining("LEGACY_VALUATION_POLICY_BLOCKED") });
  }, 120_000);
});
