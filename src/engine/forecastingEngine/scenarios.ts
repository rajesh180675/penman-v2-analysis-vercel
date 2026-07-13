import { RecastPeriod, ForecastPeriod, ForecastScenario, BusinessModelProfile, PersistenceScenarioTemplate } from "../types";
import type { LegacyValuationPeriodInput } from "../forecastState";
import { buildCyclicalNormalization } from "../cyclicalNormalization";
import { buildDriverForecastModel } from "../forecastDriverModel";
import { buildTerminalEconomics } from "../terminalEconomics";
import { clamp, makeFadeArray } from "./helpers";

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

function buildScenarioWeighting(args: {
  scenarioKey: "stress" | "base" | "bull" | "historical-panic";
  persistenceScore: number;
  companyEvidenceWeight: number;
  workingCapitalPressure: "low" | "medium" | "high";
  reinvestmentBurden: "light" | "moderate" | "heavy";
  terminalFadeYears: number;
}) {
  const fragilityPenalty = args.persistenceScore < 45 ? 0.08 : args.persistenceScore < 65 ? 0.03 : 0;
  const evidenceLift = args.companyEvidenceWeight >= 0.65 ? 0.05 : args.companyEvidenceWeight >= 0.45 ? 0.02 : -0.02;
  const pressurePenalty = args.workingCapitalPressure === "high" ? 0.04 : args.workingCapitalPressure === "medium" ? 0.02 : 0;
  const reinvestmentPenalty = args.reinvestmentBurden === "heavy" ? 0.04 : args.reinvestmentBurden === "moderate" ? 0.02 : 0;
  const fadeLift = args.terminalFadeYears >= 5 ? 0.03 : args.terminalFadeYears === 4 ? 0 : -0.02;

  const base = clamp(0.4 + evidenceLift + fadeLift - fragilityPenalty - pressurePenalty - reinvestmentPenalty, 0.3, 0.6);
  const stress = clamp(0.24 + fragilityPenalty + pressurePenalty + reinvestmentPenalty - evidenceLift * 0.4, 0.15, 0.4);
  const bull = clamp(0.16 + evidenceLift + fadeLift - fragilityPenalty * 0.6, 0.08, 0.28);
  const historicalPanicRaw = 1 - base - stress - bull;
  const historicalPanic = clamp(historicalPanicRaw, 0.08, 0.22);
  const total = base + stress + bull + historicalPanic;
  const weighting = {
    stress: stress / total,
    base: base / total,
    bull: bull / total,
    historicalPanic: historicalPanic / total,
  };
  const spread: "contained" | "balanced" | "wide" = weighting.base >= 0.45 && weighting.stress <= 0.25
    ? "contained"
    : weighting.stress >= 0.3 || weighting.historicalPanic >= 0.18
      ? "wide"
      : "balanced";
  const probability = args.scenarioKey === "historical-panic"
    ? weighting.historicalPanic
    : weighting[args.scenarioKey];

  return {
    probability,
    weighting,
    spread,
    rationale: [
      weighting.base >= 0.45
        ? "Base weight stays elevated because persistence evidence supports a narrower outcome range."
        : "Base weight is capped because persistence evidence does not support a narrow central case.",
      args.workingCapitalPressure === "high"
        ? "Working-capital stress shifts weight toward downside scenarios."
        : "Working-capital discipline does not force extra downside weighting.",
      args.reinvestmentBurden === "heavy"
        ? "Heavy reinvestment burden widens scenario dispersion."
        : "Reinvestment burden does not materially widen scenario dispersion.",
    ],
  };
}

export function buildPersistenceForecastScenarioSet(params: {
  periods?: RecastPeriod[] | undefined;
  latest: RecastPeriod;
  businessModel: BusinessModelProfile;
  horizon: number;
  template: PersistenceScenarioTemplate;
  riskInputs: {
    ke: number;
    kw: number;
    riskFreeRate: number;
  };
}) {
  return {
    stress: derivePersistenceForecastScenario({ ...params, scenarioKey: "stress" }),
    base: derivePersistenceForecastScenario({ ...params, scenarioKey: "base" }),
    bull: derivePersistenceForecastScenario({ ...params, scenarioKey: "bull" }),
    historicalPanic: derivePersistenceForecastScenario({ ...params, scenarioKey: "historical-panic" }),
  };
}

export function derivePersistenceForecastScenario(params: {
  scenarioKey: "stress" | "base" | "bull" | "historical-panic";
  periods?: RecastPeriod[] | undefined;
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

  const scenarioWeighting = buildScenarioWeighting({
    scenarioKey,
    persistenceScore: businessModel.persistenceScore,
    companyEvidenceWeight: driverPlan.companyEvidenceWeight,
    workingCapitalPressure: driverPlan.workingCapitalPressure,
    reinvestmentBurden: driverPlan.reinvestmentPosture,
    terminalFadeYears: terminalEconomics.fadeYears,
  });
  const spreadRiskAddOn = scenarioWeighting.spread === "wide" ? 0.005 : scenarioWeighting.spread === "balanced" ? 0.0025 : 0;

  const scenarioPresets = {
    stress: {
      name: "bear" as const,
      ke: riskInputs.ke + 0.02 + spreadRiskAddOn,
      kw: riskInputs.kw + 0.015 + spreadRiskAddOn,
      terminalGrowth: clamp(terminalEconomics.terminalGrowth, 0.015, 0.03),
    },
    base: {
      name: "base" as const,
      ke: riskInputs.ke,
      kw: riskInputs.kw,
      terminalGrowth: terminalEconomics.terminalGrowth,
    },
    bull: {
      name: "bull" as const,
      ke: Math.max(riskInputs.ke - (0.01 - spreadRiskAddOn * 0.5), riskInputs.riskFreeRate + 0.04),
      kw: Math.max(riskInputs.kw - (0.008 - spreadRiskAddOn * 0.4), riskInputs.riskFreeRate + 0.03),
      terminalGrowth: clamp(terminalEconomics.terminalGrowth * (scenarioWeighting.spread === "contained" ? 1.06 : 1.1), template.terminalGrowthFloor, template.terminalGrowthCap),
    },
    "historical-panic": {
      name: "bear" as const,
      ke: riskInputs.ke + 0.03 + spreadRiskAddOn,
      kw: riskInputs.kw + 0.0225 + spreadRiskAddOn,
      terminalGrowth: clamp(template.terminalGrowthFloor, 0.01, 0.025),
    },
  } as const;

  const preset = scenarioPresets[scenarioKey];

  return {
    name: preset.name,
    probability: scenarioWeighting.probability,
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
      scenarioWeighting: scenarioWeighting.weighting,
      scenarioSpread: scenarioWeighting.spread,
      scenarioWeightRationale: scenarioWeighting.rationale,
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
    material_cost_ratio?: number | null | undefined;
    employee_cost_ratio?: number | null | undefined;
    depreciation_ratio?: number | null | undefined;
    sga_ratio?: number | null | undefined;
    other_opex_ratio?: number | null | undefined;
    other_operating_income_ratio?: number | null | undefined;
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
    return value!;
  };
  const pickOptionalDriverValue = (values: number[] | undefined, idx: number): number | null => {
    if (!values?.length) return null;
    const value = values[Math.min(idx, values.length - 1)];
    if (!Number.isFinite(value)) {
      throw new Error(`Scenario driver contains non-finite optional value at index ${Math.min(idx, values.length - 1)}`);
    }
    return value!;
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
  forecastPeriods: readonly ForecastPeriod[],
): readonly LegacyValuationPeriodInput[] {
  const anchorDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(latestPeriod.period_end);
  if (!anchorDate) {
    throw new Error(`Invalid period_end year in latestPeriod: ${latestPeriod.period_end}`);
  }
  const baseYear = Number(anchorDate[1]);
  const dateSuffix = `${anchorDate[2]}-${anchorDate[3]}`;
  const valuationPeriods: LegacyValuationPeriodInput[] = [latestPeriod];
  let previousCommonEquity = latestPeriod.bs.CSE;

  forecastPeriods.forEach((forecast, index) => {
    const required = [forecast.CSE_f, forecast.NOA_f, forecast.CNI_f, forecast.OI_f];
    if (!required.every(Number.isFinite)) {
      throw new Error(`Forecast period ${index + 1} contains a non-finite valuation input.`);
    }

    // Clean-surplus distribution is reconstructed explicitly from the
    // forecasted common-income/equity roll-forward. Projected periods expose
    // only the structural fields consumed by valuation: no historical parser
    // trace, quality flag, operating-cost row, or cash-flow object is copied.
    const ownerDistribution = forecast.CNI_f - (forecast.CSE_f - previousCommonEquity);
    const period: LegacyValuationPeriodInput = {
      period_end: `${baseYear + index + 1}-${dateSuffix}`,
      bs: Object.freeze({
        CSE: forecast.CSE_f,
        NOA: forecast.NOA_f,
        NFO: forecast.NOA_f - forecast.CSE_f - latestPeriod.bs.MI,
        MI: latestPeriod.bs.MI,
        separationScore: latestPeriod.bs.separationScore,
      }),
      is: Object.freeze({ CNI: forecast.CNI_f, OI: forecast.OI_f }),
      cf: Object.freeze({
        DividendPaid: Math.max(0, ownerDistribution),
        d_t: ownerDistribution,
      }),
      ratios: Object.freeze({
        RNOA: forecast.NOA_f !== 0 ? forecast.OI_f / forecast.NOA_f : null,
      }),
    };
    valuationPeriods.push(Object.freeze(period));
    previousCommonEquity = forecast.CSE_f;
  });

  return Object.freeze(valuationPeriods);
}
