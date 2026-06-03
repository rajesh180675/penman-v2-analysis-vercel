import { CompanyType, RecastPeriod, ValuationSectorTemplate } from "./types";

export interface ValuationSectorTemplateDefinition {
  id: Exclude<ValuationSectorTemplate, "auto">;
  label: string;
  description: string;
  normalizedGrowth: number;
  terminalGrowthFloor: number;
  terminalGrowthCap: number;
  maintenanceCapexShare: number;
  maintenanceDepFloor: number;
  baseRequiredMarginOfSafety: number;
  stressBaseUpside: number;
  stressProtectedUpside: number;
  historicalExtremePercentile: number;
  growthFadeAlpha: number;
  marginFadeAlpha: number;
  atoFadeAlpha: number;
  companyEvidenceMaxWeight: number;
  growthGuardrailBand: number;
  marginGuardrailBand: number;
  atoGuardrailBand: number;
  cyclical: boolean;
  /** Phase C5: sector-specific ke adjustment for SOTP (additive, e.g. 0.02 = +2%). */
  keAdjustment: number;
}

export const VALUATION_SECTOR_TEMPLATES: Record<Exclude<ValuationSectorTemplate, "auto">, ValuationSectorTemplateDefinition> = {
  "consumer-staples": {
    id: "consumer-staples",
    label: "Consumer staples",
    description: "Stable demand, high cash conversion, modest reinvestment, slower fade in excess returns.",
    normalizedGrowth: 0.08,
    terminalGrowthFloor: 0.03,
    terminalGrowthCap: 0.05,
    maintenanceCapexShare: 0.72,
    maintenanceDepFloor: 0.95,
    baseRequiredMarginOfSafety: 0.22,
    stressBaseUpside: 0.22,
    stressProtectedUpside: 0.05,
    historicalExtremePercentile: 0.12,
    growthFadeAlpha: 0.78,
    marginFadeAlpha: 0.9,
    atoFadeAlpha: 0.94,
    companyEvidenceMaxWeight: 0.82,
    growthGuardrailBand: 0.035,
    marginGuardrailBand: 0.04,
    atoGuardrailBand: 0.4,
    cyclical: false,
    keAdjustment: -0.01,  // defensive sector, lower risk
  },
  paint: {
    id: "paint",
    label: "Paint / coatings",
    description: "Brand-led industrial consumer hybrid with high margins, strong working-capital discipline, and moderate capital intensity.",
    normalizedGrowth: 0.1,
    terminalGrowthFloor: 0.03,
    terminalGrowthCap: 0.055,
    maintenanceCapexShare: 0.68,
    maintenanceDepFloor: 0.9,
    baseRequiredMarginOfSafety: 0.23,
    stressBaseUpside: 0.24,
    stressProtectedUpside: 0.08,
    historicalExtremePercentile: 0.1,
    growthFadeAlpha: 0.8,
    marginFadeAlpha: 0.92,
    atoFadeAlpha: 0.95,
    companyEvidenceMaxWeight: 0.84,
    growthGuardrailBand: 0.04,
    marginGuardrailBand: 0.05,
    atoGuardrailBand: 0.45,
    cyclical: false,
    keAdjustment: -0.01,  // brand moat, lower risk
  },
  industrials: {
    id: "industrials",
    label: "Industrials",
    description: "Asset-backed operating businesses with medium cyclicality and reinvestment demands.",
    normalizedGrowth: 0.075,
    terminalGrowthFloor: 0.025,
    terminalGrowthCap: 0.045,
    maintenanceCapexShare: 0.75,
    maintenanceDepFloor: 1,
    baseRequiredMarginOfSafety: 0.28,
    stressBaseUpside: 0.25,
    stressProtectedUpside: 0.08,
    historicalExtremePercentile: 0.1,
    growthFadeAlpha: 0.72,
    marginFadeAlpha: 0.88,
    atoFadeAlpha: 0.92,
    companyEvidenceMaxWeight: 0.72,
    growthGuardrailBand: 0.03,
    marginGuardrailBand: 0.035,
    atoGuardrailBand: 0.35,
    cyclical: true,
    keAdjustment: 0,  // baseline industrial risk
  },
  commodities: {
    id: "commodities",
    label: "Commodity / cyclical",
    description: "High-variance margins, capital-cycle exposure, and wider required margin of safety.",
    normalizedGrowth: 0.05,
    terminalGrowthFloor: 0.02,
    terminalGrowthCap: 0.04,
    maintenanceCapexShare: 0.8,
    maintenanceDepFloor: 1.05,
    baseRequiredMarginOfSafety: 0.35,
    stressBaseUpside: 0.3,
    stressProtectedUpside: 0.12,
    historicalExtremePercentile: 0.08,
    growthFadeAlpha: 0.68,
    marginFadeAlpha: 0.84,
    atoFadeAlpha: 0.9,
    companyEvidenceMaxWeight: 0.68,
    growthGuardrailBand: 0.025,
    marginGuardrailBand: 0.03,
    atoGuardrailBand: 0.3,
    cyclical: true,
    keAdjustment: 0.02,  // commodity cyclicality, higher risk
  },
  retail: {
    id: "retail",
    label: "Retail / distribution",
    description: "Turnover-driven model with tighter margins, inventory drag, and rapid mean reversion.",
    normalizedGrowth: 0.09,
    terminalGrowthFloor: 0.03,
    terminalGrowthCap: 0.05,
    maintenanceCapexShare: 0.66,
    maintenanceDepFloor: 0.85,
    baseRequiredMarginOfSafety: 0.27,
    stressBaseUpside: 0.24,
    stressProtectedUpside: 0.07,
    historicalExtremePercentile: 0.1,
    growthFadeAlpha: 0.74,
    marginFadeAlpha: 0.86,
    atoFadeAlpha: 0.95,
    companyEvidenceMaxWeight: 0.78,
    growthGuardrailBand: 0.04,
    marginGuardrailBand: 0.035,
    atoGuardrailBand: 0.4,
    cyclical: false,
    keAdjustment: -0.005,  // consumer-facing, moderate moat
  },
  services: {
    id: "services",
    label: "Services / light-asset",
    description: "Lower tangible reinvestment, higher people-cost intensity, and faster owner-earnings conversion.",
    normalizedGrowth: 0.09,
    terminalGrowthFloor: 0.03,
    terminalGrowthCap: 0.05,
    maintenanceCapexShare: 0.55,
    maintenanceDepFloor: 0.75,
    baseRequiredMarginOfSafety: 0.24,
    stressBaseUpside: 0.22,
    stressProtectedUpside: 0.06,
    historicalExtremePercentile: 0.12,
    growthFadeAlpha: 0.78,
    marginFadeAlpha: 0.9,
    atoFadeAlpha: 0.96,
    companyEvidenceMaxWeight: 0.85,
    growthGuardrailBand: 0.045,
    marginGuardrailBand: 0.05,
    atoGuardrailBand: 0.5,
    cyclical: false,
    keAdjustment: -0.015,  // asset-light, high ROCE, lower risk
  },
  telecom: {
    id: "telecom",
    label: "Telecom / spectrum network",
    description: "Spectrum/licence-heavy network operator model with high fixed-cost leverage, heavy maintenance capex, and regulated tariff sensitivity.",
    normalizedGrowth: 0.075,
    terminalGrowthFloor: 0.025,
    terminalGrowthCap: 0.045,
    maintenanceCapexShare: 0.86,
    maintenanceDepFloor: 1.1,
    baseRequiredMarginOfSafety: 0.34,
    stressBaseUpside: 0.28,
    stressProtectedUpside: 0.1,
    historicalExtremePercentile: 0.08,
    growthFadeAlpha: 0.7,
    marginFadeAlpha: 0.84,
    atoFadeAlpha: 0.9,
    companyEvidenceMaxWeight: 0.68,
    growthGuardrailBand: 0.03,
    marginGuardrailBand: 0.035,
    atoGuardrailBand: 0.3,
    cyclical: true,
    keAdjustment: 0.015,
  },
  utility: {
    id: "utility",
    label: "Utility / regulated asset base",
    description: "Rate-base utility model with CWIP/regulatory-deferral evidence, lower demand volatility, and high capital intensity.",
    normalizedGrowth: 0.065,
    terminalGrowthFloor: 0.025,
    terminalGrowthCap: 0.045,
    maintenanceCapexShare: 0.88,
    maintenanceDepFloor: 1.05,
    baseRequiredMarginOfSafety: 0.3,
    stressBaseUpside: 0.24,
    stressProtectedUpside: 0.08,
    historicalExtremePercentile: 0.1,
    growthFadeAlpha: 0.74,
    marginFadeAlpha: 0.88,
    atoFadeAlpha: 0.92,
    companyEvidenceMaxWeight: 0.72,
    growthGuardrailBand: 0.025,
    marginGuardrailBand: 0.03,
    atoGuardrailBand: 0.3,
    cyclical: false,
    keAdjustment: -0.005,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function inferTemplateId(latest: RecastPeriod): Exclude<ValuationSectorTemplate, "auto"> {
  const salesPm = latest.ratios?.CoreSalesPM ?? latest.ratios?.PM ?? 0;
  const ato = latest.ratios?.ATO ?? 0;
  const cashConversion = latest.ratios?.cash_conversion_ratio ?? 0;
  const capexIntensity = latest.is.Sales !== 0 ? Math.abs(latest.cf.Capex ?? 0) / Math.max(latest.is.Sales, 1) : 0;
  const grossMargin = latest.is.operatingCostBridge?.grossProfit != null && latest.is.Sales !== 0
    ? latest.is.operatingCostBridge.grossProfit / Math.max(latest.is.Sales, 1)
    : null;

  if (salesPm >= 0.18 && cashConversion >= 0.85 && capexIntensity <= 0.06 && (grossMargin ?? 0) >= 0.45) {
    return "paint";
  }
  if (salesPm >= 0.14 && cashConversion >= 0.8 && capexIntensity <= 0.07) {
    return "consumer-staples";
  }
  if (ato >= 1.8 && salesPm <= 0.09) {
    return "retail";
  }
  if (capexIntensity >= 0.1 || salesPm <= 0.08) {
    return "industrials";
  }
  if (clamp(latest.ratios?.RNOA ?? 0, -1, 1) <= 0.07 || cashConversion <= 0.65) {
    return "commodities";
  }
  return "services";
}

function templateFromCompanyType(companyType: CompanyType | null | undefined): Exclude<ValuationSectorTemplate, "auto"> | null {
  switch (companyType) {
    case "telecom":
      return "telecom";
    case "utility":
      return "utility";
    case "consumer":
      return "consumer-staples";
    case "it-services":
      return "services";
    case "cyclical":
      return "commodities";
    default:
      return null;
  }
}

export function resolveValuationSectorTemplate(
  data: RecastPeriod[],
  preferredTemplate: ValuationSectorTemplate | null | undefined,
  companyType?: CompanyType | null | undefined,
) {
  const latest = data[data.length - 1]!;
  const companyTypeTemplate = preferredTemplate == null || preferredTemplate === "auto"
    ? templateFromCompanyType(companyType)
    : null;
  const resolvedId = preferredTemplate && preferredTemplate !== "auto"
    ? preferredTemplate
    : companyTypeTemplate ?? inferTemplateId(latest);
  const template = VALUATION_SECTOR_TEMPLATES[resolvedId];
  return {
    template,
    source: preferredTemplate && preferredTemplate !== "auto" ? "user" : companyTypeTemplate ? "company-type" : "auto",
  } as const;
}
