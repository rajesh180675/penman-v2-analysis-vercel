import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { auditCompanyRun, type AuditRegistryEntry } from "../lib/auditCompanyRun";

const projectRoot = process.cwd();
const registry = JSON.parse(
  readFileSync(join(projectRoot, "public", "data", "companies", "registry.json"), "utf8"),
) as AuditRegistryEntry[];

function byTicker(ticker: string): AuditRegistryEntry {
  const entry = registry.find((company) => company.ticker === ticker);
  if (!entry) throw new Error(`Missing registry entry for ${ticker}`);
  return entry;
}

describe("auditCompanyRun", () => {
  it("routes HDFC Bank through a financial-institution audit result with explicit metadata", async () => {
    const result = await auditCompanyRun(byTicker("HDFCBANK"), { projectRoot: resolve(projectRoot) });

    expect(result.companyType).toBe("bank");
    expect(result.analysisFamily).toBe("financial-institution");
    expect(result.pipelineStrategyId).toBe("bank-v1");
    expect(result.modelApplicability.industrialCommandCenter.status).toBe("skipped");
    expect(result.modelApplicability.financialInstitutionValuation.status).not.toBe("skipped");
    expect(result.statusClass).not.toBe("calc-error");
    expect(result.error ?? "").not.toContain("shareCountInput");
    expect(result.flags.join(",")).not.toContain("shareCountInput");
  }, 120_000);
});
