/* ================================================================
   Forecast types
   Multi-period scenario forecasting: business-model profile,
   persistence templates, scenario weighting, ForecastPeriod
   trajectory rows, and the ForecastScenario aggregate.
================================================================ */

import type { ValuationResult } from "./valuation";

export interface BusinessModelProfile {
  persistenceScore: number;
  demandStabilityScore: number;
  marginDurabilityScore: number;
  capitalIntensityScore: number;
  workingCapitalDisciplineScore: number;
  reinvestmentQualityScore: number;
  evidence: string[];
  historicalAnchors: {
    salesGrowth: number | null;
    corePm: number | null;
    ato: number | null;
    spread: number | null;
    cashConversion: number | null;
  };
}

export interface PersistenceScenarioTemplate {
  normalizedGrowth: number;
  terminalGrowthFloor: number;
  terminalGrowthCap: number;
  growthFadeAlpha: number;
  marginFadeAlpha: number;
  atoFadeAlpha: number;
  companyEvidenceMaxWeight?: number | undefined;
  growthGuardrailBand?: number | undefined;
  marginGuardrailBand?: number | undefined;
  atoGuardrailBand?: number | undefined;
}

export interface DriverForecastPlan {
  persistenceBand: "durable" | "mixed" | "fragile";
  companyEvidenceWeight: number;
  templateGuardrailStrength: number;
  operatingMode: "cost-bridge" | "margin";
  workingCapitalPressure: "low" | "medium" | "high";
  reinvestmentPosture: "light" | "moderate" | "heavy";
  balanceSheetFlexibility: "strong" | "adequate" | "tight";
  year1: {
    salesGrowth: number;
    coreMargin: number;
    ato: number;
  };
  targets: {
    salesGrowth: number;
    coreMargin: number;
    ato: number;
  };
  fade: {
    growthAlpha: number;
    marginAlpha: number;
    atoAlpha: number;
  };
  capitalIntensityNarrative: string[];
  narrative: string[];
}

export interface ForecastPeriod {
  year_offset: number; period_label: string;
  sales_growth_assumption: number; core_sales_pm_assumption: number;
  ato_assumption: number; flev_assumption: number; nbc_assumption: number;
  Sales_f: number; NOA_f: number; OI_f: number;
  NFE_f: number; CNI_f: number; CSE_f: number; NFO_f: number;
  ΔNOA_f: number; FCF_f: number; RE_f: number; ReOI_f: number;
  source: 'user'|'fade'|'mean_reversion'|'flat';
  bridge_mode?: 'margin'|'cost_bridge' | undefined;
  material_cost_ratio_assumption?: number | null | undefined;
  employee_cost_ratio_assumption?: number | null | undefined;
  depreciation_ratio_assumption?: number | null | undefined;
  sga_ratio_assumption?: number | null | undefined;
  other_opex_ratio_assumption?: number | null | undefined;
  other_operating_income_ratio_assumption?: number | null | undefined;
  MaterialCost_f?: number | null | undefined;
  EmployeeCost_f?: number | null | undefined;
  Depreciation_f?: number | null | undefined;
  SGA_f?: number | null | undefined;
  OtherOperatingExpense_f?: number | null | undefined;
  OtherOperatingIncome_f?: number | null | undefined;
  GrossProfit_f?: number | null | undefined;
  CoreOI_bridge_f?: number | null | undefined;
}

export interface TerminalEconomicsOutput {
  terminalRoic: number | null;
  terminalGrowth: number;
  terminalReinvestmentRate: number | null;
  fadeYears: number;
  competitionPressure: "low" | "medium" | "high";
  summary: string;
  rationale: string[];
}

export type ForecastScenarioKey = "stress" | "base" | "bull" | "historical-panic";

export interface ForecastScenarioWeighting {
  stress: number;
  base: number;
  bull: number;
  historicalPanic: number;
}

export interface ForecastProbabilityState {
  weights: ForecastScenarioWeighting;
  total: number;
  isValid: boolean;
  reason: string | null;
}

export interface ForecastScenarioCardSurface {
  key: ForecastScenarioKey;
  label: string;
  probability: number;
  forecast: ForecastScenario;
}

export type ScenarioWeightingSurface = ForecastScenarioWeighting;

export type ScenarioSpreadPosture = "contained" | "balanced" | "wide";

export interface ForecastPolicySurface {
  companyEvidenceWeight?: number | undefined;
  persistenceScore?: number | undefined;
  templateGuardrailStrength?: number | undefined;
  terminalAnchorSource?: 'company-evidence'|'blended'|'template' | undefined;
  workingCapitalPressure?: 'low' | 'medium' | 'high' | undefined;
  reinvestmentBurden?: 'light' | 'moderate' | 'heavy' | undefined;
  balanceSheetFlexibility?: 'strong' | 'adequate' | 'tight' | undefined;
  operatingMode?: 'cost-bridge' | 'margin' | undefined;
  terminalFadeYears?: number | undefined;
  terminalEconomicsRationale?: string[] | undefined;
  scenarioWeighting?: ScenarioWeightingSurface | undefined;
  scenarioSpread?: ScenarioSpreadPosture | undefined;
  scenarioWeightRationale?: string[] | undefined;
  narrative?: string[] | undefined;
}

export interface ForecastScenario {
  name: 'bull'|'base'|'bear'|'custom';
  probability: number;
  horizonT: number;
  drivers: {
    sales_growth: number[]; core_sales_pm: number[];
    ato: number[]; flev: number[]; nbc: number[];
    material_cost_ratio?: number[] | undefined;
    employee_cost_ratio?: number[] | undefined;
    depreciation_ratio?: number[] | undefined;
    sga_ratio?: number[] | undefined;
    other_opex_ratio?: number[] | undefined;
    other_operating_income_ratio?: number[] | undefined;
    g_terminal: number; ke: number; kw: number;
  };
  forecastPolicy?: ForecastPolicySurface | undefined;
  periods?: ForecastPeriod[] | undefined;
  valuationResult?: ValuationResult | undefined;
}
