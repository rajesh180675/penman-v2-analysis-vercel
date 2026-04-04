/**
 * Forecasting Engine — V2
 * §4.3 Pro Forma, Fade Analysis, Scenario Analysis
 * Nissim & Penman (2001) §2.6, Table 3
 */
import { RecastPeriod, ForecastPeriod, ForecastScenario, FADE_PARAMS, NP_BENCHMARKS, BusinessModelProfile, PersistenceScenarioTemplate } from "./types";
import { buildCyclicalNormalization } from "./cyclicalNormalization";
import { buildDriverForecastModel } from "./forecastDriverModel";
import { buildTerminalEconomics } from "./terminalEconomics";

/* §4.3.1 Fade-adjusted single ratio forecast */
export function fadeRatio(
  historicalValue: number,
  ratioKey: keyof typeof FADE_PARAMS,
  horizonT: number,
  industryMedian?: number,
): number[] {
  const alpha = FADE_PARAMS[ratioKey] ?? 0.85;
  const target = industryMedian ?? (NP_BENCHMARKS[ratioKey]?.median ?? historicalValue);
  const result: number[] = [];
  let prev = historicalValue;
  for (let t = 1; t <= horizonT; t++) {
    const next = alpha * prev + (1 - alpha) * target;
    result.push(next);
    prev = next;
  }
  return result;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function median(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!filtered.length) return null;
  const middle = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 0 ? (filtered[middle - 1] + filtered[middle]) / 2 : filtered[middle];
}

function latestFinite(values: Array<number | null | undefined>) {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

function spreadValues(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!filtered.length) return null;
  return Math.max(...filtered) - Math.min(...filtered);
}

function makeFadeArray(base: number, alpha: number, target: number, horizon: number) {
  const values: number[] = [];
  let previous = base;
  for (let i = 0; i < horizon; i += 1) {
    const next = alpha * previous + (1 - alpha) * target;
    values.push(next);
    previous = next;
  }
  return values;
}


export function buildBusinessModelProfile(data: RecastPeriod[]): BusinessModelProfile {
  const salesGrowthSeries = data.map((period) => period.ratios?.Sales_growth ?? null);
  const corePmSeries = data.map((period) => period.ratios?.CoreSalesPM ?? period.ratios?.PM ?? null);
  const atoSeries = data.map((period) => period.ratios?.ATO ?? null);
  const spreadSeries = data.map((period) => period.ratios?.SPREAD ?? period.ratios?.CoreSPREAD ?? null);
  const cashConversionSeries = data.map((period) => period.ratios?.cash_conversion_ratio ?? null);
  const noaGrowthSeries = data.map((period) => period.ratios?.NOA_growth ?? null);
  const separationSeries = data.map((period) => period.bs.separationScore ?? period.ratios?.separationScore ?? null);
  const leverageSeries = data.map((period) => period.ratios?.FLEV ?? null);

  const historicalSalesGrowth = median(salesGrowthSeries.slice(0, -1));
  const historicalCorePm = median(corePmSeries.slice(0, -1));
  const historicalAto = median(atoSeries.slice(0, -1));
  const historicalSpread = median(spreadSeries.slice(0, -1));
  const historicalCashConversion = median(cashConversionSeries.slice(0, -1));

  const latestSalesGrowth = latestFinite(salesGrowthSeries);
  const latestCorePm = latestFinite(corePmSeries);
  const latestCashConversion = latestFinite(cashConversionSeries);
  const latestSpread = latestFinite(spreadSeries);
  const latestNoaGrowth = latestFinite(noaGrowthSeries);
  const latestSeparation = latestFinite(separationSeries) ?? 70;
  const latestLeverage = latestFinite(leverageSeries) ?? 0.3;

  const demandStabilityScore = clamp(
    ((0.12 - (spreadValues(salesGrowthSeries) ?? 0.12)) / 0.12) * 100,
    0,
    100,
  );
  const marginDurabilityScore = clamp(
    (
      clamp((0.12 - (spreadValues(corePmSeries) ?? 0.12)) / 0.12, 0, 1) * 0.55
      + clamp(((historicalCorePm ?? latestCorePm ?? 0) - Math.max((latestCorePm ?? 0) - (historicalCorePm ?? latestCorePm ?? 0), 0) - 0.03) / 0.15, 0, 1) * 0.25
      + clamp((latestSeparation - 55) / 40, 0, 1) * 0.2
    ) * 100,
    0,
    100,
  );
  const workingCapitalDisciplineScore = clamp(
    (
      clamp(((historicalCashConversion ?? latestCashConversion ?? 0.6) - 0.5) / 0.55, 0, 1) * 0.65
      + clamp((0.22 - Math.max((latestNoaGrowth ?? 0) - (historicalSalesGrowth ?? latestSalesGrowth ?? 0), 0)) / 0.22, 0, 1) * 0.35
    ) * 100,
    0,
    100,
  );
  const reinvestmentQualityScore = clamp(
    (
      clamp(((historicalSpread ?? latestSpread ?? 0.02) - 0.01) / 0.13, 0, 1) * 0.45
      + clamp(((historicalCashConversion ?? latestCashConversion ?? 0.6) - 0.5) / 0.55, 0, 1) * 0.25
      + clamp((0.95 - latestLeverage - 0.1) / 0.7, 0, 1) * 0.15
      + clamp((latestSeparation - 55) / 40, 0, 1) * 0.15
    ) * 100,
    0,
    100,
  );
  const capitalIntensityScore = clamp(
    (
      clamp(((historicalAto ?? latestFinite(atoSeries) ?? 0.6) - 0.35) / 1.95, 0, 1) * 0.6
      + clamp((0.95 - latestLeverage - 0.1) / 0.7, 0, 1) * 0.4
    ) * 100,
    0,
    100,
  );

  const onePeriodSpikePenalty = clamp(
    Math.max((latestCorePm ?? historicalCorePm ?? 0) - (historicalCorePm ?? latestCorePm ?? 0), 0) * 220
      + Math.max((latestSalesGrowth ?? historicalSalesGrowth ?? 0) - (historicalSalesGrowth ?? latestSalesGrowth ?? 0), 0) * 120
      + Math.max(0.7 - (latestCashConversion ?? historicalCashConversion ?? 0.7), 0) * 90,
    0,
    45,
  );

  const persistenceScore = clamp(
    demandStabilityScore * 0.2
      + marginDurabilityScore * 0.28
      + capitalIntensityScore * 0.14
      + workingCapitalDisciplineScore * 0.18
      + reinvestmentQualityScore * 0.2
      - onePeriodSpikePenalty,
    0,
    100,
  );

  const evidence: string[] = [];
  if (latestCorePm != null && historicalCorePm != null && latestCorePm > historicalCorePm * 1.35) {
    evidence.push(`Latest margin looks above the multi-year base (${(latestCorePm * 100).toFixed(1)}% vs ${(historicalCorePm * 100).toFixed(1)}%), so persistence is capped.`);
  }
  if (latestSalesGrowth != null && historicalSalesGrowth != null && latestSalesGrowth > historicalSalesGrowth * 1.5) {
    evidence.push(`Latest growth is running ahead of the multi-year base (${(latestSalesGrowth * 100).toFixed(1)}% vs ${(historicalSalesGrowth * 100).toFixed(1)}%).`);
  }
  if ((latestCashConversion ?? 1) < 0.65) {
    evidence.push(`Latest cash conversion is weak at ${((latestCashConversion ?? 0) * 100).toFixed(0)}%, which reduces persistence confidence.`);
  }
  if ((latestSeparation ?? 70) < 65) {
    evidence.push(`Latest operating-cost bridge coverage is soft, so margin persistence is treated conservatively.`);
  }
  if (!evidence.length) {
    evidence.push("Multi-year margins, reinvestment, and cash conversion appear stable enough to support slower fade assumptions.");
  }

  return {
    persistenceScore,
    demandStabilityScore,
    marginDurabilityScore,
    capitalIntensityScore,
    workingCapitalDisciplineScore,
    reinvestmentQualityScore,
    evidence,
    historicalAnchors: {
      salesGrowth: historicalSalesGrowth,
      corePm: historicalCorePm,
      ato: historicalAto,
      spread: historicalSpread,
      cashConversion: historicalCashConversion,
    },
  };
}

function buildForecastPolicyNarrative(args: {
  persistenceScore: number;
  companyEvidenceWeight: number;
  templateGuardrailStrength: number;
  workingCapitalPressure: "low" | "medium" | "high";
  reinvestmentBurden: "light" | "moderate" | "heavy";
  balanceSheetFlexibility: "strong" | "adequate" | "tight";
  terminalAnchorSource: "company-evidence" | "blended" | "template";
  businessModel: BusinessModelProfile;
}) {
  const {
    persistenceScore,
    companyEvidenceWeight,
    templateGuardrailStrength,
    workingCapitalPressure,
    reinvestmentBurden,
    balanceSheetFlexibility,
    terminalAnchorSource,
    businessModel,
  } = args;
  const narrative = [...businessModel.evidence];
  narrative.unshift(
    persistenceScore < 45
      ? "Forecast policy assumes fragility: growth, margin, and capital efficiency fade quickly toward anchored history."
      : persistenceScore < 65
        ? "Forecast policy assumes mixed persistence: recent economics matter, but only inside historical guardrails."
        : "Forecast policy assumes durable economics: company evidence can dominate template priors within bounded guardrails.",
  );
  narrative.push(
    `Company evidence weight is ${(companyEvidenceWeight * 100).toFixed(0)}% while template guardrails contribute ${(templateGuardrailStrength * 100).toFixed(0)}%.`,
    `Working-capital pressure is ${workingCapitalPressure}; reinvestment burden is ${reinvestmentBurden}; balance-sheet flexibility is ${balanceSheetFlexibility}.`,
    `Terminal anchor is driven by ${terminalAnchorSource}.`,
  );
  return narrative;
}

export function derivePersistenceForecastScenario(params: {
  scenarioKey: "stress" | "base" | "bull" | "historical-panic";
  periods?: RecastPeriod[];
  latest: RecastPeriod;
  businessModel: BusinessModelProfile;
  horizon: number;
  template: PersistenceScenarioTemplate;
  riskInputs: {
    ke: number;
    kw: number;
    riskFreeRate: number;
  };
}): ForecastScenario {
  const { scenarioKey, periods, latest, businessModel, horizon, template, riskInputs } = params;
  const history = periods?.length ? periods : [latest];
  const normalized = buildCyclicalNormalization(history);
  const driverPlan = buildDriverForecastModel({
    data: history,
    latest,
    businessModel,
    normalized,
    scenarioKey,
    template,
  });
  const terminalEconomics = buildTerminalEconomics({
    latest,
    normalized,
    businessModel,
    driverPlan,
    requiredReturn: riskInputs.kw,
    terminalGrowthFloor: template.terminalGrowthFloor,
    terminalGrowthCap: template.terminalGrowthCap,
  });
  const flevBase = Math.max(latest.bs.NFO / Math.max(latest.bs.CSE, 1), -0.2);
  const nbcBase = Math.max(latest.is.NFE / Math.max(Math.abs(latest.bs.NFO), 1), 0.01);
  const terminalAnchorSource = driverPlan.companyEvidenceWeight >= 0.65
    ? "company-evidence"
    : driverPlan.companyEvidenceWeight >= 0.45
      ? "blended"
      : "template";

  const scenarioPresets = {
    stress: {
      name: "bear" as const,
      probability: 0.25,
      ke: riskInputs.ke + 0.02,
      kw: riskInputs.kw + 0.015,
      terminalGrowth: clamp(terminalEconomics.terminalGrowth, 0.015, 0.03),
    },
    base: {
      name: "base" as const,
      probability: 0.4,
      ke: riskInputs.ke,
      kw: riskInputs.kw,
      terminalGrowth: terminalEconomics.terminalGrowth,
    },
    bull: {
      name: "bull" as const,
      probability: 0.15,
      ke: Math.max(riskInputs.ke - 0.01, riskInputs.riskFreeRate + 0.04),
      kw: Math.max(riskInputs.kw - 0.008, riskInputs.riskFreeRate + 0.03),
      terminalGrowth: clamp(terminalEconomics.terminalGrowth * 1.1, template.terminalGrowthFloor, template.terminalGrowthCap),
    },
    "historical-panic": {
      name: "bear" as const,
      probability: 0.2,
      ke: riskInputs.ke + 0.03,
      kw: riskInputs.kw + 0.0225,
      terminalGrowth: clamp(template.terminalGrowthFloor, 0.01, 0.025),
    },
  } as const;

  const preset = scenarioPresets[scenarioKey];

  return {
    name: preset.name,
    probability: preset.probability,
    horizonT: horizon,
    forecastPolicy: {
      companyEvidenceWeight: driverPlan.companyEvidenceWeight,
      persistenceScore: businessModel.persistenceScore,
      templateGuardrailStrength: driverPlan.templateGuardrailStrength,
      terminalAnchorSource,
      workingCapitalPressure: driverPlan.workingCapitalPressure,
      reinvestmentBurden: driverPlan.reinvestmentPosture,
      balanceSheetFlexibility: driverPlan.balanceSheetFlexibility,
      operatingMode: driverPlan.operatingMode,
      terminalFadeYears: terminalEconomics.fadeYears,
      terminalEconomicsRationale: terminalEconomics.rationale,
      narrative: buildForecastPolicyNarrative({
        persistenceScore: businessModel.persistenceScore,
        companyEvidenceWeight: driverPlan.companyEvidenceWeight,
        templateGuardrailStrength: driverPlan.templateGuardrailStrength,
        workingCapitalPressure: driverPlan.workingCapitalPressure,
        reinvestmentBurden: driverPlan.reinvestmentPosture,
        balanceSheetFlexibility: driverPlan.balanceSheetFlexibility,
        terminalAnchorSource,
        businessModel,
      }),
    },
    drivers: {
      sales_growth: makeFadeArray(driverPlan.year1.salesGrowth, driverPlan.fade.growthAlpha, driverPlan.targets.salesGrowth, horizon),
      core_sales_pm: makeFadeArray(driverPlan.year1.coreMargin, driverPlan.fade.marginAlpha, driverPlan.targets.coreMargin, horizon),
      ato: makeFadeArray(driverPlan.year1.ato, driverPlan.fade.atoAlpha, driverPlan.targets.ato, horizon),
      flev: Array(horizon).fill(flevBase),
      nbc: Array(horizon).fill(nbcBase),
      g_terminal: preset.terminalGrowth,
      ke: preset.ke,
      kw: preset.kw,
    },
  };
}

/* §4.3.2 Pro Forma Period Builder — propagates accounting identities */
export function buildForecastPeriod(
  yearOffset: number,
  baseYear: string,
  prevForecast: { Sales_f: number; NOA_f: number; CSE_f: number; NFO_f: number },
  drivers: {
    sales_growth: number;
    core_sales_pm: number;
    ato: number;
    flev: number;
    nbc: number;
    material_cost_ratio?: number | null;
    employee_cost_ratio?: number | null;
    depreciation_ratio?: number | null;
    sga_ratio?: number | null;
    other_opex_ratio?: number | null;
    other_operating_income_ratio?: number | null;
  },
  ke: number, kw: number,
  source: ForecastPeriod["source"],
): ForecastPeriod {
  const fyYear = parseInt(baseYear.slice(0, 4)) + yearOffset;
  const period_label = `FY${fyYear}E`;

  const Sales_f = prevForecast.Sales_f * (1 + drivers.sales_growth);
  const NOA_f   = drivers.ato > 0 ? Sales_f / drivers.ato : prevForecast.NOA_f;
  const ΔNOA_f  = NOA_f - prevForecast.NOA_f;
  const hasCostBridge =
    drivers.material_cost_ratio != null
    && drivers.employee_cost_ratio != null
    && drivers.depreciation_ratio != null
    && drivers.sga_ratio != null
    && drivers.other_opex_ratio != null
    && drivers.other_operating_income_ratio != null;
  const MaterialCost_f = hasCostBridge ? (drivers.material_cost_ratio ?? 0) * Sales_f : null;
  const EmployeeCost_f = hasCostBridge ? (drivers.employee_cost_ratio ?? 0) * Sales_f : null;
  const Depreciation_f = hasCostBridge ? (drivers.depreciation_ratio ?? 0) * Sales_f : null;
  const SGA_f = hasCostBridge ? (drivers.sga_ratio ?? 0) * Sales_f : null;
  const OtherOperatingExpense_f = hasCostBridge ? (drivers.other_opex_ratio ?? 0) * Sales_f : null;
  const OtherOperatingIncome_f = hasCostBridge ? (drivers.other_operating_income_ratio ?? 0) * Sales_f : null;
  const GrossProfit_f = MaterialCost_f != null ? Sales_f - MaterialCost_f : null;
  const CoreOI_bridge_f =
    GrossProfit_f != null
    && EmployeeCost_f != null
    && Depreciation_f != null
    && SGA_f != null
    && OtherOperatingExpense_f != null
    && OtherOperatingIncome_f != null
      ? GrossProfit_f - EmployeeCost_f - Depreciation_f - SGA_f - OtherOperatingExpense_f + OtherOperatingIncome_f
      : null;
  const effectiveCorePm = CoreOI_bridge_f != null && Sales_f !== 0 ? CoreOI_bridge_f / Sales_f : drivers.core_sales_pm;
  const OI_f    = effectiveCorePm * Sales_f;
  const FCF_f   = OI_f - ΔNOA_f;
  const CSE_f   = drivers.flev > -1 ? NOA_f / (1 + drivers.flev) : NOA_f;
  const NFO_f   = NOA_f - CSE_f;
  const NFE_f   = drivers.nbc * (prevForecast.NFO_f + NFO_f) / 2;
  const CNI_f   = OI_f - NFE_f;
  const RE_f    = CNI_f - ke * prevForecast.CSE_f;
  const ReOI_f  = OI_f - kw * prevForecast.NOA_f;

  return {
    year_offset: yearOffset,
    period_label,
    sales_growth_assumption: drivers.sales_growth,
    core_sales_pm_assumption: effectiveCorePm,
    ato_assumption: drivers.ato,
    flev_assumption: drivers.flev,
    nbc_assumption: drivers.nbc,
    Sales_f, NOA_f, OI_f, NFE_f, CNI_f, CSE_f, NFO_f, ΔNOA_f, FCF_f, RE_f, ReOI_f,
    source,
    bridge_mode: hasCostBridge ? "cost_bridge" : "margin",
    material_cost_ratio_assumption: drivers.material_cost_ratio ?? null,
    employee_cost_ratio_assumption: drivers.employee_cost_ratio ?? null,
    depreciation_ratio_assumption: drivers.depreciation_ratio ?? null,
    sga_ratio_assumption: drivers.sga_ratio ?? null,
    other_opex_ratio_assumption: drivers.other_opex_ratio ?? null,
    other_operating_income_ratio_assumption: drivers.other_operating_income_ratio ?? null,
    MaterialCost_f,
    EmployeeCost_f,
    Depreciation_f,
    SGA_f,
    OtherOperatingExpense_f,
    OtherOperatingIncome_f,
    GrossProfit_f,
    CoreOI_bridge_f,
  };
}

/* §4.3.3 Full Scenario — build all periods */
export function buildScenario(
  scenario: ForecastScenario,
  latestPeriod: RecastPeriod,
): ForecastPeriod[] {
  const requireNonEmptySeries = (name: string, values: number[]) => {
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`Scenario driver '${name}' must be a non-empty array`);
    }
  };

  const pickDriverValue = (name: string, values: number[], idx: number): number => {
    const value = values[Math.min(idx, values.length - 1)];
    if (!Number.isFinite(value)) {
      throw new Error(`Scenario driver '${name}' contains non-finite value at index ${Math.min(idx, values.length - 1)}`);
    }
    return value;
  };
  const pickOptionalDriverValue = (values: number[] | undefined, idx: number): number | null => {
    if (!values?.length) return null;
    const value = values[Math.min(idx, values.length - 1)];
    if (!Number.isFinite(value)) {
      throw new Error(`Scenario driver contains non-finite optional value at index ${Math.min(idx, values.length - 1)}`);
    }
    return value;
  };

  const d = scenario.drivers;
  requireNonEmptySeries("sales_growth", d.sales_growth);
  requireNonEmptySeries("core_sales_pm", d.core_sales_pm);
  requireNonEmptySeries("ato", d.ato);
  requireNonEmptySeries("flev", d.flev);
  requireNonEmptySeries("nbc", d.nbc);

  const periods: ForecastPeriod[] = [];
  let prev = {
    Sales_f: latestPeriod.is.Sales,
    NOA_f:   latestPeriod.bs.NOA,
    CSE_f:   latestPeriod.bs.CSE,
    NFO_f:   latestPeriod.bs.NFO,
  };
  const baseYear = latestPeriod.period_end;

  for (let t = 1; t <= scenario.horizonT; t++) {
    const idx = t - 1;
    const fp = buildForecastPeriod(
      t, baseYear, prev,
      {
        sales_growth: pickDriverValue("sales_growth", d.sales_growth, idx),
        core_sales_pm: pickDriverValue("core_sales_pm", d.core_sales_pm, idx),
        ato: pickDriverValue("ato", d.ato, idx),
        flev: pickDriverValue("flev", d.flev, idx),
        nbc: pickDriverValue("nbc", d.nbc, idx),
        material_cost_ratio: pickOptionalDriverValue(d.material_cost_ratio, idx),
        employee_cost_ratio: pickOptionalDriverValue(d.employee_cost_ratio, idx),
        depreciation_ratio: pickOptionalDriverValue(d.depreciation_ratio, idx),
        sga_ratio: pickOptionalDriverValue(d.sga_ratio, idx),
        other_opex_ratio: pickOptionalDriverValue(d.other_opex_ratio, idx),
        other_operating_income_ratio: pickOptionalDriverValue(d.other_operating_income_ratio, idx),
      },
      d.ke, d.kw,
      'fade',
    );
    periods.push(fp);
    prev = { Sales_f: fp.Sales_f, NOA_f: fp.NOA_f, CSE_f: fp.CSE_f, NFO_f: fp.NFO_f };
  }
  return periods;
}

/* §4.3.x Forecast -> valuation bridge used by scenario, sensitivity, and MC */
export function buildValuationPeriodsFromForecast(
  latestPeriod: RecastPeriod,
  forecastPeriods: ForecastPeriod[],
): RecastPeriod[] {
  const baseYear = Number.parseInt(latestPeriod.period_end.slice(0, 4), 10);
  if (!Number.isFinite(baseYear)) {
    throw new Error(`Invalid period_end year in latestPeriod: ${latestPeriod.period_end}`);
  }

  return [
    latestPeriod,
    ...forecastPeriods.map((fp, i) => ({
      period_end: `${baseYear + i + 1}-03-31`,
      bs: { ...latestPeriod.bs, CSE: fp.CSE_f, NOA: fp.NOA_f, NFO: fp.NOA_f - fp.CSE_f },
      is: {
        ...latestPeriod.is,
        CNI: fp.CNI_f,
        OI: fp.OI_f,
        Sales: fp.Sales_f,
        NFE: fp.NFE_f,
        operatingCostBridge: fp.bridge_mode === "cost_bridge" ? {
          ...(latestPeriod.is.operatingCostBridge ?? {
            materialCost: 0,
            employeeCost: 0,
            depreciation: 0,
            sgaAdvertising: 0,
            sgaLegalProfessional: 0,
            sgaRent: 0,
            sgaFreight: 0,
            sgaRepairs: 0,
            sgaPowerFuel: 0,
            sgaDetailed: 0,
            sgaResidual: 0,
            sgaTotal: 0,
            otherOperatingExpense: 0,
            otherOperatingIncome: 0,
            grossProfit: 0,
            operatingCosts: 0,
            bridgeCoreOI: 0,
            bridgeGapToReportedCoreOI: 0,
            coverageRatio: null,
            driverRatios: {
              materialCostPct: null,
              employeeCostPct: null,
              depreciationPct: null,
              sgaPct: null,
              otherOperatingExpensePct: null,
              otherOperatingIncomePct: null,
              bridgeCoreSalesPm: null,
            },
          }),
          materialCost: fp.MaterialCost_f ?? 0,
          employeeCost: fp.EmployeeCost_f ?? 0,
          depreciation: fp.Depreciation_f ?? 0,
          sgaAdvertising: 0,
          sgaLegalProfessional: 0,
          sgaRent: 0,
          sgaFreight: 0,
          sgaRepairs: 0,
          sgaPowerFuel: 0,
          sgaDetailed: fp.SGA_f ?? 0,
          sgaResidual: 0,
          sgaTotal: fp.SGA_f ?? 0,
          otherOperatingExpense: fp.OtherOperatingExpense_f ?? 0,
          otherOperatingIncome: fp.OtherOperatingIncome_f ?? 0,
          grossProfit: fp.GrossProfit_f ?? 0,
          operatingCosts: (fp.EmployeeCost_f ?? 0) + (fp.Depreciation_f ?? 0) + (fp.SGA_f ?? 0) + (fp.OtherOperatingExpense_f ?? 0),
          bridgeCoreOI: fp.CoreOI_bridge_f ?? fp.OI_f,
          bridgeGapToReportedCoreOI: (fp.CoreOI_bridge_f ?? fp.OI_f) - fp.OI_f,
          coverageRatio: latestPeriod.is.operatingCostBridge?.coverageRatio ?? null,
          driverRatios: {
            materialCostPct: fp.material_cost_ratio_assumption ?? null,
            employeeCostPct: fp.employee_cost_ratio_assumption ?? null,
            depreciationPct: fp.depreciation_ratio_assumption ?? null,
            sgaPct: fp.sga_ratio_assumption ?? null,
            otherOperatingExpensePct: fp.other_opex_ratio_assumption ?? null,
            otherOperatingIncomePct: fp.other_operating_income_ratio_assumption ?? null,
            bridgeCoreSalesPm: fp.core_sales_pm_assumption,
          },
        } : latestPeriod.is.operatingCostBridge,
      },
      cu: {
        ...latestPeriod.cu,
        CoreOI: fp.CoreOI_bridge_f ?? fp.OI_f,
      },
      cf: latestPeriod.cf,
    })),
  ];
}

export function applyDriverSensitivityToScenario(
  scenario: ForecastScenario,
  baseDrivers: Pick<Record<SensParam, number>, "core_pm" | "ato" | "sales_growth">,
  targetDrivers: Pick<Record<SensParam, number>, "core_pm" | "ato" | "sales_growth">,
): ForecastScenario {
  const scale = (target: number, base: number) => (base !== 0 ? target / base : 1);
  const pmScale = scale(targetDrivers.core_pm, baseDrivers.core_pm);
  const atoScale = scale(targetDrivers.ato, baseDrivers.ato);
  const salesScale = scale(targetDrivers.sales_growth, baseDrivers.sales_growth);

  return {
    ...scenario,
    drivers: {
      ...scenario.drivers,
      core_sales_pm: scenario.drivers.core_sales_pm.map((v) => v * pmScale),
      ato: scenario.drivers.ato.map((v) => v * atoScale),
      sales_growth: scenario.drivers.sales_growth.map((v) => v * salesScale),
      material_cost_ratio: scenario.drivers.material_cost_ratio?.map((v) => v / Math.max(pmScale, 1e-6)),
      employee_cost_ratio: scenario.drivers.employee_cost_ratio,
      depreciation_ratio: scenario.drivers.depreciation_ratio,
      sga_ratio: scenario.drivers.sga_ratio?.map((v) => v / Math.max(pmScale, 1e-6)),
      other_opex_ratio: scenario.drivers.other_opex_ratio?.map((v) => v / Math.max(pmScale, 1e-6)),
      other_operating_income_ratio: scenario.drivers.other_operating_income_ratio?.map((v) => v * Math.max(pmScale, 1)),
    },
  };
}

/* §4.3.3 Expected value across scenarios */
export function expectedValue(
  scenarios: ForecastScenario[],
  method: 'V_RE_CV3' | 'V_ReOI_CV03',
): number | null {
  let ev = 0, totalProb = 0;
  for (const sc of scenarios) {
    if (!sc.valuationResult) continue;
    const v = sc.valuationResult[method];
    if (v === undefined) continue;
    ev += sc.probability * v;
    totalProb += sc.probability;
  }
  return totalProb > 0 ? ev / totalProb : null;
}

/* §4.3.4 Sensitivity — vary one parameter ±20% */
export type SensParam = 'ke'|'kw'|'g'|'core_pm'|'ato'|'sales_growth';

export interface SensResult {
  param: SensParam;
  label: string;
  low: number;
  base: number;
  high: number;
  impact: number; // high - low
}

export function sensitivityAnalysis(
  baseV: number,
  params: Record<SensParam, number>,
  computeFn: (p: Record<SensParam, number>) => number,
): SensResult[] {
  const results: SensResult[] = [];
  for (const [param, baseVal] of Object.entries(params) as [SensParam, number][]) {
    const delta = baseVal !== 0 ? Math.abs(baseVal) * 0.20 : 0.005;
    const pLow  = { ...params, [param]: baseVal - delta };
    const pHigh = { ...params, [param]: baseVal + delta };
    const vLow  = computeFn(pLow);
    const vHigh = computeFn(pHigh);
    const LABELS: Record<SensParam, string> = {
      ke: 'Cost of Equity (ke)',
      kw: 'WACC (kw)',
      g:  'Terminal Growth (g)',
      core_pm: 'Core Sales PM',
      ato: 'Asset Turnover',
      sales_growth: 'Sales Growth',
    };
    results.push({ param, label: LABELS[param], low: vLow, base: baseV, high: vHigh, impact: Math.abs(vHigh - vLow) });
  }
  return results.sort((a, b) => b.impact - a.impact);
}
