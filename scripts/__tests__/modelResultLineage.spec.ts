/**
 * @vitest-environment node
 *
 * A scenario's model results cite the forecast case they were valued on: the
 * app's own run, on a real Capitaline zip (scripts/lib/libraryCompanyRun.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LibraryCompany } from "../../src/components/data-entry/companyRegistry";
import { runLibraryCompany } from "../lib/libraryCompanyRun";

const projectRoot = process.cwd();
const registry = JSON.parse(
  readFileSync(join(projectRoot, "public", "data", "companies", "registry.json"), "utf8"),
) as LibraryCompany[];

describe("model result lineage", () => {
  it("cites each scenario's forecast case on that scenario's model results, and no other's", async () => {
    const company = registry.find((entry) => entry.ticker === "TCS")!;
    const state = await runLibraryCompany(projectRoot, company, { now: new Date("2026-10-26T00:00:00.000Z") });
    if (state.status !== "ready") throw new Error(state.message);
    const { result } = state;
    const run = result.run!;

    // The forecast-case artifacts, by the scenario each one forecasts.
    const caseHash = new Map<string, string>();
    run.forecastCaseRefs.forEach((ref, index) => {
      const forecastResult = result.materialization.forecastResults[index]!;
      if (forecastResult.status === "computed") caseHash.set(forecastResult.forecastCase.caseId, ref.contentHash);
    });
    expect([...caseHash.keys()].sort()).toEqual(["base", "bull", "historical-panic", "stress"]);

    const scenarioResults = result.materialization.modelResults.flatMap((r) => (r.status === "computed" && r.caseId != null && caseHash.has(r.caseId) ? [r] : []));
    expect(scenarioResults.length).toBeGreaterThan(20);
    for (const modelResult of scenarioResults) {
      const own = caseHash.get(modelResult.caseId!)!;
      expect(modelResult.evidenceRefs, `${modelResult.modelId} ${modelResult.caseId}`).toContain(own);
      for (const [caseId, hash] of caseHash) {
        if (caseId !== modelResult.caseId) expect(modelResult.evidenceRefs).not.toContain(hash);
      }
    }
  }, 240_000);
});
