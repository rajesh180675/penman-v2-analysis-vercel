import type { CompanyType } from "../types";
import type { ModelGuardResult, ValuationModelLifecycle } from "../modelCatalog";

export const SECTOR_CASE_SCHEMA_VERSION = "2026-07-sector-case-v1" as const;
export const SECTOR_CASE_EXECUTION_SCHEMA_VERSION = "2026-07-sector-case-execution-v1" as const;

export type SectorCaseType =
  | "utility-rab"
  | "telecom-network"
  | "bank-equity"
  | "nbfc-funding"
  | "insurance-embedded-value"
  | "conglomerate-sotp"
  | "cyclical-mid-cycle"
  | "retail-unit-economics";

export interface SectorCaseInputBase<TCaseType extends SectorCaseType> {
  readonly caseType: TCaseType;
  readonly issuerId: string;
  readonly asOf: string;
  readonly companyType: Exclude<CompanyType, "auto">;
  readonly sharesOutstandingCr: number;
  /** Requirement ID -> immutable source/lineage references. */
  readonly evidence: Readonly<Record<string, readonly string[]>>;
}

export interface UtilityRabCaseInput extends SectorCaseInputBase<"utility-rab"> {
  readonly regulatedRateBaseCr: number;
  readonly constructionWorkInProgressCr: number;
  readonly cwipEligibilityPct: number;
  readonly regulatoryAssetsCr: number;
  readonly regulatoryLiabilitiesCr: number;
  readonly regulatedEquityWeight: number;
  readonly allowedReturnOnEquity: number;
  readonly costOfEquity: number;
  readonly terminalGrowth: number;
  readonly netDebtCr: number;
}

export interface TelecomNetworkCaseInput extends SectorCaseInputBase<"telecom-network"> {
  readonly subscribersMillions: number;
  readonly monthlyArpuInr: number;
  readonly reportedAnnualRevenueCr: number;
  readonly ebitdaMargin: number;
  readonly cashTaxRate: number;
  readonly maintenanceCapexPctRevenue: number;
  readonly spectrumRenewalCapexPctRevenue: number;
  readonly costOfOperations: number;
  readonly terminalGrowth: number;
  readonly netDebtCr: number;
  readonly spectrumObligationsCr: number;
  readonly leaseLiabilitiesCr: number;
}

export interface BankEquityCaseInput extends SectorCaseInputBase<"bank-equity"> {
  readonly commonBookValueCr: number;
  readonly sustainableRoe: number;
  readonly costOfEquity: number;
  readonly terminalGrowth: number;
  readonly capitalAdequacyPct: number;
  readonly minimumCapitalAdequacyPct: number;
}

export interface NbfcFundingCaseInput extends SectorCaseInputBase<"nbfc-funding"> {
  readonly commonBookValueCr: number;
  readonly assetsUnderManagementCr: number;
  readonly sustainableRoa: number;
  readonly leverage: number;
  readonly assetYield: number;
  readonly costOfBorrowing: number;
  readonly creditCost: number;
  readonly costOfEquity: number;
  readonly terminalGrowth: number;
  readonly capitalAdequacyPct: number;
  readonly minimumCapitalAdequacyPct: number;
  readonly requiredCapitalBufferPct: number;
}

export interface InsuranceEmbeddedValueCaseInput extends SectorCaseInputBase<"insurance-embedded-value"> {
  readonly embeddedValueCr: number;
  readonly valueOfNewBusinessCr: number;
  readonly valueOfNewBusinessMultiple: number;
  readonly solvencyRatioPct: number;
  readonly minimumSolvencyRatioPct: number;
}

export interface ConglomerateSegmentInput {
  readonly segmentId: string;
  readonly enterpriseValueCr: number;
  readonly netDebtCr: number;
  readonly minorityInterestCr: number;
  readonly evidenceRefs: readonly string[];
}

export interface ConglomerateSotpCaseInput extends SectorCaseInputBase<"conglomerate-sotp"> {
  readonly segments: readonly ConglomerateSegmentInput[];
  readonly conglomerateDiscountPct: number;
  readonly holdingCompanyNetDebtCr: number;
}

export interface CyclicalMidCycleCaseInput extends SectorCaseInputBase<"cyclical-mid-cycle"> {
  readonly normalizedVolume: number;
  readonly midCyclePricePerUnit: number;
  readonly cashCostPerUnit: number;
  readonly annualFixedCostsCr: number;
  readonly sustainingCapexCr: number;
  readonly cashTaxRate: number;
  readonly costOfOperations: number;
  readonly terminalGrowth: number;
  readonly netDebtCr: number;
}

export interface RetailUnitEconomicsCaseInput extends SectorCaseInputBase<"retail-unit-economics"> {
  readonly matureStoreCount: number;
  readonly annualRevenuePerStoreCr: number;
  readonly storeEbitdaMargin: number;
  readonly centralCostsCr: number;
  readonly maintenanceCapexPerStoreCr: number;
  readonly cashTaxRate: number;
  readonly costOfOperations: number;
  readonly terminalGrowth: number;
  readonly netDebtCr: number;
}

export type SectorCaseInput =
  | UtilityRabCaseInput
  | TelecomNetworkCaseInput
  | BankEquityCaseInput
  | NbfcFundingCaseInput
  | InsuranceEmbeddedValueCaseInput
  | ConglomerateSotpCaseInput
  | CyclicalMidCycleCaseInput
  | RetailUnitEconomicsCaseInput;

export interface SectorCaseDefinition<TCaseType extends SectorCaseType = SectorCaseType> {
  readonly caseType: TCaseType;
  readonly label: string;
  readonly modelId: string;
  readonly inputContract: string;
  readonly companyTypes: readonly Exclude<CompanyType, "auto">[];
  readonly requiredEvidenceIds: readonly string[];
  readonly description: string;
}

export type SectorCaseEligibility =
  | {
      readonly status: "eligible";
      readonly caseType: SectorCaseType;
      readonly modelId: string;
      readonly satisfiedEvidenceIds: readonly string[];
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly status: "not-applicable" | "insufficient-evidence" | "invalid-input";
      readonly caseType: SectorCaseType;
      readonly modelId: string;
      readonly reasonCodes: readonly string[];
      readonly missingEvidenceIds: readonly string[];
      readonly summary: string;
    };

export interface SectorCaseComputedResult {
  readonly schemaVersion: typeof SECTOR_CASE_SCHEMA_VERSION;
  readonly status: "computed";
  readonly caseType: SectorCaseType;
  readonly issuerId: string;
  readonly asOf: string;
  readonly modelId: string;
  readonly eligibility: Extract<SectorCaseEligibility, { status: "eligible" }>;
  readonly enterpriseValueCr: number | null;
  readonly equityValueCr: number;
  readonly perShareInr: number;
  readonly evidenceRefs: readonly string[];
  readonly transformationRefs: readonly string[];
  readonly diagnostics: Readonly<Record<string, number | string | boolean | null>>;
  readonly guardResults: readonly ModelGuardResult[];
}

export interface SectorCaseBlockedResult {
  readonly schemaVersion: typeof SECTOR_CASE_SCHEMA_VERSION;
  readonly status: "blocked";
  readonly caseType: SectorCaseType;
  readonly issuerId: string;
  readonly asOf: string;
  readonly modelId: string;
  readonly eligibility: Exclude<SectorCaseEligibility, { status: "eligible" }>;
  readonly reasonCodes: readonly string[];
  /** Guard evidence is retained when an otherwise eligible computation fails. */
  readonly guardResults: readonly ModelGuardResult[];
}

export type SectorCaseResult = SectorCaseComputedResult | SectorCaseBlockedResult;

/** Immutable link between a sector-case contract and its catalog definition. */
export interface SectorCaseCatalogBinding {
  readonly caseType: SectorCaseType;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly caseInputContract: string;
  readonly catalogInputContract: string;
  readonly catalogVersion: string;
}

export interface SectorCaseCatalogExecutionRequest {
  /** A valuation catalog ID, never a strategy or route label. */
  readonly modelId: string;
  /** Runtime validation is required because requests may cross worker/API boundaries. */
  readonly input: unknown;
}

type ComputedCatalogModelResult = Extract<import("../modelCatalog").ValuationModelResult, { status: "computed" }>;
type NonComputedCatalogModelResult = Exclude<import("../modelCatalog").ValuationModelResult, { status: "computed" }>;

/**
 * Result of executing a sector model through its catalog address.
 *
 * Unknown/non-sector model IDs are rejected without fabricating a model result.
 * A known binding always returns a canonical non-computed result when validation
 * or a model guard blocks publication.
 */
export type SectorCaseCatalogExecutionResult =
  | {
      readonly schemaVersion: typeof SECTOR_CASE_EXECUTION_SCHEMA_VERSION;
      readonly status: "computed";
      readonly requestedModelId: string;
      readonly binding: SectorCaseCatalogBinding;
      readonly reasonCodes: readonly [];
      readonly caseResult: SectorCaseComputedResult;
      readonly modelResult: ComputedCatalogModelResult;
    }
  | {
      readonly schemaVersion: typeof SECTOR_CASE_EXECUTION_SCHEMA_VERSION;
      readonly status: "blocked";
      readonly requestedModelId: string;
      readonly binding: SectorCaseCatalogBinding;
      readonly reasonCodes: readonly string[];
      readonly caseResult: SectorCaseBlockedResult | null;
      readonly modelResult: NonComputedCatalogModelResult;
    }
  | {
      readonly schemaVersion: typeof SECTOR_CASE_EXECUTION_SCHEMA_VERSION;
      readonly status: "rejected";
      readonly requestedModelId: string;
      readonly binding: null;
      readonly reasonCodes: readonly string[];
      readonly caseResult: null;
      readonly modelResult: null;
    };

/** Minimal serializable shape consumed by the maturity scorecard. */
export interface SectorNativeCreditResult {
  readonly caseType: SectorCaseType;
  readonly modelId: string;
  readonly status: "computed" | "blocked";
  readonly eligibilityStatus: SectorCaseEligibility["status"];
  readonly enterpriseValueCr: number | null;
  readonly equityValueCr: number | null;
  readonly perShareInr: number | null;
  readonly satisfiedEvidenceIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly blockingGuardCount: number;
}

export interface SectorNativeCreditDecision {
  readonly credited: boolean;
  readonly modelId: string;
  readonly lifecycle: ValuationModelLifecycle | "unregistered";
  readonly reasonCode:
    | "credited"
    | "model-unregistered"
    | "model-not-production"
    | "case-model-mismatch"
    | "result-not-computed"
    | "case-not-eligible"
    | "non-finite-output";
}
