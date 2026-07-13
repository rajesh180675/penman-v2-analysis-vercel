import type {
  ForecastValidationCheck,
  ForecastValidationReport,
  IndustrialForecastAnchor,
  IndustrialForecastRequest,
  IndustrialForecastYearDrivers,
  IndustrialProjectedState,
  IndustrialTerminalAssumptions,
  TerminalEconomicsDiagnostic,
} from "./contracts";

const ABSOLUTE_TOLERANCE = 1e-8;
const TERMINAL_IDENTITY_TOLERANCE = 1e-6;

const DRIVER_FIELDS = [
  "yearOffset",
  "revenueGrowth",
  "operatingMargin",
  "assetTurnover",
  "taxRate",
  "workingCapitalAssetPctRevenue",
  "operatingLiabilityPctRevenue",
  "otherOperatingAssetPctRevenue",
  "depreciationRate",
  "amortizationRate",
  "intangibleInvestmentPctRevenue",
  "rightOfUseAssetAdditions",
  "rightOfUseDepreciationRate",
  "costOfDebtPretax",
  "financialAssetYieldPretax",
  "debtIssuance",
  "debtRepayment",
  "leaseLiabilityAdditions",
  "leasePrincipalRepayment",
  "otherFinancialObligationChange",
  "dividendPayoutRatio",
  "buybacks",
  "shareIssueProceeds",
  "sharesIssued",
  "sharesRepurchased",
  "dilutionOverhangShares",
  "financialAssetPurchases",
  "financialAssetSales",
  "ownerOci",
  "minorityOci",
  "financialAssetFairValueChange",
  "minorityIncomeShare",
  "minorityContributions",
  "minorityDistributions",
] as const satisfies readonly (keyof IndustrialForecastYearDrivers)[];

const ANCHOR_BALANCE_FIELDS = [
  "cash",
  "otherFinancialAssets",
  "workingCapitalAssets",
  "ppe",
  "rightOfUseAssets",
  "intangibles",
  "goodwill",
  "otherOperatingAssets",
  "operatingLiabilities",
  "debt",
  "leaseLiabilities",
  "otherFinancialObligations",
  "contributedCapital",
  "retainedEarnings",
  "accumulatedOci",
  "commonEquity",
  "minorityInterest",
] as const satisfies readonly (keyof IndustrialForecastAnchor["balanceSheet"])[];

function scaleTolerance(values: readonly number[]): number {
  return ABSOLUTE_TOLERANCE * Math.max(1, ...values.map((value) => Math.abs(value)));
}

function passed(
  checkId: string,
  stateId: string | null,
  observed: ForecastValidationCheck["observed"],
  expected: ForecastValidationCheck["expected"],
  tolerance: number | null,
  summary: string,
): ForecastValidationCheck {
  return { checkId, stateId, status: "passed", observed, expected, tolerance, summary };
}

function failed(
  checkId: string,
  stateId: string | null,
  observed: ForecastValidationCheck["observed"],
  expected: ForecastValidationCheck["expected"],
  tolerance: number | null,
  summary: string,
): ForecastValidationCheck {
  return { checkId, stateId, status: "failed", observed, expected, tolerance, summary };
}

function booleanCheck(
  checkId: string,
  condition: boolean,
  summary: string,
  stateId: string | null = null,
): ForecastValidationCheck {
  return condition
    ? passed(checkId, stateId, true, true, null, summary)
    : failed(checkId, stateId, false, true, null, summary);
}

function residualCheck(
  checkId: string,
  stateId: string | null,
  residual: number,
  scaleValues: readonly number[],
  summary: string,
): ForecastValidationCheck {
  const tolerance = scaleTolerance(scaleValues);
  return Number.isFinite(residual) && Math.abs(residual) <= tolerance
    ? passed(checkId, stateId, residual, 0, tolerance, summary)
    : failed(checkId, stateId, residual, 0, tolerance, summary);
}

export function buildForecastValidationReport(checks: readonly ForecastValidationCheck[]): ForecastValidationReport {
  const blockingCheckIds = checks.filter((check) => check.status === "failed").map((check) => check.checkId);
  return {
    status: blockingCheckIds.length > 0 ? "failed" : "passed",
    checks: [...checks],
    blockingCheckIds,
    summary: blockingCheckIds.length > 0
      ? `${blockingCheckIds.length} forecast validation check(s) failed.`
      : `${checks.length} forecast validation check(s) passed.`,
  };
}

function anchorChecks(anchor: IndustrialForecastAnchor): ForecastValidationCheck[] {
  const checks: ForecastValidationCheck[] = [];
  const bs = anchor?.balanceSheet;
  checks.push(booleanCheck("anchor.present", Boolean(anchor && bs), "Forecast anchor and opening balance sheet must be present."));
  if (!anchor || !bs) return checks;

  for (const field of ANCHOR_BALANCE_FIELDS) {
    checks.push(booleanCheck(
      `anchor.finite.${field}`,
      Number.isFinite(bs[field]),
      `Opening ${field} must be finite.`,
    ));
  }
  checks.push(booleanCheck("anchor.finite.revenue", Number.isFinite(anchor.revenue) && anchor.revenue > 0, "Opening revenue must be finite and positive."));
  checks.push(booleanCheck("anchor.shares.end-positive", Number.isFinite(anchor.shares?.endPeriod) && anchor.shares.endPeriod > 0, "Opening end-period shares must be positive."));
  checks.push(booleanCheck("anchor.shares.diluted-positive", Number.isFinite(anchor.shares?.diluted) && anchor.shares.diluted > 0, "Opening diluted shares must be positive."));

  const operatingAssets = bs.workingCapitalAssets + bs.ppe + bs.rightOfUseAssets + bs.intangibles + bs.goodwill + bs.otherOperatingAssets;
  const financialAssets = bs.cash + bs.otherFinancialAssets;
  const financialObligations = bs.debt + bs.leaseLiabilities + bs.otherFinancialObligations;
  const totalAssets = financialAssets + operatingAssets;
  const totalLiabilitiesAndEquity = bs.operatingLiabilities + financialObligations + bs.commonEquity + bs.minorityInterest;
  const noa = operatingAssets - bs.operatingLiabilities;
  const nfo = financialObligations - financialAssets;
  checks.push(residualCheck("anchor.balance-sheet", null, totalAssets - totalLiabilitiesAndEquity, [totalAssets, totalLiabilitiesAndEquity], "Opening assets must equal liabilities plus equity."));
  checks.push(residualCheck("anchor.common-equity-components", null, bs.commonEquity - bs.contributedCapital - bs.retainedEarnings - bs.accumulatedOci, [bs.commonEquity], "Opening common equity must equal contributed capital, retained earnings, and accumulated OCI."));
  checks.push(residualCheck("anchor.noa-nfo-bridge", null, noa - bs.commonEquity - bs.minorityInterest - nfo, [noa, bs.commonEquity, nfo], "Opening NOA must equal common equity plus minority interest plus NFO."));
  return checks;
}

function driverChecks(drivers: readonly IndustrialForecastYearDrivers[]): ForecastValidationCheck[] {
  const checks: ForecastValidationCheck[] = [];
  checks.push(booleanCheck("drivers.non-empty", Array.isArray(drivers) && drivers.length > 0, "At least one projected year is required."));
  if (!Array.isArray(drivers)) return checks;

  drivers.forEach((driver, index) => {
    const stateId = `driver:${index + 1}`;
    for (const field of DRIVER_FIELDS) {
      const value = driver?.[field];
      checks.push(booleanCheck(
        `driver.required.${index + 1}.${field}`,
        typeof value === "number" && Number.isFinite(value),
        `Year ${index + 1} driver '${field}' must be supplied and finite.`,
        stateId,
      ));
    }
    if (!driver) return;
    checks.push(booleanCheck(`driver.year-offset.${index + 1}`, driver.yearOffset === index + 1, "Driver year offsets must be sequential from one.", stateId));
    checks.push(booleanCheck(`driver.revenue-growth-bound.${index + 1}`, driver.revenueGrowth > -1 && driver.revenueGrowth <= 5, "Revenue growth must be greater than -100% and no more than 500%.", stateId));
    checks.push(booleanCheck(`driver.operating-margin-bound.${index + 1}`, driver.operatingMargin >= -1 && driver.operatingMargin <= 1, "Operating margin must be between -100% and 100%.", stateId));
    checks.push(booleanCheck(`driver.asset-turnover-positive.${index + 1}`, driver.assetTurnover > 0, "Asset turnover must be positive.", stateId));
    checks.push(booleanCheck(`driver.tax-rate-bound.${index + 1}`, driver.taxRate >= 0 && driver.taxRate <= 1, "Tax rate must be between zero and one.", stateId));
    for (const field of ["workingCapitalAssetPctRevenue", "operatingLiabilityPctRevenue", "otherOperatingAssetPctRevenue", "depreciationRate", "amortizationRate", "intangibleInvestmentPctRevenue", "rightOfUseDepreciationRate", "costOfDebtPretax", "financialAssetYieldPretax", "dividendPayoutRatio", "minorityIncomeShare"] as const) {
      const value = driver[field];
      checks.push(booleanCheck(`driver.ratio-bound.${index + 1}.${field}`, value >= 0 && value <= 1, `${field} must be between zero and one.`, stateId));
    }
    for (const field of ["rightOfUseAssetAdditions", "debtIssuance", "debtRepayment", "leaseLiabilityAdditions", "leasePrincipalRepayment", "buybacks", "shareIssueProceeds", "sharesIssued", "sharesRepurchased", "dilutionOverhangShares", "financialAssetPurchases", "financialAssetSales", "minorityContributions", "minorityDistributions"] as const) {
      checks.push(booleanCheck(`driver.nonnegative.${index + 1}.${field}`, driver[field] >= 0, `${field} must be non-negative.`, stateId));
    }
  });
  return checks;
}

function terminalChecks(terminal: IndustrialTerminalAssumptions): ForecastValidationCheck[] {
  const checks: ForecastValidationCheck[] = [];
  const values = terminal ? [terminal.growth, terminal.roic, terminal.reinvestmentRate, terminal.ke, terminal.kw, terminal.minimumDiscountGrowthSpread] : [];
  checks.push(booleanCheck("terminal.finite", values.length === 6 && values.every(Number.isFinite), "All terminal assumptions must be finite."));
  if (!terminal || values.some((value) => !Number.isFinite(value))) return checks;
  checks.push(booleanCheck("terminal.reinvestment-bound", terminal.reinvestmentRate >= 0 && terminal.reinvestmentRate <= 1, "Terminal reinvestment rate must be between zero and one."));
  checks.push(booleanCheck("terminal.roic-positive", terminal.roic > 0, "Terminal ROIC must be positive."));
  checks.push(booleanCheck("terminal.minimum-spread-positive", terminal.minimumDiscountGrowthSpread > 0, "Minimum terminal discount-growth spread must be positive."));
  checks.push(booleanCheck("terminal.ke-growth-spread", terminal.ke - terminal.growth >= terminal.minimumDiscountGrowthSpread, "Cost of equity must exceed terminal growth by the minimum spread."));
  checks.push(booleanCheck("terminal.kw-growth-spread", terminal.kw - terminal.growth >= terminal.minimumDiscountGrowthSpread, "Operating capital cost must exceed terminal growth by the minimum spread."));
  const growthResidual = terminal.growth - terminal.reinvestmentRate * terminal.roic;
  checks.push(
    Math.abs(growthResidual) <= TERMINAL_IDENTITY_TOLERANCE
      ? passed("terminal.growth-reinvestment-roic", null, growthResidual, 0, TERMINAL_IDENTITY_TOLERANCE, "Terminal growth equals reinvestment rate times terminal ROIC.")
      : failed("terminal.growth-reinvestment-roic", null, growthResidual, 0, TERMINAL_IDENTITY_TOLERANCE, "Terminal growth must equal reinvestment rate times terminal ROIC."),
  );
  return checks;
}

function probabilityChecks(request: IndustrialForecastRequest): ForecastValidationCheck[] {
  const checks: ForecastValidationCheck[] = [];
  const validStatus = request.probabilityStatus === "calibrated" || request.probabilityStatus === "heuristic" || request.probabilityStatus === "not-assigned";
  checks.push(booleanCheck("probability.status", validStatus, "Probability status must be calibrated, heuristic, or not-assigned."));
  if (!validStatus) return checks;
  if (request.probabilityStatus === "not-assigned") {
    checks.push(booleanCheck("probability.unassigned-null", request.probability === null, "Unassigned scenarios must carry null probability."));
    return checks;
  }
  checks.push(booleanCheck("probability.assigned-finite", typeof request.probability === "number" && Number.isFinite(request.probability) && request.probability >= 0 && request.probability <= 1, "Assigned probability must be a finite fraction between zero and one."));
  if (request.probabilityStatus === "calibrated") {
    checks.push(booleanCheck("probability.calibrated-evidence", request.probabilityEvidenceRefs.length > 0, "Calibrated probability requires evidence references."));
  } else {
    checks.push(booleanCheck("probability.heuristic-rationale", Boolean(request.probabilityRationale?.trim()), "Heuristic probability requires an explicit rationale."));
  }
  return checks;
}

export function validateIndustrialForecastRequest(request: IndustrialForecastRequest): ForecastValidationReport {
  const checks: ForecastValidationCheck[] = [];
  checks.push(booleanCheck("request.case-id", Boolean(request?.caseId?.trim()), "caseId is required."));
  checks.push(booleanCheck("request.analysis-window-id", Boolean(request?.analysisWindowId?.trim()), "analysisWindowId is required."));
  checks.push(...anchorChecks(request?.anchor));
  checks.push(...driverChecks(request?.drivers));
  checks.push(...terminalChecks(request?.terminal));
  checks.push(...probabilityChecks(request));
  return buildForecastValidationReport(checks);
}

function stateFiniteValues(state: IndustrialProjectedState): number[] {
  const bs = state.balanceSheet;
  const inc = state.incomeStatement;
  const cf = state.cashFlow;
  return [
    bs.financialAssets.cash, bs.financialAssets.other, bs.financialAssets.total,
    bs.operatingAssets.workingCapital, bs.operatingAssets.ppe, bs.operatingAssets.rightOfUse,
    bs.operatingAssets.intangibles, bs.operatingAssets.goodwill, bs.operatingAssets.other, bs.operatingAssets.total,
    bs.totalAssets, bs.operatingLiabilities, bs.financialObligations.debt, bs.financialObligations.leaseLiabilities,
    bs.financialObligations.other, bs.financialObligations.total, bs.commonEquity.contributedCapital,
    bs.commonEquity.retainedEarnings, bs.commonEquity.accumulatedOci, bs.commonEquity.total,
    bs.minorityInterest, bs.totalLiabilities, bs.totalEquity, bs.totalLiabilitiesAndEquity, bs.noa, bs.nfo,
    inc.revenue, inc.operatingMargin, inc.operatingProfitPretax, inc.taxOnOperatingIncome,
    inc.operatingIncomeAfterTax, inc.financeExpensePretax, inc.financeIncomePretax,
    inc.netFinancingExpensePretax, inc.netFinancingExpenseAfterTax, inc.netIncomeTotal,
    inc.commonNetIncome, inc.minorityNetIncome,
    cf.cashFromOperations, cf.capitalExpenditure, cf.maintenanceCapex, cf.growthCapex, cf.ppeDisposals,
    cf.intangibleInvestment, cf.otherOperatingAssetInvestment, cf.cashFromInvesting, cf.cashFromFinancing, cf.netCashMovement,
    cf.openingCash, cf.endingCash, cf.fcff, cf.ownerEarnings,
    state.shares.opening, state.shares.issued, state.shares.repurchased, state.shares.endPeriod, state.shares.diluted,
  ];
}

export function validateIndustrialProjectedStates(
  anchor: IndustrialForecastAnchor,
  states: readonly IndustrialProjectedState[],
  terminal: TerminalEconomicsDiagnostic,
): ForecastValidationReport {
  const checks: ForecastValidationCheck[] = [];
  let previous = {
    revenue: anchor.revenue,
    cash: anchor.balanceSheet.cash,
    debt: anchor.balanceSheet.debt,
    leaseLiabilities: anchor.balanceSheet.leaseLiabilities,
    otherFinancialObligations: anchor.balanceSheet.otherFinancialObligations,
    retainedEarnings: anchor.balanceSheet.retainedEarnings,
    contributedCapital: anchor.balanceSheet.contributedCapital,
    accumulatedOci: anchor.balanceSheet.accumulatedOci,
    commonEquity: anchor.balanceSheet.commonEquity,
    minorityInterest: anchor.balanceSheet.minorityInterest,
    endShares: anchor.shares.endPeriod,
  };

  for (const state of states) {
    const id = state.stateId;
    const bs = state.balanceSheet;
    const inc = state.incomeStatement;
    const cf = state.cashFlow;
    const d = state.assumptions;
    checks.push(booleanCheck(`state.finite.${id}`, stateFiniteValues(state).every(Number.isFinite), "Every projected statement value must be finite.", id));
    checks.push(booleanCheck(`state.nonnegative-balances.${id}`, [bs.financialAssets.cash, bs.financialAssets.other, bs.operatingAssets.workingCapital, bs.operatingAssets.ppe, bs.operatingAssets.rightOfUse, bs.operatingAssets.intangibles, bs.operatingAssets.goodwill, bs.operatingAssets.other, bs.operatingLiabilities, bs.financialObligations.debt, bs.financialObligations.leaseLiabilities, bs.financialObligations.other, bs.minorityInterest, state.shares.endPeriod, state.shares.diluted].every((value) => value >= 0), "Projected asset, liability, minority, and share balances must be non-negative.", id));
    checks.push(residualCheck(`state.balance-sheet.${id}`, id, bs.totalAssets - bs.totalLiabilitiesAndEquity, [bs.totalAssets, bs.totalLiabilitiesAndEquity], "Projected assets equal liabilities plus equity."));
    checks.push(residualCheck(`state.cash-roll-forward.${id}`, id, cf.endingCash - cf.openingCash - cf.netCashMovement, [cf.endingCash, cf.openingCash, cf.netCashMovement], "Ending cash equals opening cash plus net cash movement."));
    checks.push(residualCheck(`state.cash-flow-sum.${id}`, id, cf.netCashMovement - cf.cashFromOperations - cf.cashFromInvesting - cf.cashFromFinancing, [cf.netCashMovement], "Net cash movement equals CFO plus CFI plus CFF."));
    checks.push(residualCheck(`state.debt-roll-forward.${id}`, id, bs.financialObligations.debt - previous.debt - d.debtIssuance + d.debtRepayment, [bs.financialObligations.debt, previous.debt], "Debt closes from opening debt, issuance, and repayment."));
    checks.push(residualCheck(`state.lease-roll-forward.${id}`, id, bs.financialObligations.leaseLiabilities - previous.leaseLiabilities - d.leaseLiabilityAdditions + d.leasePrincipalRepayment, [bs.financialObligations.leaseLiabilities, previous.leaseLiabilities], "Lease liability closes from additions and principal repayment."));
    checks.push(residualCheck(`state.other-financing-roll-forward.${id}`, id, bs.financialObligations.other - previous.otherFinancialObligations - d.otherFinancialObligationChange, [bs.financialObligations.other, previous.otherFinancialObligations], "Other financial obligations follow the explicit change assumption."));
    checks.push(residualCheck(`state.retained-earnings.${id}`, id, bs.commonEquity.retainedEarnings - previous.retainedEarnings - inc.commonNetIncome + cf.dividends, [bs.commonEquity.retainedEarnings, previous.retainedEarnings], "Retained earnings add common income and subtract dividends."));
    checks.push(residualCheck(`state.contributed-capital.${id}`, id, bs.commonEquity.contributedCapital - previous.contributedCapital - cf.shareIssueProceeds + cf.buybacks, [bs.commonEquity.contributedCapital, previous.contributedCapital], "Contributed capital reflects issues and buybacks."));
    checks.push(residualCheck(`state.accumulated-oci.${id}`, id, bs.commonEquity.accumulatedOci - previous.accumulatedOci - d.ownerOci, [bs.commonEquity.accumulatedOci, previous.accumulatedOci], "Accumulated OCI follows owner OCI."));
    checks.push(residualCheck(`state.common-equity-components.${id}`, id, bs.commonEquity.total - bs.commonEquity.contributedCapital - bs.commonEquity.retainedEarnings - bs.commonEquity.accumulatedOci, [bs.commonEquity.total], "Common equity equals its explicit components."));
    checks.push(residualCheck(`state.common-equity-roll-forward.${id}`, id, bs.commonEquity.total - previous.commonEquity - inc.commonNetIncome - d.ownerOci + cf.dividends + cf.buybacks - cf.shareIssueProceeds, [bs.commonEquity.total, previous.commonEquity], "Common equity follows clean surplus and owner transactions."));
    checks.push(residualCheck(`state.minority-roll-forward.${id}`, id, bs.minorityInterest - previous.minorityInterest - inc.minorityNetIncome - d.minorityOci - d.minorityContributions + d.minorityDistributions, [bs.minorityInterest, previous.minorityInterest], "Minority interest follows income, OCI, and owner transactions."));
    checks.push(residualCheck(`state.noa-definition.${id}`, id, state.diagnostics.noaDefinitionResidual, [bs.noa], "NOA equals operating assets less operating liabilities."));
    checks.push(residualCheck(`state.nfo-definition.${id}`, id, state.diagnostics.nfoDefinitionResidual, [bs.nfo], "NFO equals financial obligations less financial assets."));
    checks.push(residualCheck(`state.noa-financing-bridge.${id}`, id, state.diagnostics.noaFinancingBridgeResidual, [bs.noa, bs.commonEquity.total, bs.nfo], "NOA equals common equity plus minority interest plus NFO."));
    checks.push(residualCheck(`state.revenue-growth.${id}`, id, inc.revenue - previous.revenue * (1 + d.revenueGrowth), [inc.revenue], "Revenue follows the explicit growth driver."));
    checks.push(residualCheck(`state.operating-margin.${id}`, id, inc.operatingProfitPretax - inc.revenue * d.operatingMargin, [inc.operatingProfitPretax, inc.revenue], "Operating profit follows revenue times operating margin."));
    checks.push(residualCheck(`state.asset-turnover.${id}`, id, inc.revenue - bs.noa * d.assetTurnover, [inc.revenue, bs.noa], "Revenue equals NOA times asset turnover."));
    checks.push(residualCheck(`state.fcff-reinvestment.${id}`, id, cf.fcff - inc.operatingIncomeAfterTax + state.diagnostics.deltaNoa, [cf.fcff, inc.operatingIncomeAfterTax], "FCFF equals after-tax operating income less change in NOA."));
    checks.push(booleanCheck(`state.debt-repayment-capacity.${id}`, d.debtRepayment <= previous.debt + d.debtIssuance, "Debt repayment cannot exceed opening debt plus issuance.", id));
    checks.push(booleanCheck(`state.lease-repayment-capacity.${id}`, d.leasePrincipalRepayment <= previous.leaseLiabilities + d.leaseLiabilityAdditions, "Lease repayment cannot exceed opening liability plus additions.", id));
    checks.push(booleanCheck(`state.share-repurchase-capacity.${id}`, d.sharesRepurchased <= previous.endShares + d.sharesIssued, "Repurchased shares cannot exceed opening plus issued shares.", id));
    checks.push(residualCheck(`state.share-roll-forward.${id}`, id, state.shares.endPeriod - previous.endShares - d.sharesIssued + d.sharesRepurchased, [state.shares.endPeriod, previous.endShares], "End-period shares follow issuance and repurchase."));
    checks.push(residualCheck(`state.oci-asset-bridge.${id}`, id, d.financialAssetFairValueChange - d.ownerOci - d.minorityOci, [d.financialAssetFairValueChange, d.ownerOci, d.minorityOci], "Financial-asset fair-value movement must equal owner plus minority OCI."));

    previous = {
      revenue: inc.revenue,
      cash: bs.financialAssets.cash,
      debt: bs.financialObligations.debt,
      leaseLiabilities: bs.financialObligations.leaseLiabilities,
      otherFinancialObligations: bs.financialObligations.other,
      retainedEarnings: bs.commonEquity.retainedEarnings,
      contributedCapital: bs.commonEquity.contributedCapital,
      accumulatedOci: bs.commonEquity.accumulatedOci,
      commonEquity: bs.commonEquity.total,
      minorityInterest: bs.minorityInterest,
      endShares: state.shares.endPeriod,
    };
  }

  checks.push(booleanCheck("terminal.diagnostic-reinvestment-bound", terminal.reinvestmentRate >= 0 && terminal.reinvestmentRate <= 1, "Terminal reinvestment diagnostic is within zero and one."));
  checks.push(booleanCheck("terminal.diagnostic-ke-spread", terminal.keSpread >= terminal.minimumRequiredSpread, "Terminal ke spread meets the minimum."));
  checks.push(booleanCheck("terminal.diagnostic-kw-spread", terminal.kwSpread >= terminal.minimumRequiredSpread, "Terminal kw spread meets the minimum."));
  checks.push(
    Math.abs(terminal.consistencyResidual) <= TERMINAL_IDENTITY_TOLERANCE
      ? passed("terminal.diagnostic-growth-identity", null, terminal.consistencyResidual, 0, TERMINAL_IDENTITY_TOLERANCE, "Terminal growth equals reinvestment times ROIC.")
      : failed("terminal.diagnostic-growth-identity", null, terminal.consistencyResidual, 0, TERMINAL_IDENTITY_TOLERANCE, "Terminal growth is inconsistent with reinvestment times ROIC."),
  );
  return buildForecastValidationReport(checks);
}

export function mergeForecastValidationReports(...reports: readonly ForecastValidationReport[]): ForecastValidationReport {
  return buildForecastValidationReport(reports.flatMap((report) => report.checks));
}
