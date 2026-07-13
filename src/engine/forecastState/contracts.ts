/** Schema for balanced industrial projected financial states. */
export const FORECAST_STATE_SCHEMA_VERSION = "2026-07-industrial-forecast-state-v1" as const;

export type ForecastProbabilityStatus = "calibrated" | "heuristic" | "not-assigned";
export type IndustrialScenarioKey = "stress" | "base" | "bull" | "custom";

/** Historical opening balances. This is intentionally not RecastPeriod: only
 * explicit forecast-opening facts cross the historical/projected boundary.
 */
export interface IndustrialForecastAnchor {
  readonly anchorId: string;
  readonly periodEnd: string;
  readonly revenue: number;
  readonly balanceSheet: {
    readonly cash: number;
    readonly otherFinancialAssets: number;
    readonly workingCapitalAssets: number;
    readonly ppe: number;
    readonly rightOfUseAssets: number;
    readonly intangibles: number;
    readonly goodwill: number;
    readonly otherOperatingAssets: number;
    readonly operatingLiabilities: number;
    readonly debt: number;
    readonly leaseLiabilities: number;
    readonly otherFinancialObligations: number;
    readonly contributedCapital: number;
    readonly retainedEarnings: number;
    readonly accumulatedOci: number;
    readonly commonEquity: number;
    readonly minorityInterest: number;
  };
  readonly shares: {
    readonly endPeriod: number;
    readonly diluted: number;
  };
  readonly evidenceRefs: readonly string[];
}

/** Explicit assumptions for one projected year. No field is inherited from a
 * historical period and no cash-flow object can be carried forward.
 */
export interface IndustrialForecastYearDrivers {
  readonly yearOffset: number;
  readonly revenueGrowth: number;
  readonly operatingMargin: number;
  readonly assetTurnover: number;
  readonly taxRate: number;
  readonly workingCapitalAssetPctRevenue: number;
  readonly operatingLiabilityPctRevenue: number;
  readonly otherOperatingAssetPctRevenue: number;
  readonly depreciationRate: number;
  readonly amortizationRate: number;
  readonly intangibleInvestmentPctRevenue: number;
  readonly rightOfUseAssetAdditions: number;
  readonly rightOfUseDepreciationRate: number;
  readonly costOfDebtPretax: number;
  readonly financialAssetYieldPretax: number;
  readonly debtIssuance: number;
  readonly debtRepayment: number;
  readonly leaseLiabilityAdditions: number;
  readonly leasePrincipalRepayment: number;
  readonly otherFinancialObligationChange: number;
  readonly dividendPayoutRatio: number;
  readonly buybacks: number;
  readonly shareIssueProceeds: number;
  readonly sharesIssued: number;
  readonly sharesRepurchased: number;
  readonly dilutionOverhangShares: number;
  readonly financialAssetPurchases: number;
  readonly financialAssetSales: number;
  /** OCI and the matching financial-asset fair-value movement are separate so
   * validation can reject an unbalanced non-cash equity movement.
   */
  readonly ownerOci: number;
  readonly minorityOci: number;
  readonly financialAssetFairValueChange: number;
  readonly minorityIncomeShare: number;
  readonly minorityContributions: number;
  readonly minorityDistributions: number;
}

export interface IndustrialTerminalAssumptions {
  readonly growth: number;
  readonly roic: number;
  readonly reinvestmentRate: number;
  readonly ke: number;
  readonly kw: number;
  readonly minimumDiscountGrowthSpread: number;
}

export interface IndustrialForecastRequest {
  readonly caseId: string;
  readonly label: string;
  readonly scenarioKey: IndustrialScenarioKey;
  readonly analysisWindowId: string;
  readonly assumptionIds: readonly string[];
  readonly anchor: IndustrialForecastAnchor;
  readonly drivers: readonly IndustrialForecastYearDrivers[];
  readonly terminal: IndustrialTerminalAssumptions;
  readonly probability: number | null;
  readonly probabilityStatus: ForecastProbabilityStatus;
  readonly probabilityEvidenceRefs: readonly string[];
  readonly probabilityRationale: string | null;
}

export interface IndustrialProjectedBalanceSheet {
  readonly financialAssets: {
    readonly cash: number;
    readonly other: number;
    readonly total: number;
  };
  readonly operatingAssets: {
    readonly workingCapital: number;
    readonly ppe: number;
    readonly rightOfUse: number;
    readonly intangibles: number;
    readonly goodwill: number;
    readonly other: number;
    readonly total: number;
  };
  readonly totalAssets: number;
  readonly operatingLiabilities: number;
  readonly financialObligations: {
    readonly debt: number;
    readonly leaseLiabilities: number;
    readonly other: number;
    readonly total: number;
  };
  readonly commonEquity: {
    readonly contributedCapital: number;
    readonly retainedEarnings: number;
    readonly accumulatedOci: number;
    readonly total: number;
  };
  readonly minorityInterest: number;
  readonly totalLiabilities: number;
  readonly totalEquity: number;
  readonly totalLiabilitiesAndEquity: number;
  readonly noa: number;
  readonly nfo: number;
}

export interface IndustrialProjectedIncomeStatement {
  readonly revenue: number;
  readonly operatingMargin: number;
  readonly operatingProfitPretax: number;
  readonly taxOnOperatingIncome: number;
  readonly operatingIncomeAfterTax: number;
  readonly financeExpensePretax: number;
  readonly financeIncomePretax: number;
  readonly netFinancingExpensePretax: number;
  readonly netFinancingExpenseAfterTax: number;
  readonly netIncomeTotal: number;
  readonly commonNetIncome: number;
  readonly minorityNetIncome: number;
}

export interface IndustrialProjectedCashFlowStatement {
  readonly cashFromOperations: number;
  readonly capitalExpenditure: number;
  readonly maintenanceCapex: number;
  readonly growthCapex: number;
  readonly ppeDisposals: number;
  readonly intangibleInvestment: number;
  readonly otherOperatingAssetInvestment: number;
  readonly financialAssetPurchases: number;
  readonly financialAssetSales: number;
  readonly cashFromInvesting: number;
  readonly debtIssuance: number;
  readonly debtRepayment: number;
  readonly leasePrincipalRepayment: number;
  readonly dividends: number;
  readonly buybacks: number;
  readonly shareIssueProceeds: number;
  readonly minorityContributions: number;
  readonly minorityDistributions: number;
  readonly cashFromFinancing: number;
  readonly netCashMovement: number;
  readonly openingCash: number;
  readonly endingCash: number;
  readonly fcff: number;
  readonly ownerEarnings: number;
}

export interface IndustrialForecastDiagnostics {
  readonly revenueGrowth: number;
  readonly assetTurnover: number;
  readonly deltaNoa: number;
  readonly roic: number | null;
  readonly reinvestmentRate: number | null;
  readonly cashBridgeResidual: number;
  readonly balanceSheetResidual: number;
  readonly noaDefinitionResidual: number;
  readonly nfoDefinitionResidual: number;
  readonly noaFinancingBridgeResidual: number;
}

/** Projected state deliberately contains no historical trace/quality/spec
 * flags and no RecastPeriod `cf` property.
 */
export interface IndustrialProjectedState {
  readonly schemaVersion: typeof FORECAST_STATE_SCHEMA_VERSION;
  readonly stateId: string;
  readonly caseId: string;
  readonly yearOffset: number;
  readonly periodEnd: string;
  readonly previousStateRef: string;
  readonly assumptions: IndustrialForecastYearDrivers;
  readonly balanceSheet: IndustrialProjectedBalanceSheet;
  readonly incomeStatement: IndustrialProjectedIncomeStatement;
  readonly cashFlow: IndustrialProjectedCashFlowStatement;
  readonly shares: {
    readonly opening: number;
    readonly issued: number;
    readonly repurchased: number;
    readonly endPeriod: number;
    readonly diluted: number;
  };
  readonly diagnostics: IndustrialForecastDiagnostics;
  readonly transformationRefs: readonly string[];
}

export type ForecastValidationStatus = "passed" | "failed";

export interface ForecastValidationCheck {
  readonly checkId: string;
  readonly stateId: string | null;
  readonly status: ForecastValidationStatus;
  readonly observed: number | string | boolean | null;
  readonly expected: number | string | boolean | null;
  readonly tolerance: number | null;
  readonly summary: string;
}

export interface ForecastValidationReport {
  readonly status: ForecastValidationStatus;
  readonly checks: readonly ForecastValidationCheck[];
  readonly blockingCheckIds: readonly string[];
  readonly summary: string;
}

export interface TerminalEconomicsDiagnostic {
  readonly growth: number;
  readonly reinvestmentRate: number;
  readonly roic: number;
  readonly growthImpliedByReinvestment: number;
  readonly consistencyResidual: number;
  readonly keSpread: number;
  readonly kwSpread: number;
  readonly minimumRequiredSpread: number;
}

export interface IndustrialForecastCase {
  readonly caseId: string;
  readonly label: string;
  readonly scenarioKey: IndustrialScenarioKey;
  readonly family: "industrial";
  readonly analysisWindowId: string;
  readonly assumptionIds: readonly string[];
  readonly horizonYears: number;
  readonly probability: number | null;
  readonly probabilityStatus: ForecastProbabilityStatus;
  readonly probabilityEvidenceRefs: readonly string[];
  readonly probabilityRationale: string | null;
  readonly projected: readonly IndustrialProjectedState[];
  readonly terminal: TerminalEconomicsDiagnostic;
  readonly validation: ForecastValidationReport;
  readonly transformationRefs: readonly string[];
}

export type IndustrialForecastResult =
  | {
      readonly status: "computed";
      readonly forecastCase: IndustrialForecastCase;
    }
  | {
      readonly status: "blocked";
      readonly caseId: string;
      readonly reasonCodes: readonly string[];
      readonly projected: readonly IndustrialProjectedState[];
      readonly validation: ForecastValidationReport;
    };

export interface ScenarioOrderingReport {
  readonly status: "passed" | "failed" | "not-applicable";
  readonly checks: readonly ForecastValidationCheck[];
  readonly summary: string;
}
