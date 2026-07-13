import {
  FORECAST_STATE_SCHEMA_VERSION,
  type ForecastValidationCheck,
  type IndustrialForecastAnchor,
  type IndustrialForecastCase,
  type IndustrialForecastRequest,
  type IndustrialForecastResult,
  type IndustrialForecastYearDrivers,
  type IndustrialProjectedState,
  type TerminalEconomicsDiagnostic,
} from "./contracts";
import {
  buildForecastValidationReport,
  mergeForecastValidationReports,
  validateIndustrialForecastRequest,
  validateIndustrialProjectedStates,
} from "./validation";

interface OpeningProjectionState {
  readonly stateRef: string;
  readonly revenue: number;
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
  readonly endShares: number;
  readonly dilutedShares: number;
  readonly noa: number;
}

function periodEndForOffset(periodEnd: string, offset: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodEnd);
  if (!match) throw new Error(`Invalid anchor periodEnd '${periodEnd}'.`);
  return `${Number(match[1]) + offset}-${match[2]}-${match[3]}`;
}

function openingFromAnchor(anchor: IndustrialForecastAnchor): OpeningProjectionState {
  const bs = anchor.balanceSheet;
  const operatingAssets = bs.workingCapitalAssets + bs.ppe + bs.rightOfUseAssets + bs.intangibles + bs.goodwill + bs.otherOperatingAssets;
  return {
    stateRef: anchor.anchorId,
    revenue: anchor.revenue,
    cash: bs.cash,
    otherFinancialAssets: bs.otherFinancialAssets,
    workingCapitalAssets: bs.workingCapitalAssets,
    ppe: bs.ppe,
    rightOfUseAssets: bs.rightOfUseAssets,
    intangibles: bs.intangibles,
    goodwill: bs.goodwill,
    otherOperatingAssets: bs.otherOperatingAssets,
    operatingLiabilities: bs.operatingLiabilities,
    debt: bs.debt,
    leaseLiabilities: bs.leaseLiabilities,
    otherFinancialObligations: bs.otherFinancialObligations,
    contributedCapital: bs.contributedCapital,
    retainedEarnings: bs.retainedEarnings,
    accumulatedOci: bs.accumulatedOci,
    commonEquity: bs.commonEquity,
    minorityInterest: bs.minorityInterest,
    endShares: anchor.shares.endPeriod,
    dilutedShares: anchor.shares.diluted,
    noa: operatingAssets - bs.operatingLiabilities,
  };
}

function openingFromProjected(state: IndustrialProjectedState): OpeningProjectionState {
  const bs = state.balanceSheet;
  return {
    stateRef: state.stateId,
    revenue: state.incomeStatement.revenue,
    cash: bs.financialAssets.cash,
    otherFinancialAssets: bs.financialAssets.other,
    workingCapitalAssets: bs.operatingAssets.workingCapital,
    ppe: bs.operatingAssets.ppe,
    rightOfUseAssets: bs.operatingAssets.rightOfUse,
    intangibles: bs.operatingAssets.intangibles,
    goodwill: bs.operatingAssets.goodwill,
    otherOperatingAssets: bs.operatingAssets.other,
    operatingLiabilities: bs.operatingLiabilities,
    debt: bs.financialObligations.debt,
    leaseLiabilities: bs.financialObligations.leaseLiabilities,
    otherFinancialObligations: bs.financialObligations.other,
    contributedCapital: bs.commonEquity.contributedCapital,
    retainedEarnings: bs.commonEquity.retainedEarnings,
    accumulatedOci: bs.commonEquity.accumulatedOci,
    commonEquity: bs.commonEquity.total,
    minorityInterest: bs.minorityInterest,
    endShares: state.shares.endPeriod,
    dilutedShares: state.shares.diluted,
    noa: bs.noa,
  };
}

function freezeProjectedState(state: IndustrialProjectedState): IndustrialProjectedState {
  Object.freeze(state.assumptions);
  Object.freeze(state.balanceSheet.financialAssets);
  Object.freeze(state.balanceSheet.operatingAssets);
  Object.freeze(state.balanceSheet.financialObligations);
  Object.freeze(state.balanceSheet.commonEquity);
  Object.freeze(state.balanceSheet);
  Object.freeze(state.incomeStatement);
  Object.freeze(state.cashFlow);
  Object.freeze(state.shares);
  Object.freeze(state.diagnostics);
  Object.freeze(state.transformationRefs);
  return Object.freeze(state);
}

function buildProjectedState(args: {
  readonly request: IndustrialForecastRequest;
  readonly previous: OpeningProjectionState;
  readonly driver: IndustrialForecastYearDrivers;
}): IndustrialProjectedState {
  const { request, previous, driver } = args;
  const revenue = previous.revenue * (1 + driver.revenueGrowth);
  const targetNoa = revenue / driver.assetTurnover;
  const workingCapitalAssets = revenue * driver.workingCapitalAssetPctRevenue;
  const operatingLiabilities = revenue * driver.operatingLiabilityPctRevenue;
  const otherOperatingAssets = revenue * driver.otherOperatingAssetPctRevenue;
  const otherOperatingAssetInvestment = otherOperatingAssets - previous.otherOperatingAssets;

  const depreciation = previous.ppe * driver.depreciationRate;
  const amortization = previous.intangibles * driver.amortizationRate;
  const rightOfUseDepreciation = previous.rightOfUseAssets * driver.rightOfUseDepreciationRate;
  const intangibleInvestment = revenue * driver.intangibleInvestmentPctRevenue;
  const intangibles = previous.intangibles + intangibleInvestment - amortization;
  const rightOfUseAssets = previous.rightOfUseAssets + driver.rightOfUseAssetAdditions - rightOfUseDepreciation;
  const targetOperatingAssets = targetNoa + operatingLiabilities;
  const ppe = targetOperatingAssets
    - workingCapitalAssets
    - rightOfUseAssets
    - intangibles
    - previous.goodwill
    - otherOperatingAssets;
  const grossPpeInvestment = ppe - previous.ppe + depreciation;
  const capitalExpenditure = Math.max(0, grossPpeInvestment);
  const ppeDisposals = Math.max(0, -grossPpeInvestment);
  const maintenanceCapex = Math.min(capitalExpenditure, Math.max(0, depreciation));
  const growthCapex = Math.max(0, capitalExpenditure - maintenanceCapex);

  const operatingAssets = workingCapitalAssets + ppe + rightOfUseAssets + intangibles + previous.goodwill + otherOperatingAssets;
  const noa = operatingAssets - operatingLiabilities;
  const deltaNoa = noa - previous.noa;

  const debt = previous.debt + driver.debtIssuance - driver.debtRepayment;
  const leaseLiabilities = previous.leaseLiabilities + driver.leaseLiabilityAdditions - driver.leasePrincipalRepayment;
  const otherFinancialObligations = previous.otherFinancialObligations + driver.otherFinancialObligationChange;
  const financialObligations = debt + leaseLiabilities + otherFinancialObligations;
  const openingFinancialObligations = previous.debt + previous.leaseLiabilities + previous.otherFinancialObligations;

  const otherFinancialAssets = previous.otherFinancialAssets
    + driver.financialAssetPurchases
    - driver.financialAssetSales
    + driver.financialAssetFairValueChange;

  const operatingProfitPretax = revenue * driver.operatingMargin;
  const taxOnOperatingIncome = operatingProfitPretax * driver.taxRate;
  const operatingIncomeAfterTax = operatingProfitPretax - taxOnOperatingIncome;
  const financeExpensePretax = ((openingFinancialObligations + financialObligations) / 2) * driver.costOfDebtPretax;
  const averageFinancialAssetsBeforeCashClose = (
    previous.cash
    + previous.otherFinancialAssets
    + previous.cash
    + otherFinancialAssets
  ) / 2;
  const financeIncomePretax = averageFinancialAssetsBeforeCashClose * driver.financialAssetYieldPretax;
  const netFinancingExpensePretax = financeExpensePretax - financeIncomePretax;
  const netFinancingExpenseAfterTax = netFinancingExpensePretax * (1 - driver.taxRate);
  const netIncomeTotal = operatingIncomeAfterTax - netFinancingExpenseAfterTax;
  const minorityNetIncome = netIncomeTotal * driver.minorityIncomeShare;
  const commonNetIncome = netIncomeTotal - minorityNetIncome;

  const dividends = Math.max(0, commonNetIncome) * driver.dividendPayoutRatio;
  const retainedEarnings = previous.retainedEarnings + commonNetIncome - dividends;
  const contributedCapital = previous.contributedCapital + driver.shareIssueProceeds - driver.buybacks;
  const accumulatedOci = previous.accumulatedOci + driver.ownerOci;
  const commonEquity = contributedCapital + retainedEarnings + accumulatedOci;
  const minorityInterest = previous.minorityInterest
    + minorityNetIncome
    + driver.minorityOci
    + driver.minorityContributions
    - driver.minorityDistributions;

  const cashFromOperations = netIncomeTotal
    + depreciation
    + amortization
    + rightOfUseDepreciation
    - (workingCapitalAssets - previous.workingCapitalAssets)
    + (operatingLiabilities - previous.operatingLiabilities);
  const cashFromInvesting = -capitalExpenditure
    + ppeDisposals
    - intangibleInvestment
    - otherOperatingAssetInvestment
    - driver.financialAssetPurchases
    + driver.financialAssetSales;
  const cashFromFinancing = driver.debtIssuance
    - driver.debtRepayment
    - driver.leasePrincipalRepayment
    + driver.otherFinancialObligationChange
    - dividends
    - driver.buybacks
    + driver.shareIssueProceeds
    + driver.minorityContributions
    - driver.minorityDistributions;
  const netCashMovement = cashFromOperations + cashFromInvesting + cashFromFinancing;
  const cash = previous.cash + netCashMovement;

  const financialAssets = cash + otherFinancialAssets;
  const totalAssets = financialAssets + operatingAssets;
  const totalLiabilities = operatingLiabilities + financialObligations;
  const totalEquity = commonEquity + minorityInterest;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  const nfo = financialObligations - financialAssets;

  const endShares = previous.endShares + driver.sharesIssued - driver.sharesRepurchased;
  const dilutedShares = endShares + driver.dilutionOverhangShares;
  const averageNoa = (previous.noa + noa) / 2;
  const roic = averageNoa !== 0 ? operatingIncomeAfterTax / averageNoa : null;
  const reinvestmentRate = operatingIncomeAfterTax !== 0 ? deltaNoa / operatingIncomeAfterTax : null;
  const fcff = operatingIncomeAfterTax - deltaNoa;
  const ownerEarnings = cashFromOperations - maintenanceCapex;
  const periodEnd = periodEndForOffset(request.anchor.periodEnd, driver.yearOffset);
  const stateId = `${request.caseId}:${periodEnd}`;

  return freezeProjectedState({
    schemaVersion: FORECAST_STATE_SCHEMA_VERSION,
    stateId,
    caseId: request.caseId,
    yearOffset: driver.yearOffset,
    periodEnd,
    previousStateRef: previous.stateRef,
    assumptions: { ...driver },
    balanceSheet: {
      financialAssets: { cash, other: otherFinancialAssets, total: financialAssets },
      operatingAssets: {
        workingCapital: workingCapitalAssets,
        ppe,
        rightOfUse: rightOfUseAssets,
        intangibles,
        goodwill: previous.goodwill,
        other: otherOperatingAssets,
        total: operatingAssets,
      },
      totalAssets,
      operatingLiabilities,
      financialObligations: {
        debt,
        leaseLiabilities,
        other: otherFinancialObligations,
        total: financialObligations,
      },
      commonEquity: {
        contributedCapital,
        retainedEarnings,
        accumulatedOci,
        total: commonEquity,
      },
      minorityInterest,
      totalLiabilities,
      totalEquity,
      totalLiabilitiesAndEquity,
      noa,
      nfo,
    },
    incomeStatement: {
      revenue,
      operatingMargin: driver.operatingMargin,
      operatingProfitPretax,
      taxOnOperatingIncome,
      operatingIncomeAfterTax,
      financeExpensePretax,
      financeIncomePretax,
      netFinancingExpensePretax,
      netFinancingExpenseAfterTax,
      netIncomeTotal,
      commonNetIncome,
      minorityNetIncome,
    },
    cashFlow: {
      cashFromOperations,
      capitalExpenditure,
      maintenanceCapex,
      growthCapex,
      ppeDisposals,
      intangibleInvestment,
      otherOperatingAssetInvestment,
      financialAssetPurchases: driver.financialAssetPurchases,
      financialAssetSales: driver.financialAssetSales,
      cashFromInvesting,
      debtIssuance: driver.debtIssuance,
      debtRepayment: driver.debtRepayment,
      leasePrincipalRepayment: driver.leasePrincipalRepayment,
      dividends,
      buybacks: driver.buybacks,
      shareIssueProceeds: driver.shareIssueProceeds,
      minorityContributions: driver.minorityContributions,
      minorityDistributions: driver.minorityDistributions,
      cashFromFinancing,
      netCashMovement,
      openingCash: previous.cash,
      endingCash: cash,
      fcff,
      ownerEarnings,
    },
    shares: {
      opening: previous.endShares,
      issued: driver.sharesIssued,
      repurchased: driver.sharesRepurchased,
      endPeriod: endShares,
      diluted: dilutedShares,
    },
    diagnostics: {
      revenueGrowth: driver.revenueGrowth,
      assetTurnover: driver.assetTurnover,
      deltaNoa,
      roic,
      reinvestmentRate,
      cashBridgeResidual: cash - previous.cash - netCashMovement,
      balanceSheetResidual: totalAssets - totalLiabilitiesAndEquity,
      noaDefinitionResidual: noa - (operatingAssets - operatingLiabilities),
      nfoDefinitionResidual: nfo - (financialObligations - financialAssets),
      noaFinancingBridgeResidual: noa - commonEquity - minorityInterest - nfo,
    },
    transformationRefs: Object.freeze([
      `forecast:${request.caseId}:${driver.yearOffset}:revenue`,
      `forecast:${request.caseId}:${driver.yearOffset}:operating-income`,
      `forecast:${request.caseId}:${driver.yearOffset}:balance-sheet`,
      `forecast:${request.caseId}:${driver.yearOffset}:cash-flow`,
    ]),
  });
}

function terminalDiagnostic(request: IndustrialForecastRequest): TerminalEconomicsDiagnostic {
  const terminal = request.terminal;
  const growthImpliedByReinvestment = terminal.reinvestmentRate * terminal.roic;
  return Object.freeze({
    growth: terminal.growth,
    reinvestmentRate: terminal.reinvestmentRate,
    roic: terminal.roic,
    growthImpliedByReinvestment,
    consistencyResidual: terminal.growth - growthImpliedByReinvestment,
    keSpread: terminal.ke - terminal.growth,
    kwSpread: terminal.kw - terminal.growth,
    minimumRequiredSpread: terminal.minimumDiscountGrowthSpread,
  });
}

function unexpectedFailureCheck(error: unknown): ForecastValidationCheck {
  return {
    checkId: "forecast.unexpected-build-error",
    stateId: null,
    status: "failed",
    observed: error instanceof Error ? error.message : String(error),
    expected: "balanced projected state",
    tolerance: null,
    summary: "Forecast construction failed before a valid state could be published.",
  };
}

/** Build an explicit balanced industrial forecast or fail closed. */
export function buildIndustrialForecast(request: IndustrialForecastRequest): IndustrialForecastResult {
  const inputValidation = validateIndustrialForecastRequest(request);
  if (inputValidation.status === "failed") {
    return {
      status: "blocked",
      caseId: request?.caseId ?? "unknown",
      reasonCodes: inputValidation.blockingCheckIds,
      projected: [],
      validation: inputValidation,
    };
  }

  try {
    const projected: IndustrialProjectedState[] = [];
    let previous = openingFromAnchor(request.anchor);
    for (const driver of request.drivers) {
      const state = buildProjectedState({ request, previous, driver });
      projected.push(state);
      previous = openingFromProjected(state);
    }

    const terminal = terminalDiagnostic(request);
    const outputValidation = validateIndustrialProjectedStates(request.anchor, projected, terminal);
    const validation = mergeForecastValidationReports(inputValidation, outputValidation);
    if (validation.status === "failed") {
      return {
        status: "blocked",
        caseId: request.caseId,
        reasonCodes: validation.blockingCheckIds,
        projected: Object.freeze([...projected]),
        validation,
      };
    }

    const transformationRefs = Object.freeze(projected.flatMap((state) => state.transformationRefs));
    const forecastCase: IndustrialForecastCase = Object.freeze({
      caseId: request.caseId,
      label: request.label,
      scenarioKey: request.scenarioKey,
      family: "industrial",
      analysisWindowId: request.analysisWindowId,
      assumptionIds: Object.freeze([...request.assumptionIds]),
      horizonYears: projected.length,
      probability: request.probability,
      probabilityStatus: request.probabilityStatus,
      probabilityEvidenceRefs: Object.freeze([...request.probabilityEvidenceRefs]),
      probabilityRationale: request.probabilityRationale,
      projected: Object.freeze([...projected]),
      terminal,
      validation,
      transformationRefs,
    });
    return { status: "computed", forecastCase };
  } catch (error) {
    const validation = mergeForecastValidationReports(
      inputValidation,
      buildForecastValidationReport([unexpectedFailureCheck(error)]),
    );
    return {
      status: "blocked",
      caseId: request.caseId,
      reasonCodes: validation.blockingCheckIds,
      projected: [],
      validation,
    };
  }
}
