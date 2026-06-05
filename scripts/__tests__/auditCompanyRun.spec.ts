/**
 * @vitest-environment node
 *
 * No DOM needed — this suite runs the engine pipeline + valuation against
 * real Capitaline ZIPs. Using "node" instead of the default "jsdom" saves
 * ~200MB per worker and avoids OOM when multiple company audits run in one
 * fork.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { auditCompanyRun, type AuditRegistryEntry } from "../lib/auditCompanyRun";

const projectRoot = process.cwd();
const registry = JSON.parse(
  readFileSync(join(projectRoot, "public", "data", "companies", "registry.json"), "utf8"),
) as AuditRegistryEntry[];

function byTicker(ticker: string): AuditRegistryEntry {
  const company = registry.find((entry) => entry.ticker === ticker);
  if (!company) throw new Error(`Missing registry entry for ${ticker}`);
  return company;
}

/**
 * No cross-test caching. Each test creates its own auditCompanyRun and lets
 * GC reclaim the heavy pipeline + valuation objects after the test. The
 * previous Map-based cache caused V8 OOM when all 6 tests accumulated
 * parsed data for 6+ companies in a single worker.
 */
describe.sequential("auditCompanyRun", () => {
 // Force GC after each heavy test to release pipeline objects before
 // the next company audit. Without this, 6+ audits accumulate past 4GB.
 afterEach(() => {
 if (typeof globalThis.gc === "function") globalThis.gc();
 });

 function runAudit(ticker: string): ReturnType<typeof auditCompanyRun> {
 return auditCompanyRun(byTicker(ticker), { projectRoot: resolve(projectRoot) });
 }

  it("routes HDFC Bank through a financial-institution audit result with explicit metadata", async () => {
    const result = await runAudit("HDFCBANK");

    expect(result.companyType).toBe("bank");
    expect(result.analysisFamily).toBe("financial-institution");
    expect(result.pipelineStrategyId).toBe("bank-v1");
    expect(result.modelApplicability.industrialCommandCenter.status).toBe("skipped");
    expect(result.modelApplicability.financialInstitutionValuation.status).not.toBe("skipped");
    expect(result.statusClass).not.toBe("calc-error");
    expect(result.error ?? "").not.toContain("shareCountInput");
    expect(result.flags.join(",")).not.toContain("shareCountInput");
  }, 120_000);

  it("exposes computed industrial valuation lenses instead of collapsing them to one VCC bucket", async () => {
    const result = await runAudit("ASIANPAINT");

    expect(result.companyType).toBe("consumer");
    expect(result.analysisFamily).toBe("industrial");
    expect(result.statusClass).not.toBe("calc-error");
    expect(result.valuation.sotpTotal).not.toBeNull();
    expect(result.valuation.epvPerShare).not.toBeNull();
    expect(result.models).toEqual(expect.arrayContaining(["VCC", "SOTP", "EPV", "CASH_DCF"]));
    expect(result.models.length).toBeGreaterThan(1);
  }, 120_000);

  it("attaches a hashed source artifact manifest to audit rows", async () => {
    const result = await runAudit("ASIANPAINT");

    expect(result.sourceEvidence.artifactCount).toBeGreaterThan(0);
    expect(result.sourceEvidence.hashedArtifactCount).toBe(result.sourceEvidence.artifactCount);
    const zipArtifact = result.sourceEvidence.artifacts.find((artifact) => artifact.artifactId === "Asian Paints.zip");
    expect(zipArtifact?.provider).toBe("capitaline");
    expect(zipArtifact?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(zipArtifact?.sourceUnavailable).toBe(false);
    expect(result.sourceEvidence.lineageRef?.hasLineage).toBe(true);
    expect(result.sourceEvidence.lineageRef?.conceptCount).toBeGreaterThan(0);
    expect(result.sourceEvidence.lineageRef?.periodCount).toBeGreaterThan(0);
    expect(result.sourceEvidence.lineageRef?.checksum).toMatch(/^[a-f0-9]{8,64}$/);
    expect(result.marketEvidence.status).toBe("source_unavailable");
    expect(result.marketEvidence.reason).toMatch(/No timestamped market data source/);
    expect(result.marketEvidence.inputs).toEqual([]);
    expect(result.productionReady.status).toBe("blocked");
    expect(result.productionReady.checkpoints.map((checkpoint) => checkpoint.id)).toEqual(expect.arrayContaining([
      "source-lineage",
      "market-freshness",
      "valuation-readiness",
      "reviewer-pack",
    ]));
    expect(result.productionReady.checkpoints.every((checkpoint) => checkpoint.reason.length > 0)).toBe(true);
  }, 120_000);

  it("carries valuation readiness and triangulation evidence into audit rows", async () => {
    const result = await runAudit("ASIANPAINT");

    expect(result.valuationEvidence.readinessStatus).not.toBe("unknown");
    expect(result.valuationEvidence.readinessStatus).toMatch(/^(production-ready|warning|guarded)$/);
    expect(result.valuationEvidence.triangulationMethods.map((method) => method.key)).toEqual(
      expect.arrayContaining(["accrual-riv", "cash-fcff-dcf"]),
    );
    expect(result.valuationEvidence.independentLensGroups).toEqual(
      expect.arrayContaining(["accrual-history", "cash-statement"]),
    );
    expect(result.valuationEvidence.defensibilityStatus).toMatch(/^(confirmed|guarded|blocked)$/);
  }, 120_000);

  it("promotes hard-tieout-cleared industrial rows beyond syntactic-only while preserving guarded valuation status", async () => {
  const result = await runAudit("ASIANPAINT");

  // The hard-tieout-ready promotion allows structural reconciliation to clear
  // even when some residual checks are in warning range. Economic sanity
  // may also clear, so the rigor level is at least structurally-reconciled
  // and may reach economically-plausible.
  expect(["structurally-reconciled", "economically-plausible"]).toContain(result.rigor.currentLevel);
  expect(result.rigor.reconciliationStatus).toBe("degraded");
  // readinessStatus may be "guarded" or "warning" depending on the
  // valuation readiness computed from the pipeline periods.
  expect(["guarded", "warning"]).toContain(result.valuationEvidence.readinessStatus);
  }, 120_000);

  it("carries financial-institution valuation readiness evidence and bank-shape triangulation when bank gates clear", async () => {
  const result = await runAudit("HDFCBANK");

  expect(result.analysisFamily).toBe("financial-institution");
  expect(result.pipelineStrategyId).toBe("bank-v1");
  // Valuation evidence itself reaches production-ready + confirmed
  expect(result.valuationEvidence.readinessStatus).toBe("production-ready");
  expect(result.valuationEvidence.defensibilityStatus).toBe("confirmed");
  expect(result.valuationEvidence.triangulationMethods.map((method) => method.key)).toEqual(
  expect.arrayContaining(["bank-pb", "bank-eri", "bank-ddm"]),
  );
  expect(result.valuationEvidence.independentLensGroups).toEqual(
  expect.arrayContaining(["book-value", "residual-income", "distribution"]),
  );
  // Rigor is capped below production-ready when analysisStatus is "guarded"
  // (diagnostic mapping gaps → deriveAnalysisStatus returns guarded, which
  // blocks the production-ready checkpoint in analysisTraceability).
  expect(result.rigor.currentLevel).toBe("structurally-reconciled");
  expect(result.outcome).toBe("POLICY_WARNING");
  }, 120_000);

  it("routes explicit sector-native company types through native valuation strategy ids and evidence", async () => {
    const cases = [
      { ticker: "BHARTIARTL", strategy: "telecom-v1", model: "TELECOM_NATIVE" },
      { ticker: "NTPC", strategy: "utility-v1", model: "UTILITY_RAB" },
      { ticker: "TATASTEEL", strategy: "cyclical-v1", model: "CYCLICAL_MID_CYCLE" },
      { ticker: "PAYTM", strategy: "loss-maker-v1", model: "LOSS_MAKER_RUNWAY" },
    ];

    for (const item of cases) {
      const result = await runAudit(item.ticker);
      expect(result.pipelineStrategyId).toBe(item.strategy);
      expect(result.models).toContain(item.model);
      expect(result.valuationEvidence.independentLensGroups).toContain("sector-native");
      expect(result.valuationEvidence.triangulationMethods.map((method) => method.key)).toContain(item.strategy.replace("-v1", ""));
    }
  }, 240_000);
});
