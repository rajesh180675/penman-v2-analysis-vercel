import { CURRENT_MODEL_REGISTRY, type ValuationModelResult } from "../modelCatalog";
import { adaptSectorCaseToCatalogResult } from "./adapters";
import { executeSectorCase } from "./calculators";
import {
  SECTOR_CASE_EXECUTION_SCHEMA_VERSION,
  type SectorCaseCatalogBinding,
  type SectorCaseCatalogExecutionResult,
  type SectorCaseInput,
  type SectorCaseType,
} from "./contracts";
import { CURRENT_SECTOR_CASE_REGISTRY, type SectorCaseRegistry } from "./registry";

const BASE_KEYS = ["caseType", "issuerId", "asOf", "companyType", "sharesOutstandingCr", "evidence"] as const;

const NUMBER_FIELDS: Readonly<Record<SectorCaseType, readonly string[]>> = {
  "utility-rab": ["regulatedRateBaseCr", "constructionWorkInProgressCr", "cwipEligibilityPct", "regulatoryAssetsCr", "regulatoryLiabilitiesCr", "regulatedEquityWeight", "allowedReturnOnEquity", "costOfEquity", "terminalGrowth", "netDebtCr"],
  "telecom-network": ["subscribersMillions", "monthlyArpuInr", "reportedAnnualRevenueCr", "ebitdaMargin", "cashTaxRate", "maintenanceCapexPctRevenue", "spectrumRenewalCapexPctRevenue", "costOfOperations", "terminalGrowth", "netDebtCr", "spectrumObligationsCr", "leaseLiabilitiesCr"],
  "bank-equity": ["commonBookValueCr", "sustainableRoe", "costOfEquity", "terminalGrowth", "capitalAdequacyPct", "minimumCapitalAdequacyPct"],
  "nbfc-funding": ["commonBookValueCr", "assetsUnderManagementCr", "sustainableRoa", "leverage", "assetYield", "costOfBorrowing", "creditCost", "costOfEquity", "terminalGrowth", "capitalAdequacyPct", "minimumCapitalAdequacyPct", "requiredCapitalBufferPct"],
  "insurance-embedded-value": ["embeddedValueCr", "valueOfNewBusinessCr", "valueOfNewBusinessMultiple", "solvencyRatioPct", "minimumSolvencyRatioPct"],
  "conglomerate-sotp": ["conglomerateDiscountPct", "holdingCompanyNetDebtCr"],
  "cyclical-mid-cycle": ["normalizedVolume", "midCyclePricePerUnit", "cashCostPerUnit", "annualFixedCostsCr", "sustainingCapexCr", "cashTaxRate", "costOfOperations", "terminalGrowth", "netDebtCr"],
  "retail-unit-economics": ["matureStoreCount", "annualRevenuePerStoreCr", "storeEbitdaMargin", "centralCostsCr", "maintenanceCapexPerStoreCr", "cashTaxRate", "costOfOperations", "terminalGrowth", "netDebtCr"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidResult(
  requestedModelId: string,
  binding: SectorCaseCatalogBinding | null,
  reasonCodes: readonly string[],
): SectorCaseCatalogExecutionResult {
  if (!binding) {
    return Object.freeze({
      schemaVersion: SECTOR_CASE_EXECUTION_SCHEMA_VERSION,
      status: "rejected" as const,
      requestedModelId,
      binding: null,
      reasonCodes: Object.freeze([...reasonCodes]),
      caseResult: null,
      modelResult: null,
    });
  }
  const modelResult: Extract<ValuationModelResult, { status: "invalid" }> = {
    status: "invalid",
    modelId: binding.modelId,
    modelVersion: binding.modelVersion,
    caseId: binding.caseType,
    reasonCode: reasonCodes.join("|") || "INVALID_SECTOR_CASE_REQUEST",
    failedGuards: [],
  };
  return Object.freeze({
    schemaVersion: SECTOR_CASE_EXECUTION_SCHEMA_VERSION,
    status: "blocked" as const,
    requestedModelId,
    binding,
    reasonCodes: Object.freeze([...reasonCodes]),
    caseResult: null,
    modelResult,
  });
}

function validateEvidence(value: unknown, reasonCodes: string[]): void {
  if (!isRecord(value)) {
    reasonCodes.push("invalid-evidence-map");
    return;
  }
  for (const [requirementId, refs] of Object.entries(value)) {
    if (!requirementId.trim() || !Array.isArray(refs) || refs.some((ref) => typeof ref !== "string" || !ref.trim())) {
      reasonCodes.push(`invalid-evidence:${requirementId || "<empty>"}`);
    }
  }
}

function validateSegments(value: unknown, reasonCodes: string[]): void {
  if (!Array.isArray(value)) {
    reasonCodes.push("segments-array-required");
    return;
  }
  value.forEach((segment, index) => {
    if (!isRecord(segment)) {
      reasonCodes.push(`invalid-segment:${index}`);
      return;
    }
    const allowed = new Set(["segmentId", "enterpriseValueCr", "netDebtCr", "minorityInterestCr", "evidenceRefs"]);
    if (Object.keys(segment).some((key) => !allowed.has(key))) reasonCodes.push(`unexpected-segment-field:${index}`);
    if (typeof segment.segmentId !== "string" || !segment.segmentId.trim()) reasonCodes.push(`invalid-segment-id:${index}`);
    for (const field of ["enterpriseValueCr", "netDebtCr", "minorityInterestCr"] as const) {
      if (typeof segment[field] !== "number" || !Number.isFinite(segment[field])) reasonCodes.push(`invalid-segment-number:${index}:${field}`);
    }
    if (!Array.isArray(segment.evidenceRefs) || segment.evidenceRefs.some((ref) => typeof ref !== "string" || !ref.trim())) {
      reasonCodes.push(`invalid-segment-evidence:${index}`);
    }
  });
}

function parseInput(value: unknown, binding: SectorCaseCatalogBinding): { input: SectorCaseInput | null; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  if (!isRecord(value)) return { input: null, reasonCodes: ["input-object-required"] };
  if (value.caseType !== binding.caseType) reasonCodes.push("case-model-binding-mismatch");
  if (typeof value.issuerId !== "string") reasonCodes.push("issuer-id-string-required");
  if (typeof value.asOf !== "string") reasonCodes.push("as-of-string-required");
  if (typeof value.companyType !== "string") reasonCodes.push("company-type-string-required");
  if (typeof value.sharesOutstandingCr !== "number" || !Number.isFinite(value.sharesOutstandingCr)) reasonCodes.push("finite-share-basis-required");
  validateEvidence(value.evidence, reasonCodes);

  const numberFields = NUMBER_FIELDS[binding.caseType];
  for (const field of numberFields) {
    if (typeof value[field] !== "number" || !Number.isFinite(value[field])) reasonCodes.push(`finite-number-required:${field}`);
  }
  if (binding.caseType === "conglomerate-sotp") validateSegments(value.segments, reasonCodes);

  const allowed = new Set<string>([
    ...BASE_KEYS,
    ...numberFields,
    ...(binding.caseType === "conglomerate-sotp" ? ["segments"] : []),
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) reasonCodes.push(`unexpected-field:${key}`);
  }
  return {
    input: reasonCodes.length === 0 ? value as unknown as SectorCaseInput : null,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

/**
 * Runtime-safe catalog entry point used by workers and future API adapters.
 * A catalog ID is resolved before any sector calculator runs; malformed or
 * mismatched payloads fail closed without a fabricated valuation.
 */
export function executeCatalogSectorCase(
  request: unknown,
  registry: SectorCaseRegistry = CURRENT_SECTOR_CASE_REGISTRY,
): SectorCaseCatalogExecutionResult {
  if (!isRecord(request) || typeof request.modelId !== "string" || !("input" in request)) {
    return invalidResult("<invalid>", null, ["invalid-catalog-execution-request"]);
  }
  const requestedModelId = request.modelId;
  const binding = registry.getCatalogBinding(requestedModelId) ?? null;
  if (!binding || !CURRENT_MODEL_REGISTRY.get(requestedModelId)) {
    return invalidResult(requestedModelId, null, ["model-not-sector-bound"]);
  }
  if (Object.keys(request).some((key) => key !== "modelId" && key !== "input")) {
    return invalidResult(requestedModelId, binding, ["unexpected-request-field"]);
  }
  const parsed = parseInput(request.input, binding);
  if (!parsed.input) return invalidResult(requestedModelId, binding, parsed.reasonCodes);

  const caseResult = executeSectorCase(parsed.input, registry);
  if (caseResult.status === "blocked") {
    const modelResult = adaptSectorCaseToCatalogResult(caseResult);
    if (modelResult.status === "computed") {
      return invalidResult(requestedModelId, binding, ["blocked-case-adapted-as-computed"]);
    }
    return Object.freeze({
      schemaVersion: SECTOR_CASE_EXECUTION_SCHEMA_VERSION,
      status: "blocked" as const,
      requestedModelId,
      binding,
      reasonCodes: Object.freeze([...caseResult.reasonCodes]),
      caseResult,
      modelResult,
    });
  }
  const modelResult = adaptSectorCaseToCatalogResult(caseResult);
  if (modelResult.status !== "computed") {
    return invalidResult(requestedModelId, binding, ["computed-case-adapted-as-noncomputed"]);
  }
  return Object.freeze({
    schemaVersion: SECTOR_CASE_EXECUTION_SCHEMA_VERSION,
    status: "computed" as const,
    requestedModelId,
    binding,
    reasonCodes: [] as const,
    caseResult,
    modelResult,
  });
}
