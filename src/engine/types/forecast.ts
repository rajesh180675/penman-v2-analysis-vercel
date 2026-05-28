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
  companyEvidenceMaxWeight?: number;
  growthGuardrailBand?: number;
  marginGuardrailBand?: number;
  atoGuardrailBand?: number;
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
  bridge_mode?: 'margin'|'cost_bridge';
  material_cost_ratio_assumption?: number | null;
  employee_cost_ratio_assumption?: number | null;
  depreciation_ratio_assumption?: number | null;
  sga_ratio_assumption?: number | null;
  other_opex_ratio_assumption?: number | null;
  other_operating_income_ratio_assumption?: number | null;
  MaterialCost_f?: number | null;
  EmployeeCost_f?: number | null;
  Depreciation_f?: number | null;
  SGA_f?: number | null;
  OtherOperatingExpense_f?: number | null;
  OtherOperatingIncome_f?: number | null;
  GrossProfit_f?: number | null;
  CoreOI_bridge_f?: number | null;
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
  companyEvidenceWeight?: number;
  persistenceScore?: number;
  templateGuardrailStrength?: number;
  terminalAnchorSource?: 'company-evidence'|'blended'|'template';
  workingCapitalPressure?: 'low' | 'medium' | 'high';
  reinvestmentBurden?: 'light' | 'moderate' | 'heavy';
  balanceSheetFlexibility?: 'strong' | 'adequate' | 'tight';
  operatingMode?: 'cost-bridge' | 'margin';
  terminalFadeYears?: number;
  terminalEconomicsRationale?: string[];
  scenarioWeighting?: ScenarioWeightingSurface;
  scenarioSpread?: ScenarioSpreadPosture;
  scenarioWeightRationale?: string[];
  narrative?: string[];
}

export interface ForecastScenario {
  name: 'bull'|'base'|'bear'|'custom';
  probability: number;
  horizonT: number;
  drivers: {
    sales_growth: number[]; core_sales_pm: number[];
    ato: number[]; flev: number[]; nbc: number[];
    material_cost_ratio?: number[];
    employee_cost_ratio?: number[];
    depreciation_ratio?: number[];
    sga_ratio?: number[];
    other_opex_ratio?: number[];
    other_operating_income_ratio?: number[];
    g_terminal: number; ke: number; kw: number;
  };
  forecastPolicy?: ForecastPolicySurface;
  periods?: ForecastPeriod[];
  valuationResult?: ValuationResult;
}
