import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSectorOnboardingManifest, selectGovernedSectorCase, type SectorOnboardingCompany } from "../onboarding";

const companies = JSON.parse(readFileSync(resolve(process.cwd(), "public/data/companies/registry.json"), "utf8")) as SectorOnboardingCompany[];

describe("33-company governed sector onboarding", () => {
  const caseInput = {
    caseType: "utility-rab" as const, issuerId: "NTPC", asOf: "2026-03-31", companyType: "utility" as const, sharesOutstandingCr: 1_000,
    evidence: { "utility.rate-base": ["fact:rab"], "utility.tariff-return": ["source:tariff"], "utility.capital-structure": ["fact:capital"] },
    regulatedRateBaseCr: 100_000, constructionWorkInProgressCr: 10_000, cwipEligibilityPct: 0.5,
    regulatoryAssetsCr: 1_000, regulatoryLiabilitiesCr: 500, regulatedEquityWeight: 0.4,
    allowedReturnOnEquity: 0.14, costOfEquity: 0.11, terminalGrowth: 0.04, netDebtCr: 60_000,
  };
  it("gives every registry issuer an explicit applicable or not-applicable state", () => {
    const manifest = buildSectorOnboardingManifest(companies);
    expect(manifest).toHaveLength(33);
    expect(new Set(manifest.map((row) => row.issuerId)).size).toBe(33);
    expect(manifest.every((row) => row.status === "requires-sidecar" || row.status === "not-applicable")).toBe(true);
    expect(manifest.find((row) => row.issuerId === "NTPC")).toMatchObject({ inferredCaseType: "utility-rab", status: "requires-sidecar" });
    expect(manifest.find((row) => row.issuerId === "TCS")).toMatchObject({ inferredCaseType: null, status: "not-applicable" });
  });

  it("selects a case only after reviewed evidence is complete", () => {
    const ntpc = companies.find((company) => company.ticker === "NTPC")!;
    const row = buildSectorOnboardingManifest([ntpc], [{
      sidecarId: "ntpc-rab-v1", issuerId: "NTPC", caseType: "utility-rab", schemaVersion: "utility-rab-case-v1",
      reviewedAt: "2026-07-12T00:00:00.000Z", reviewerPrincipalId: "reviewer-1", status: "approved",
      evidence: { "utility.rate-base": ["fact:rab"], "utility.tariff-return": ["source:tariff"], "utility.capital-structure": ["fact:capital"] },
      caseInput,
    }])[0]!;
    expect(row.status).toBe("ready");
    expect(selectGovernedSectorCase(row)).toBe("utility-rab");
  });

  it("honors the latest reviewed revision so a rejection cannot be bypassed by input order", () => {
    const ntpc = companies.find((company) => company.ticker === "NTPC")!;
    const evidence = { "utility.rate-base": ["fact:rab"], "utility.tariff-return": ["source:tariff"], "utility.capital-structure": ["fact:capital"] };
    const row = buildSectorOnboardingManifest([ntpc], [
      { sidecarId: "ntpc-rab-v2", issuerId: "NTPC", caseType: "utility-rab", schemaVersion: "utility-rab-case-v1", reviewedAt: "2026-07-13T00:00:00.000Z", reviewerPrincipalId: "reviewer-2", status: "rejected", evidence, caseInput },
      { sidecarId: "ntpc-rab-v1", issuerId: "NTPC", caseType: "utility-rab", schemaVersion: "utility-rab-case-v1", reviewedAt: "2026-07-12T00:00:00.000Z", reviewerPrincipalId: "reviewer-1", status: "approved", evidence, caseInput },
    ], "2026-07-13T12:00:00.000Z")[0]!;
    expect(row.status).toBe("blocked");
    expect(row.sidecarId).toBe("ntpc-rab-v2");
    expect(row.reasonCodes).toContain("SIDECAR_NOT_APPROVED");
  });
});
