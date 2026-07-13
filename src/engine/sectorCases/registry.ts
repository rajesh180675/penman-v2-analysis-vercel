import { CURRENT_MODEL_REGISTRY, type ValuationModelRegistry } from "../modelCatalog";
import type {
  SectorCaseCatalogBinding,
  SectorCaseDefinition,
  SectorCaseEligibility,
  SectorCaseInput,
  SectorCaseType,
} from "./contracts";

export const SECTOR_CASE_DEFINITIONS = [
  {
    caseType: "utility-rab",
    label: "Utility regulated asset base",
    modelId: "sector.utility.rab-ddm",
    inputContract: "utility-rab-case-v1",
    companyTypes: ["utility"],
    requiredEvidenceIds: ["utility.rate-base", "utility.tariff-return", "utility.capital-structure"],
    description: "Allowed-return equity cash flow on an evidence-backed regulated rate base.",
  },
  {
    caseType: "telecom-network",
    label: "Telecom subscriber/network FCFF",
    modelId: "sector.telecom.subscriber-fcff",
    inputContract: "telecom-network-case-v1",
    companyTypes: ["telecom"],
    requiredEvidenceIds: ["telecom.subscriber-arpu", "telecom.network-cash-flow", "telecom.spectrum-lease"],
    description: "Subscriber/ARPU revenue bridge and network cash-flow valuation after spectrum and lease obligations.",
  },
  {
    caseType: "bank-equity",
    label: "Bank justified book equity",
    modelId: "fi.bank.justified-pb-gordon",
    inputContract: "bank-equity-case-v1",
    companyTypes: ["bank"],
    requiredEvidenceIds: ["bank.book-roe", "bank.regulatory-capital", "bank.cost-of-equity"],
    description: "Justified P/B valuation subject to regulatory-capital eligibility.",
  },
  {
    caseType: "nbfc-funding",
    label: "NBFC funding and capital residual income",
    modelId: "sector.nbfc.funding-justified-pb",
    inputContract: "nbfc-funding-case-v1",
    companyTypes: ["nbfc"],
    requiredEvidenceIds: ["nbfc.aum-roa", "nbfc.funding-credit-cost", "nbfc.regulatory-capital"],
    description: "One-stage justified P/B from ROA and leverage, gated by funding spread, credit cost, and capital headroom.",
  },
  {
    caseType: "insurance-embedded-value",
    label: "Insurance embedded value and VNB",
    modelId: "fi.insurance.embedded-value-vnb",
    inputContract: "insurance-embedded-value-case-v1",
    companyTypes: ["insurance"],
    requiredEvidenceIds: ["insurance.embedded-value-vnb", "insurance.solvency"],
    description: "Actuarial embedded value plus value-of-new-business subject to solvency eligibility.",
  },
  {
    caseType: "conglomerate-sotp",
    label: "Conglomerate sum of the parts",
    modelId: "industrial.segment-sotp",
    inputContract: "conglomerate-sotp-case-v1",
    companyTypes: ["conglomerate", "industrial"],
    requiredEvidenceIds: ["conglomerate.segment-values", "conglomerate.holdco-bridge"],
    description: "Evidence-backed segment equity values with explicit minority, debt, and conglomerate discount bridges.",
  },
  {
    caseType: "cyclical-mid-cycle",
    label: "Cyclical mid-cycle FCFF",
    modelId: "sector.cyclical.mid-cycle-fcff",
    inputContract: "cyclical-mid-cycle-case-v1",
    companyTypes: ["cyclical"],
    requiredEvidenceIds: ["cyclical.volume-price-cost", "cyclical.sustaining-capex", "cyclical.net-debt"],
    description: "Mid-cycle volume, price, cost, and sustaining-capex FCFF valuation.",
  },
  {
    caseType: "retail-unit-economics",
    label: "Retail unit economics FCFF",
    modelId: "sector.retail.unit-economics-fcff",
    inputContract: "retail-unit-economics-case-v1",
    companyTypes: ["consumer"],
    requiredEvidenceIds: ["retail.mature-store-cohort", "retail.central-costs-capex", "retail.net-debt"],
    description: "Mature-store cohort cash economics after central costs and maintenance capex.",
  },
] as const satisfies readonly SectorCaseDefinition[];

export class SectorCaseRegistry {
  readonly #byType: ReadonlyMap<SectorCaseType, SectorCaseDefinition>;
  readonly #byModelId: ReadonlyMap<string, SectorCaseDefinition>;
  readonly #bindingsByModelId: ReadonlyMap<string, SectorCaseCatalogBinding>;

  constructor(
    definitions: readonly SectorCaseDefinition[],
    modelRegistry: ValuationModelRegistry = CURRENT_MODEL_REGISTRY,
  ) {
    const byType = new Map<SectorCaseType, SectorCaseDefinition>();
    const byModelId = new Map<string, SectorCaseDefinition>();
    const bindingsByModelId = new Map<string, SectorCaseCatalogBinding>();
    for (const definition of definitions) {
      if (byType.has(definition.caseType)) {
        throw new Error(`Duplicate sector case '${definition.caseType}'.`);
      }
      const modelDefinition = modelRegistry.get(definition.modelId);
      if (!modelDefinition) {
        throw new Error(`Sector case '${definition.caseType}' references unregistered model '${definition.modelId}'.`);
      }
      if (byModelId.has(definition.modelId)) {
        throw new Error(`Catalog model '${definition.modelId}' is bound to more than one sector case.`);
      }
      if (modelDefinition.category !== "intrinsic") {
        throw new Error(`Sector case '${definition.caseType}' must reference an intrinsic catalog model.`);
      }
      if (modelDefinition.lifecycle === "deprecated") {
        throw new Error(`Sector case '${definition.caseType}' cannot reference deprecated model '${definition.modelId}'.`);
      }
      if (!definition.requiredEvidenceIds.length) {
        throw new Error(`Sector case '${definition.caseType}' has no evidence requirements.`);
      }
      const frozenDefinition = Object.freeze({ ...definition });
      byType.set(definition.caseType, frozenDefinition);
      byModelId.set(definition.modelId, frozenDefinition);
      bindingsByModelId.set(definition.modelId, Object.freeze({
        caseType: definition.caseType,
        modelId: definition.modelId,
        modelVersion: modelDefinition.modelVersion,
        caseInputContract: definition.inputContract,
        catalogInputContract: modelDefinition.inputContract,
        catalogVersion: modelRegistry.catalogVersion,
      }));
    }
    this.#byType = byType;
    this.#byModelId = byModelId;
    this.#bindingsByModelId = bindingsByModelId;
  }

  get(caseType: SectorCaseType): SectorCaseDefinition | undefined {
    return this.#byType.get(caseType);
  }

  require(caseType: SectorCaseType): SectorCaseDefinition {
    const definition = this.get(caseType);
    if (!definition) throw new Error(`Unknown sector case '${caseType}'.`);
    return definition;
  }

  getByModelId(modelId: string): SectorCaseDefinition | undefined {
    return this.#byModelId.get(modelId);
  }

  requireByModelId(modelId: string): SectorCaseDefinition {
    const definition = this.getByModelId(modelId);
    if (!definition) throw new Error(`Catalog model '${modelId}' has no sector-case binding.`);
    return definition;
  }

  getCatalogBinding(modelId: string): SectorCaseCatalogBinding | undefined {
    return this.#bindingsByModelId.get(modelId);
  }

  listCatalogBindings(): readonly SectorCaseCatalogBinding[] {
    return Object.freeze([...this.#bindingsByModelId.values()].sort((left, right) =>
      left.modelId.localeCompare(right.modelId)));
  }

  list(): readonly SectorCaseDefinition[] {
    return Object.freeze([...this.#byType.values()]);
  }
}

function finiteInputValues(input: SectorCaseInput): readonly number[] {
  switch (input.caseType) {
    case "utility-rab": return [input.sharesOutstandingCr, input.regulatedRateBaseCr, input.constructionWorkInProgressCr, input.cwipEligibilityPct, input.regulatoryAssetsCr, input.regulatoryLiabilitiesCr, input.regulatedEquityWeight, input.allowedReturnOnEquity, input.costOfEquity, input.terminalGrowth, input.netDebtCr];
    case "telecom-network": return [input.sharesOutstandingCr, input.subscribersMillions, input.monthlyArpuInr, input.reportedAnnualRevenueCr, input.ebitdaMargin, input.cashTaxRate, input.maintenanceCapexPctRevenue, input.spectrumRenewalCapexPctRevenue, input.costOfOperations, input.terminalGrowth, input.netDebtCr, input.spectrumObligationsCr, input.leaseLiabilitiesCr];
    case "bank-equity": return [input.sharesOutstandingCr, input.commonBookValueCr, input.sustainableRoe, input.costOfEquity, input.terminalGrowth, input.capitalAdequacyPct, input.minimumCapitalAdequacyPct];
    case "nbfc-funding": return [input.sharesOutstandingCr, input.commonBookValueCr, input.assetsUnderManagementCr, input.sustainableRoa, input.leverage, input.assetYield, input.costOfBorrowing, input.creditCost, input.costOfEquity, input.terminalGrowth, input.capitalAdequacyPct, input.minimumCapitalAdequacyPct, input.requiredCapitalBufferPct];
    case "insurance-embedded-value": return [input.sharesOutstandingCr, input.embeddedValueCr, input.valueOfNewBusinessCr, input.valueOfNewBusinessMultiple, input.solvencyRatioPct, input.minimumSolvencyRatioPct];
    case "conglomerate-sotp": return [input.sharesOutstandingCr, input.conglomerateDiscountPct, input.holdingCompanyNetDebtCr, ...input.segments.flatMap((segment) => [segment.enterpriseValueCr, segment.netDebtCr, segment.minorityInterestCr])];
    case "cyclical-mid-cycle": return [input.sharesOutstandingCr, input.normalizedVolume, input.midCyclePricePerUnit, input.cashCostPerUnit, input.annualFixedCostsCr, input.sustainingCapexCr, input.cashTaxRate, input.costOfOperations, input.terminalGrowth, input.netDebtCr];
    case "retail-unit-economics": return [input.sharesOutstandingCr, input.matureStoreCount, input.annualRevenuePerStoreCr, input.storeEbitdaMargin, input.centralCostsCr, input.maintenanceCapexPerStoreCr, input.cashTaxRate, input.costOfOperations, input.terminalGrowth, input.netDebtCr];
  }
}

function isFraction(value: number): boolean { return Number.isFinite(value) && value >= 0 && value <= 1; }
function isNonNegative(value: number): boolean { return Number.isFinite(value) && value >= 0; }
function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function evaluateSectorCaseEligibility(
  input: SectorCaseInput,
  registry: SectorCaseRegistry = CURRENT_SECTOR_CASE_REGISTRY,
): SectorCaseEligibility {
  const definition = registry.require(input.caseType);
  if (!definition.companyTypes.includes(input.companyType)) {
    return {
      status: "not-applicable",
      caseType: input.caseType,
      modelId: definition.modelId,
      reasonCodes: ["company-type-not-applicable"],
      missingEvidenceIds: [],
      summary: `${definition.label} does not apply to company type '${input.companyType}'.`,
    };
  }
  const missingEvidenceIds = definition.requiredEvidenceIds.filter((requirementId) => {
    const refs = input.evidence[requirementId];
    return !Array.isArray(refs) || refs.length === 0 || refs.some((ref) => !ref.trim());
  });
  if (missingEvidenceIds.length) {
    return {
      status: "insufficient-evidence",
      caseType: input.caseType,
      modelId: definition.modelId,
      reasonCodes: missingEvidenceIds.map((id) => `missing-evidence:${id}`),
      missingEvidenceIds,
      summary: `${missingEvidenceIds.length} required sector evidence item(s) are missing.`,
    };
  }
  const invalidReasons: string[] = [];
  if (!input.issuerId.trim()) invalidReasons.push("issuer-id-required");
  if (!isValidDateOnly(input.asOf)) invalidReasons.push("invalid-as-of-date");
  if (!(Number.isFinite(input.sharesOutstandingCr) && input.sharesOutstandingCr > 0)) invalidReasons.push("positive-shares-required");
  if (!finiteInputValues(input).every(Number.isFinite)) invalidReasons.push("non-finite-input");
  switch (input.caseType) {
    case "utility-rab":
      if (!(input.regulatedRateBaseCr > 0) || ![input.constructionWorkInProgressCr, input.regulatoryAssetsCr, input.regulatoryLiabilitiesCr].every(isNonNegative)) invalidReasons.push("utility-balance-input-invalid");
      if (![input.cwipEligibilityPct, input.regulatedEquityWeight, input.allowedReturnOnEquity, input.costOfEquity].every(isFraction) || !(input.costOfEquity > 0 && input.costOfEquity > input.terminalGrowth)) invalidReasons.push("utility-rate-input-invalid");
      break;
    case "telecom-network":
      if (!(input.subscribersMillions > 0 && input.monthlyArpuInr > 0 && input.reportedAnnualRevenueCr > 0)) invalidReasons.push("telecom-operating-input-invalid");
      if (![input.ebitdaMargin, input.cashTaxRate, input.maintenanceCapexPctRevenue, input.spectrumRenewalCapexPctRevenue, input.costOfOperations].every(isFraction) || !(input.costOfOperations > 0 && input.costOfOperations > input.terminalGrowth)) invalidReasons.push("telecom-rate-input-invalid");
      if (![input.netDebtCr, input.spectrumObligationsCr, input.leaseLiabilitiesCr].every(isNonNegative)) invalidReasons.push("telecom-obligation-input-invalid");
      break;
    case "bank-equity":
      if (!(input.commonBookValueCr > 0) || ![input.sustainableRoe, input.costOfEquity].every(isFraction) || !(input.costOfEquity > 0 && input.costOfEquity > input.terminalGrowth) || !isNonNegative(input.capitalAdequacyPct) || !isNonNegative(input.minimumCapitalAdequacyPct)) invalidReasons.push("bank-economic-input-invalid");
      break;
    case "nbfc-funding":
      if (!(input.commonBookValueCr > 0 && input.assetsUnderManagementCr > 0 && input.leverage > 0) || ![input.sustainableRoa, input.assetYield, input.costOfBorrowing, input.creditCost, input.costOfEquity].every(isFraction) || !(input.costOfEquity > 0 && input.costOfEquity > input.terminalGrowth)) invalidReasons.push("nbfc-economic-input-invalid");
      if (![input.capitalAdequacyPct, input.minimumCapitalAdequacyPct, input.requiredCapitalBufferPct].every(isNonNegative)) invalidReasons.push("nbfc-capital-input-invalid");
      break;
    case "insurance-embedded-value":
      if (!(input.embeddedValueCr > 0) || ![input.valueOfNewBusinessCr, input.valueOfNewBusinessMultiple, input.solvencyRatioPct, input.minimumSolvencyRatioPct].every(isNonNegative)) invalidReasons.push("insurance-economic-input-invalid");
      break;
    case "conglomerate-sotp":
      if (!isFraction(input.conglomerateDiscountPct) || input.segments.some((segment) => !isNonNegative(segment.enterpriseValueCr))) invalidReasons.push("conglomerate-economic-input-invalid");
      break;
    case "cyclical-mid-cycle":
      if (![input.normalizedVolume, input.midCyclePricePerUnit, input.cashCostPerUnit, input.annualFixedCostsCr, input.sustainingCapexCr].every(isNonNegative) || ![input.cashTaxRate, input.costOfOperations].every(isFraction) || !(input.costOfOperations > 0 && input.costOfOperations > input.terminalGrowth)) invalidReasons.push("cyclical-economic-input-invalid");
      break;
    case "retail-unit-economics":
      if (![input.matureStoreCount, input.annualRevenuePerStoreCr, input.centralCostsCr, input.maintenanceCapexPerStoreCr].every(isNonNegative) || ![input.storeEbitdaMargin, input.cashTaxRate, input.costOfOperations].every(isFraction) || !(input.costOfOperations > 0 && input.costOfOperations > input.terminalGrowth)) invalidReasons.push("retail-economic-input-invalid");
      break;
  }
  if (input.caseType === "conglomerate-sotp") {
    if (input.segments.length < 2) invalidReasons.push("minimum-two-segments");
    if (input.segments.some((segment) => !segment.evidenceRefs.length)) invalidReasons.push("segment-evidence-required");
    if (new Set(input.segments.map((segment) => segment.segmentId)).size !== input.segments.length) invalidReasons.push("duplicate-segment-id");
  }
  if (invalidReasons.length) {
    return {
      status: "invalid-input",
      caseType: input.caseType,
      modelId: definition.modelId,
      reasonCodes: invalidReasons,
      missingEvidenceIds: [],
      summary: `${invalidReasons.length} sector-case input guard(s) failed.`,
    };
  }
  const evidenceRefs = [...new Set(definition.requiredEvidenceIds.flatMap((id) => input.evidence[id] ?? []))].sort();
  return {
    status: "eligible",
    caseType: input.caseType,
    modelId: definition.modelId,
    satisfiedEvidenceIds: [...definition.requiredEvidenceIds],
    evidenceRefs,
  };
}

export const CURRENT_SECTOR_CASE_REGISTRY = new SectorCaseRegistry(SECTOR_CASE_DEFINITIONS);
