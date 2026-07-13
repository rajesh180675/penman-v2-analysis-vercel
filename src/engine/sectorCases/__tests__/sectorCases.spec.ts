import { describe, expect, it } from "vitest";
import {
  CURRENT_MODEL_DEFINITIONS,
  CURRENT_MODEL_REGISTRY,
  ValuationModelRegistry,
} from "../../modelCatalog";
import {
  adaptSectorCaseToCatalogResult,
  CURRENT_SECTOR_CASE_REGISTRY,
  evaluateSectorNativeCredit,
  executeCatalogSectorCase,
  executeSectorCase,
  SECTOR_CASE_DEFINITIONS,
  toSectorNativeCreditResult,
  type SectorCaseInput,
  type SectorNativeCreditResult,
} from "..";

const evidence = (...ids: string[]): Readonly<Record<string, readonly string[]>> => Object.fromEntries(
  ids.map((id) => [id, [`evidence:${id}`]]),
);

const CASES: readonly SectorCaseInput[] = [
  {
    caseType: "utility-rab",
    issuerId: "UTILITY",
    asOf: "2026-03-31",
    companyType: "utility",
    sharesOutstandingCr: 100,
    evidence: evidence("utility.rate-base", "utility.tariff-return", "utility.capital-structure"),
    regulatedRateBaseCr: 1_000,
    constructionWorkInProgressCr: 100,
    cwipEligibilityPct: 0.5,
    regulatoryAssetsCr: 50,
    regulatoryLiabilitiesCr: 20,
    regulatedEquityWeight: 0.4,
    allowedReturnOnEquity: 0.14,
    costOfEquity: 0.11,
    terminalGrowth: 0.04,
    netDebtCr: 600,
  },
  {
    caseType: "telecom-network",
    issuerId: "TELECOM",
    asOf: "2026-03-31",
    companyType: "telecom",
    sharesOutstandingCr: 600,
    evidence: evidence("telecom.subscriber-arpu", "telecom.network-cash-flow", "telecom.spectrum-lease"),
    subscribersMillions: 300,
    monthlyArpuInr: 200,
    reportedAnnualRevenueCr: 72_000,
    ebitdaMargin: 0.45,
    cashTaxRate: 0.25,
    maintenanceCapexPctRevenue: 0.15,
    spectrumRenewalCapexPctRevenue: 0.05,
    costOfOperations: 0.10,
    terminalGrowth: 0.03,
    netDebtCr: 40_000,
    spectrumObligationsCr: 10_000,
    leaseLiabilitiesCr: 15_000,
  },
  {
    caseType: "bank-equity",
    issuerId: "BANK",
    asOf: "2026-03-31",
    companyType: "bank",
    sharesOutstandingCr: 100,
    evidence: evidence("bank.book-roe", "bank.regulatory-capital", "bank.cost-of-equity"),
    commonBookValueCr: 10_000,
    sustainableRoe: 0.16,
    costOfEquity: 0.12,
    terminalGrowth: 0.04,
    capitalAdequacyPct: 18,
    minimumCapitalAdequacyPct: 11.5,
  },
  {
    caseType: "nbfc-funding",
    issuerId: "NBFC",
    asOf: "2026-03-31",
    companyType: "nbfc",
    sharesOutstandingCr: 100,
    evidence: evidence("nbfc.aum-roa", "nbfc.funding-credit-cost", "nbfc.regulatory-capital"),
    commonBookValueCr: 10_000,
    assetsUnderManagementCr: 100_000,
    sustainableRoa: 0.025,
    leverage: 5,
    assetYield: 0.16,
    costOfBorrowing: 0.08,
    creditCost: 0.02,
    costOfEquity: 0.12,
    terminalGrowth: 0.04,
    capitalAdequacyPct: 22,
    minimumCapitalAdequacyPct: 15,
    requiredCapitalBufferPct: 3,
  },
  {
    caseType: "insurance-embedded-value",
    issuerId: "INSURANCE",
    asOf: "2026-03-31",
    companyType: "insurance",
    sharesOutstandingCr: 200,
    evidence: evidence("insurance.embedded-value-vnb", "insurance.solvency"),
    embeddedValueCr: 40_000,
    valueOfNewBusinessCr: 3_000,
    valueOfNewBusinessMultiple: 12,
    solvencyRatioPct: 190,
    minimumSolvencyRatioPct: 150,
  },
  {
    caseType: "conglomerate-sotp",
    issuerId: "CONGLOMERATE",
    asOf: "2026-03-31",
    companyType: "conglomerate",
    sharesOutstandingCr: 100,
    evidence: evidence("conglomerate.segment-values", "conglomerate.holdco-bridge"),
    segments: [
      { segmentId: "energy", enterpriseValueCr: 50_000, netDebtCr: 10_000, minorityInterestCr: 2_000, evidenceRefs: ["segment:energy"] },
      { segmentId: "consumer", enterpriseValueCr: 30_000, netDebtCr: 2_000, minorityInterestCr: 1_000, evidenceRefs: ["segment:consumer"] },
    ],
    conglomerateDiscountPct: 0.10,
    holdingCompanyNetDebtCr: 3_000,
  },
  {
    caseType: "cyclical-mid-cycle",
    issuerId: "CYCLICAL",
    asOf: "2026-03-31",
    companyType: "cyclical",
    sharesOutstandingCr: 100,
    evidence: evidence("cyclical.volume-price-cost", "cyclical.sustaining-capex", "cyclical.net-debt"),
    normalizedVolume: 100,
    midCyclePricePerUnit: 20,
    cashCostPerUnit: 12,
    annualFixedCostsCr: 200,
    sustainingCapexCr: 100,
    cashTaxRate: 0.25,
    costOfOperations: 0.11,
    terminalGrowth: 0.03,
    netDebtCr: 1_000,
  },
  {
    caseType: "retail-unit-economics",
    issuerId: "RETAIL",
    asOf: "2026-03-31",
    companyType: "consumer",
    sharesOutstandingCr: 50,
    evidence: evidence("retail.mature-store-cohort", "retail.central-costs-capex", "retail.net-debt"),
    matureStoreCount: 100,
    annualRevenuePerStoreCr: 20,
    storeEbitdaMargin: 0.20,
    centralCostsCr: 100,
    maintenanceCapexPerStoreCr: 0.5,
    cashTaxRate: 0.25,
    costOfOperations: 0.11,
    terminalGrowth: 0.03,
    netDebtCr: 500,
  },
];

describe("sector-native valuation cases", () => {
  it("registers every case against a catalog model", () => {
    expect(CURRENT_SECTOR_CASE_REGISTRY.list()).toHaveLength(8);
    expect(SECTOR_CASE_DEFINITIONS.map((definition) => definition.caseType)).toEqual([
      "utility-rab",
      "telecom-network",
      "bank-equity",
      "nbfc-funding",
      "insurance-embedded-value",
      "conglomerate-sotp",
      "cyclical-mid-cycle",
      "retail-unit-economics",
    ]);
    for (const definition of SECTOR_CASE_DEFINITIONS) {
      expect(CURRENT_MODEL_REGISTRY.get(definition.modelId)).toBeDefined();
    }
  });

  it.each(CASES.map((input) => [input.caseType, input] as const))(
    "computes a finite eligible %s result and adapts it without a fallback",
    (_caseType, input) => {
      const result = executeSectorCase(input);
      expect(result.status).toBe("computed");
      if (result.status !== "computed") throw new Error(result.reasonCodes.join(", "));
      expect(result.eligibility.status).toBe("eligible");
      expect(Number.isFinite(result.equityValueCr)).toBe(true);
      expect(result.equityValueCr).toBeGreaterThan(0);
      expect(Number.isFinite(result.perShareInr)).toBe(true);
      expect(result.guardResults.every((guard) => guard.status === "passed")).toBe(true);

      const catalogResult = adaptSectorCaseToCatalogResult(result);
      expect(catalogResult).toMatchObject({ status: "computed", modelId: result.modelId });
      expect(evaluateSectorNativeCredit(toSectorNativeCreditResult(result))).toMatchObject({
        credited: true,
        reasonCode: "credited",
        lifecycle: "production",
      });
    },
  );

  it("fails closed for missing evidence, wrong family, or a failed economic guard", () => {
    const utility = CASES[0]!;
    if (utility.caseType !== "utility-rab") throw new Error("fixture mismatch");
    const missingEvidence = executeSectorCase({ ...utility, evidence: {} });
    expect(missingEvidence.status).toBe("blocked");
    expect(adaptSectorCaseToCatalogResult(missingEvidence).status).toBe("insufficient-evidence");
    expect(evaluateSectorNativeCredit(toSectorNativeCreditResult(missingEvidence)).credited).toBe(false);

    const wrongFamily = executeSectorCase({ ...utility, companyType: "telecom" });
    expect(wrongFamily.status).toBe("blocked");
    if (wrongFamily.status === "blocked") expect(wrongFamily.eligibility.status).toBe("not-applicable");

    const telecom = CASES[1]!;
    if (telecom.caseType !== "telecom-network") throw new Error("fixture mismatch");
    const invalidSpread = executeSectorCase({ ...telecom, terminalGrowth: telecom.costOfOperations });
    expect(invalidSpread.status).toBe("blocked");
    if (invalidSpread.status === "blocked") {
      expect(invalidSpread.reasonCodes).toContain("telecom-rate-input-invalid");
    }
  });

  it("uses catalog lifecycle metadata and rejects spoofed/non-finite credit", () => {
    const result = executeSectorCase(CASES[0]!);
    const credit = toSectorNativeCreditResult(result);
    expect(evaluateSectorNativeCredit(credit).credited).toBe(true);

    const experimentalDefinitions = CURRENT_MODEL_DEFINITIONS.map((definition) =>
      definition.modelId === credit.modelId
        ? { ...definition, lifecycle: "experimental" as const }
        : definition,
    );
    const experimentalRegistry = ValuationModelRegistry.create("sector-credit-experimental-test", experimentalDefinitions);
    expect(evaluateSectorNativeCredit(credit, CURRENT_SECTOR_CASE_REGISTRY, experimentalRegistry))
      .toMatchObject({ credited: false, reasonCode: "model-not-production" });

    const spoofed: SectorNativeCreditResult = {
      ...credit,
      modelId: "industrial.penman.residual-income",
    };
    expect(evaluateSectorNativeCredit(spoofed)).toMatchObject({ credited: false, reasonCode: "case-model-mismatch" });

    const nonFinite: SectorNativeCreditResult = { ...credit, equityValueCr: Number.POSITIVE_INFINITY };
    expect(evaluateSectorNativeCredit(nonFinite)).toMatchObject({ credited: false, reasonCode: "non-finite-output" });
  });

  it.each(CASES.map((input) => [input.caseType, input] as const))(
    "executes %s through its catalog address and rejects contract drift",
    (_caseType, input) => {
      const binding = CURRENT_SECTOR_CASE_REGISTRY.getCatalogBinding(
        CURRENT_SECTOR_CASE_REGISTRY.require(input.caseType).modelId,
      );
      expect(binding).toBeDefined();
      const result = executeCatalogSectorCase({ modelId: binding!.modelId, input });
      expect(result.status).toBe("computed");
      if (result.status !== "computed") throw new Error(result.reasonCodes.join(", "));
      expect(result.binding.caseType).toBe(input.caseType);
      expect(result.modelResult.status).toBe("computed");

      const drifted = executeCatalogSectorCase({
        modelId: binding!.modelId,
        input: { ...input, unexpectedFallbackValue: 1 },
      });
      expect(drifted.status).toBe("blocked");
      if (drifted.status === "blocked") {
        expect(drifted.caseResult).toBeNull();
        expect(drifted.modelResult.status).toBe("invalid");
        expect(drifted.reasonCodes).toContain("unexpected-field:unexpectedFallbackValue");
      }
    },
  );

  it("rejects catalog IDs that are not bound to a sector case", () => {
    const result = executeCatalogSectorCase({
      modelId: "industrial.penman.residual-income",
      input: CASES[0],
    });
    expect(result).toMatchObject({
      status: "rejected",
      binding: null,
      modelResult: null,
      reasonCodes: ["model-not-sector-bound"],
    });
  });
});
