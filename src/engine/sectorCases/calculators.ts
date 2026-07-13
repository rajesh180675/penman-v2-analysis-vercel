import { CURRENT_MODEL_REGISTRY, type ModelGuardResult } from "../modelCatalog";
import {
  SECTOR_CASE_SCHEMA_VERSION,
  type SectorCaseComputedResult,
  type SectorCaseEligibility,
  type SectorCaseInput,
  type SectorCaseResult,
} from "./contracts";
import {
  CURRENT_SECTOR_CASE_REGISTRY,
  evaluateSectorCaseEligibility,
  type SectorCaseRegistry,
} from "./registry";

const MIN_TERMINAL_SPREAD = 0.005;

interface CalculationOutput {
  readonly enterpriseValueCr: number | null;
  readonly equityValueCr: number;
  readonly diagnostics: Readonly<Record<string, number | string | boolean | null>>;
  readonly guards: readonly ModelGuardResult[];
}

function guard(
  guardId: string,
  condition: boolean,
  observed: number | string | null,
  threshold: number | string | null,
  summary: string,
): ModelGuardResult {
  return {
    guardId,
    guardVersion: "1.0.0",
    status: condition ? "passed" : "failed",
    blocksResult: true,
    observed,
    threshold,
    evidenceRefs: [],
    summary,
  };
}

function terminalSpreadGuard(discountRate: number, growth: number): ModelGuardResult {
  return guard(
    "terminal.discount-growth-spread",
    discountRate - growth >= MIN_TERMINAL_SPREAD,
    discountRate - growth,
    MIN_TERMINAL_SPREAD,
    "Discount rate must exceed terminal growth by at least the policy spread.",
  );
}

function positiveGuard(id: string, value: number, label: string): ModelGuardResult {
  return guard(id, value > 0 && Number.isFinite(value), value, "> 0", `${label} must be finite and positive.`);
}

function utilityCalculation(input: Extract<SectorCaseInput, { caseType: "utility-rab" }>): CalculationOutput {
  const effectiveRateBase = input.regulatedRateBaseCr
    + input.constructionWorkInProgressCr * input.cwipEligibilityPct
    + input.regulatoryAssetsCr
    - input.regulatoryLiabilitiesCr;
  const regulatedEquity = effectiveRateBase * input.regulatedEquityWeight;
  const retention = input.allowedReturnOnEquity !== 0 ? input.terminalGrowth / input.allowedReturnOnEquity : Number.NaN;
  const distributableEquityCashFlow = regulatedEquity * input.allowedReturnOnEquity * (1 - retention);
  const guards = [
    positiveGuard("utility.positive-effective-rate-base", effectiveRateBase, "Effective regulated rate base"),
    guard("utility.cwip-eligibility-bound", input.cwipEligibilityPct >= 0 && input.cwipEligibilityPct <= 1, input.cwipEligibilityPct, "0..1", "CWIP eligibility must be a fraction."),
    guard("utility.equity-weight-bound", input.regulatedEquityWeight > 0 && input.regulatedEquityWeight <= 1, input.regulatedEquityWeight, "(0,1]", "Regulated equity weight must be positive and no more than one."),
    guard("utility.reinvestment-bound", retention >= 0 && retention <= 1, retention, "0..1", "Tariff growth reinvestment must not exceed allowed equity earnings."),
    terminalSpreadGuard(input.costOfEquity, input.terminalGrowth),
    positiveGuard("utility.positive-equity-cash-flow", distributableEquityCashFlow, "Distributable regulated equity cash flow"),
  ];
  const equityValueCr = distributableEquityCashFlow * (1 + input.terminalGrowth) / (input.costOfEquity - input.terminalGrowth);
  return {
    enterpriseValueCr: equityValueCr + input.netDebtCr,
    equityValueCr,
    diagnostics: { effectiveRateBase, regulatedEquity, retention, distributableEquityCashFlow },
    guards,
  };
}

function telecomCalculation(input: Extract<SectorCaseInput, { caseType: "telecom-network" }>): CalculationOutput {
  // million subscribers * INR/month * 12 / 10 = INR crore
  const subscriberRevenueCr = input.subscribersMillions * input.monthlyArpuInr * 1.2;
  const revenueBridgeResidualPct = (subscriberRevenueCr - input.reportedAnnualRevenueCr) / Math.max(input.reportedAnnualRevenueCr, 1);
  const ebitdaCr = input.reportedAnnualRevenueCr * input.ebitdaMargin;
  const maintenanceCapexCr = input.reportedAnnualRevenueCr * input.maintenanceCapexPctRevenue;
  const spectrumRenewalCapexCr = input.reportedAnnualRevenueCr * input.spectrumRenewalCapexPctRevenue;
  const normalizedFcffCr = ebitdaCr * (1 - input.cashTaxRate) - maintenanceCapexCr - spectrumRenewalCapexCr;
  const guards = [
    positiveGuard("telecom.positive-subscribers", input.subscribersMillions, "Subscribers"),
    positiveGuard("telecom.positive-arpu", input.monthlyArpuInr, "ARPU"),
    guard("telecom.revenue-driver-bridge", Math.abs(revenueBridgeResidualPct) <= 0.15, revenueBridgeResidualPct, "abs <= 0.15", "Subscriber/ARPU revenue must reconcile to reported annual revenue within 15%."),
    guard("telecom.ebitda-margin-bound", input.ebitdaMargin > 0 && input.ebitdaMargin <= 1, input.ebitdaMargin, "(0,1]", "EBITDA margin must be a valid positive fraction."),
    terminalSpreadGuard(input.costOfOperations, input.terminalGrowth),
    positiveGuard("telecom.positive-normalized-fcff", normalizedFcffCr, "Normalized telecom FCFF"),
  ];
  const enterpriseValueCr = normalizedFcffCr * (1 + input.terminalGrowth) / (input.costOfOperations - input.terminalGrowth);
  const equityValueCr = enterpriseValueCr - input.netDebtCr - input.spectrumObligationsCr - input.leaseLiabilitiesCr;
  return {
    enterpriseValueCr,
    equityValueCr,
    diagnostics: { subscriberRevenueCr, revenueBridgeResidualPct, ebitdaCr, maintenanceCapexCr, spectrumRenewalCapexCr, normalizedFcffCr },
    guards,
  };
}

function bankCalculation(input: Extract<SectorCaseInput, { caseType: "bank-equity" }>): CalculationOutput {
  const fairPriceToBook = (input.sustainableRoe - input.terminalGrowth) / (input.costOfEquity - input.terminalGrowth);
  const equityValueCr = input.commonBookValueCr * fairPriceToBook;
  const guards = [
    positiveGuard("bank.positive-common-book", input.commonBookValueCr, "Common book value"),
    terminalSpreadGuard(input.costOfEquity, input.terminalGrowth),
    guard("bank.capital-adequacy", input.capitalAdequacyPct >= input.minimumCapitalAdequacyPct, input.capitalAdequacyPct, input.minimumCapitalAdequacyPct, "Capital adequacy must meet the applicable minimum."),
    positiveGuard("bank.positive-fair-pb", fairPriceToBook, "Justified price-to-book"),
  ];
  return { enterpriseValueCr: null, equityValueCr, diagnostics: { fairPriceToBook }, guards };
}

function nbfcCalculation(input: Extract<SectorCaseInput, { caseType: "nbfc-funding" }>): CalculationOutput {
  const sustainableRoe = input.sustainableRoa * (1 + input.leverage);
  const preOperatingFundingSpread = input.assetYield - input.costOfBorrowing - input.creditCost;
  const fairPriceToBook = (sustainableRoe - input.terminalGrowth) / (input.costOfEquity - input.terminalGrowth);
  const equityValueCr = input.commonBookValueCr * fairPriceToBook;
  const requiredCapital = input.minimumCapitalAdequacyPct + input.requiredCapitalBufferPct;
  const guards = [
    positiveGuard("nbfc.positive-common-book", input.commonBookValueCr, "Common book value"),
    positiveGuard("nbfc.positive-aum", input.assetsUnderManagementCr, "Assets under management"),
    guard("nbfc.leverage-bound", input.leverage >= 0 && input.leverage <= 20, input.leverage, "0..20", "NBFC leverage must be within the supported range."),
    guard("nbfc.positive-funding-spread", preOperatingFundingSpread > 0, preOperatingFundingSpread, "> 0", "Asset yield must cover borrowing cost and through-cycle credit cost."),
    guard("nbfc.roa-funding-consistency", input.sustainableRoa <= preOperatingFundingSpread + 0.02, input.sustainableRoa - preOperatingFundingSpread, "<= 0.02", "Sustainable ROA cannot materially exceed the pre-operating funding spread."),
    guard("nbfc.capital-buffer", input.capitalAdequacyPct >= requiredCapital, input.capitalAdequacyPct, requiredCapital, "Capital adequacy must clear the regulatory minimum plus buffer."),
    terminalSpreadGuard(input.costOfEquity, input.terminalGrowth),
    positiveGuard("nbfc.positive-fair-pb", fairPriceToBook, "NBFC justified price-to-book"),
  ];
  return { enterpriseValueCr: null, equityValueCr, diagnostics: { sustainableRoe, preOperatingFundingSpread, fairPriceToBook, requiredCapital }, guards };
}

function insuranceCalculation(input: Extract<SectorCaseInput, { caseType: "insurance-embedded-value" }>): CalculationOutput {
  const equityValueCr = input.embeddedValueCr + input.valueOfNewBusinessCr * input.valueOfNewBusinessMultiple;
  const guards = [
    positiveGuard("insurance.positive-embedded-value", input.embeddedValueCr, "Embedded value"),
    guard("insurance.nonnegative-vnb", input.valueOfNewBusinessCr >= 0, input.valueOfNewBusinessCr, ">= 0", "Value of new business must be non-negative."),
    guard("insurance.vnb-multiple-bound", input.valueOfNewBusinessMultiple >= 0 && input.valueOfNewBusinessMultiple <= 50, input.valueOfNewBusinessMultiple, "0..50", "VNB multiple must remain within the supported bound."),
    guard("insurance.solvency", input.solvencyRatioPct >= input.minimumSolvencyRatioPct, input.solvencyRatioPct, input.minimumSolvencyRatioPct, "Solvency ratio must meet the regulatory minimum."),
  ];
  return { enterpriseValueCr: null, equityValueCr, diagnostics: { embeddedValueCr: input.embeddedValueCr, valueOfNewBusinessCr: input.valueOfNewBusinessCr, valueOfNewBusinessMultiple: input.valueOfNewBusinessMultiple }, guards };
}

function conglomerateCalculation(input: Extract<SectorCaseInput, { caseType: "conglomerate-sotp" }>): CalculationOutput {
  const grossSegmentEquityCr = input.segments.reduce(
    (sum, segment) => sum + segment.enterpriseValueCr - segment.netDebtCr - segment.minorityInterestCr,
    0,
  );
  const postDiscountSegmentEquityCr = grossSegmentEquityCr * (1 - input.conglomerateDiscountPct);
  const equityValueCr = postDiscountSegmentEquityCr - input.holdingCompanyNetDebtCr;
  const enterpriseValueCr = input.segments.reduce((sum, segment) => sum + segment.enterpriseValueCr, 0);
  const guards = [
    guard("conglomerate.minimum-segments", input.segments.length >= 2, input.segments.length, ">= 2", "SOTP requires at least two evidence-backed segments."),
    guard("conglomerate.discount-bound", input.conglomerateDiscountPct >= 0 && input.conglomerateDiscountPct <= 0.5, input.conglomerateDiscountPct, "0..0.5", "Conglomerate discount must be between zero and 50%."),
    positiveGuard("conglomerate.positive-segment-equity", grossSegmentEquityCr, "Gross segment equity"),
  ];
  return { enterpriseValueCr, equityValueCr, diagnostics: { segmentCount: input.segments.length, grossSegmentEquityCr, postDiscountSegmentEquityCr }, guards };
}

function cyclicalCalculation(input: Extract<SectorCaseInput, { caseType: "cyclical-mid-cycle" }>): CalculationOutput {
  const revenueCr = input.normalizedVolume * input.midCyclePricePerUnit;
  const variableCostCr = input.normalizedVolume * input.cashCostPerUnit;
  const midCycleEbitdaCr = revenueCr - variableCostCr - input.annualFixedCostsCr;
  const normalizedFcffCr = midCycleEbitdaCr * (1 - input.cashTaxRate) - input.sustainingCapexCr;
  const guards = [
    positiveGuard("cyclical.positive-volume", input.normalizedVolume, "Normalized volume"),
    guard("cyclical.positive-unit-margin", input.midCyclePricePerUnit > input.cashCostPerUnit, input.midCyclePricePerUnit - input.cashCostPerUnit, "> 0", "Mid-cycle price must exceed cash cost."),
    terminalSpreadGuard(input.costOfOperations, input.terminalGrowth),
    positiveGuard("cyclical.positive-mid-cycle-fcff", normalizedFcffCr, "Mid-cycle FCFF"),
  ];
  const enterpriseValueCr = normalizedFcffCr * (1 + input.terminalGrowth) / (input.costOfOperations - input.terminalGrowth);
  return { enterpriseValueCr, equityValueCr: enterpriseValueCr - input.netDebtCr, diagnostics: { revenueCr, variableCostCr, midCycleEbitdaCr, normalizedFcffCr }, guards };
}

function retailCalculation(input: Extract<SectorCaseInput, { caseType: "retail-unit-economics" }>): CalculationOutput {
  const revenueCr = input.matureStoreCount * input.annualRevenuePerStoreCr;
  const storeEbitdaCr = revenueCr * input.storeEbitdaMargin;
  const maintenanceCapexCr = input.matureStoreCount * input.maintenanceCapexPerStoreCr;
  const normalizedFcffCr = (storeEbitdaCr - input.centralCostsCr) * (1 - input.cashTaxRate) - maintenanceCapexCr;
  const guards = [
    positiveGuard("retail.positive-mature-store-count", input.matureStoreCount, "Mature store count"),
    positiveGuard("retail.positive-revenue-per-store", input.annualRevenuePerStoreCr, "Revenue per mature store"),
    guard("retail.store-margin-bound", input.storeEbitdaMargin > 0 && input.storeEbitdaMargin <= 1, input.storeEbitdaMargin, "(0,1]", "Store EBITDA margin must be a valid fraction."),
    terminalSpreadGuard(input.costOfOperations, input.terminalGrowth),
    positiveGuard("retail.positive-unit-fcff", normalizedFcffCr, "Mature-store normalized FCFF"),
  ];
  const enterpriseValueCr = normalizedFcffCr * (1 + input.terminalGrowth) / (input.costOfOperations - input.terminalGrowth);
  return { enterpriseValueCr, equityValueCr: enterpriseValueCr - input.netDebtCr, diagnostics: { revenueCr, storeEbitdaCr, maintenanceCapexCr, normalizedFcffCr }, guards };
}

function calculate(input: SectorCaseInput): CalculationOutput {
  switch (input.caseType) {
    case "utility-rab": return utilityCalculation(input);
    case "telecom-network": return telecomCalculation(input);
    case "bank-equity": return bankCalculation(input);
    case "nbfc-funding": return nbfcCalculation(input);
    case "insurance-embedded-value": return insuranceCalculation(input);
    case "conglomerate-sotp": return conglomerateCalculation(input);
    case "cyclical-mid-cycle": return cyclicalCalculation(input);
    case "retail-unit-economics": return retailCalculation(input);
  }
}

function blocked(
  input: SectorCaseInput,
  eligibility: Exclude<SectorCaseEligibility, { status: "eligible" }>,
  guardResults: readonly ModelGuardResult[] = [],
): SectorCaseResult {
  return Object.freeze({
    schemaVersion: SECTOR_CASE_SCHEMA_VERSION,
    status: "blocked",
    caseType: input.caseType,
    issuerId: input.issuerId,
    asOf: input.asOf,
    modelId: eligibility.modelId,
    eligibility,
    reasonCodes: eligibility.reasonCodes,
    guardResults,
  });
}

function attachEvidence(
  guards: readonly ModelGuardResult[],
  evidenceRefs: readonly string[],
): readonly ModelGuardResult[] {
  return guards.map((entry) => Object.freeze({
    ...entry,
    evidenceRefs: entry.evidenceRefs.length ? entry.evidenceRefs : evidenceRefs,
  }));
}

/** Execute only an evidence-eligible sector case and emit no fallback value. */
export function executeSectorCase(
  input: SectorCaseInput,
  registry: SectorCaseRegistry = CURRENT_SECTOR_CASE_REGISTRY,
): SectorCaseResult {
  const eligibility = evaluateSectorCaseEligibility(input, registry);
  if (eligibility.status !== "eligible") return blocked(input, eligibility);

  const output = calculate(input);
  const perShareInr = output.equityValueCr / input.sharesOutstandingCr;
  const finiteOutput = Number.isFinite(output.equityValueCr)
    && output.equityValueCr > 0
    && Number.isFinite(perShareInr)
    && perShareInr > 0
    && (output.enterpriseValueCr == null || Number.isFinite(output.enterpriseValueCr));
  const commonGuards = [
    positiveGuard("share-basis.positive", input.sharesOutstandingCr, "Share basis"),
    guard(
      "output.finite-valuation",
      finiteOutput,
      finiteOutput ? "finite-positive" : "non-finite-or-nonpositive",
      "finite and > 0",
      "Published sector valuation values must be finite and positive.",
    ),
  ];
  const guardResults = attachEvidence([...output.guards, ...commonGuards], eligibility.evidenceRefs);
  const failedGuards = guardResults.filter((entry) => entry.status === "failed" && entry.blocksResult);
  if (failedGuards.length || !finiteOutput) {
    const reasonCodes = [
      ...failedGuards.map((entry) => `guard-failed:${entry.guardId}`),
      ...(finiteOutput ? [] : ["non-finite-or-nonpositive-output"]),
    ];
    return blocked(input, {
      status: "invalid-input",
      caseType: input.caseType,
      modelId: eligibility.modelId,
      reasonCodes,
      missingEvidenceIds: [],
      summary: `${reasonCodes.length} computation guard(s) blocked sector-native publication.`,
    }, guardResults);
  }

  const modelVersion = CURRENT_MODEL_REGISTRY.require(eligibility.modelId).modelVersion;
  const result: SectorCaseComputedResult = {
    schemaVersion: SECTOR_CASE_SCHEMA_VERSION,
    status: "computed",
    caseType: input.caseType,
    issuerId: input.issuerId,
    asOf: input.asOf,
    modelId: eligibility.modelId,
    eligibility,
    enterpriseValueCr: output.enterpriseValueCr,
    equityValueCr: output.equityValueCr,
    perShareInr,
    evidenceRefs: eligibility.evidenceRefs,
    transformationRefs: [`sector-case:${input.caseType}:${modelVersion}:${input.issuerId}:${input.asOf}`],
    diagnostics: output.diagnostics,
    guardResults,
  };
  return Object.freeze(result);
}
