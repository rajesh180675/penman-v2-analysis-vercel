import { CyclicalNormalizationOutput } from "./cyclicalNormalization";
import { BusinessModelProfile, DriverForecastPlan, PersistenceScenarioTemplate, RecastPeriod } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function blendAnchor(latest: number | null, historical: number | null, evidenceWeight: number, minWeightOnHistory = 0.3) {
  if (latest == null) return historical;
  if (historical == null) return latest;
  const latestWeight = clamp(evidenceWeight, 1 - minWeightOnHistory, 0.85);
  return latest * latestWeight + historical * (1 - latestWeight);
}

export function buildDriverForecastModel(args: {
  data: RecastPeriod[];
  latest: RecastPeriod;
  businessModel: BusinessModelProfile;
  normalized: CyclicalNormalizationOutput;
  scenarioKey: "stress" | "base" | "bull" | "historical-panic";
  template: PersistenceScenarioTemplate;
}): DriverForecastPlan {
  const { latest, businessModel, normalized, scenarioKey, template } = args;
  const latestRatios = latest.ratios;
  const persistence = clamp(businessModel.persistenceScore / 100, 0, 1);
  const bridgeCoverage = latest.is.operatingCostBridge?.coverageRatio ?? null;
  const cashConversion = latestRatios?.cash_conversion_ratio ?? businessModel.historicalAnchors.cashConversion ?? null;
  const noaGrowth = latestRatios?.NOA_growth ?? null;
  const salesGrowth = latestRatios?.Sales_growth ?? null;
  const leverage = latestRatios?.FLEV ?? null;

  const persistenceBand = businessModel.persistenceScore >= 65
    ? "durable"
    : businessModel.persistenceScore >= 45
      ? "mixed"
      : "fragile";

  const workingCapitalPressure = cashConversion != null && cashConversion < 0.65
    ? "high"
    : cashConversion != null && cashConversion < 0.82
      ? "medium"
      : "low";

  const reinvestmentPosture = noaGrowth != null && salesGrowth != null && (
    noaGrowth > salesGrowth + 0.08
    || ((cashConversion ?? 1) < 0.55 && noaGrowth > salesGrowth + 0.02)
    || ((cashConversion ?? 1) < 0.6 && noaGrowth > 0.22)
  )
    ? "heavy"
    : noaGrowth != null && salesGrowth != null && noaGrowth > salesGrowth + 0.02
      ? "moderate"
      : "light";

  const balanceSheetFlexibility = leverage != null && leverage > 0.7
    ? "tight"
    : leverage != null && leverage > 0.35
      ? "adequate"
      : "strong";

  const companyEvidenceWeight = clamp(
    0.25
      + persistence * 0.55
      - (workingCapitalPressure === "high" ? 0.08 : workingCapitalPressure === "medium" ? 0.03 : 0)
      - (reinvestmentPosture === "heavy" ? 0.05 : reinvestmentPosture === "moderate" ? 0.02 : 0)
      - (balanceSheetFlexibility === "tight" ? 0.05 : balanceSheetFlexibility === "adequate" ? 0.02 : 0)
      + ((bridgeCoverage ?? 0.75) >= 0.8 ? 0.03 : (bridgeCoverage ?? 0.75) < 0.65 ? -0.05 : 0),
    0.25,
    template.companyEvidenceMaxWeight ?? 0.8,
  );

  const blendedSalesGrowth = blendAnchor(
    latestRatios?.Sales_growth ?? null,
    businessModel.historicalAnchors.salesGrowth ?? template.normalizedGrowth,
    companyEvidenceWeight,
    0.35,
  ) ?? template.normalizedGrowth;
  const blendedMargin = blendAnchor(
    latestRatios?.CoreSalesPM ?? latestRatios?.PM ?? null,
    businessModel.historicalAnchors.corePm ?? normalized.normalizedMargin ?? 0.1,
    companyEvidenceWeight,
    0.4,
  ) ?? normalized.normalizedMargin ?? 0.1;
  const blendedAto = blendAnchor(
    latestRatios?.ATO ?? null,
    businessModel.historicalAnchors.ato ?? normalized.normalizedAto ?? 1,
    companyEvidenceWeight,
    0.35,
  ) ?? normalized.normalizedAto ?? 1;

  const growthGuardrailBand = template.growthGuardrailBand ?? 0.04;
  const marginGuardrailBand = template.marginGuardrailBand ?? 0.05;
  const atoGuardrailBand = template.atoGuardrailBand ?? 0.45;
  const fadePenalty = persistenceBand === "fragile" ? 0.12 : persistenceBand === "mixed" ? 0.07 : 0.03;

  const growthTarget = clamp(
    (businessModel.historicalAnchors.salesGrowth ?? template.normalizedGrowth) * (0.75 + persistence * 0.35),
    Math.max(template.normalizedGrowth - growthGuardrailBand, -0.02),
    template.normalizedGrowth + growthGuardrailBand,
  );
  const marginTarget = clamp(
    (businessModel.historicalAnchors.corePm ?? normalized.normalizedMargin ?? 0.1) * (0.85 + persistence * 0.2),
    Math.max((businessModel.historicalAnchors.corePm ?? normalized.normalizedMargin ?? 0.1) - marginGuardrailBand, 0.03),
    Math.min((businessModel.historicalAnchors.corePm ?? normalized.normalizedMargin ?? 0.1) + marginGuardrailBand, 0.2),
  );
  const atoAnchor = businessModel.historicalAnchors.ato ?? normalized.normalizedAto ?? 1;
  const atoTarget = clamp(
    atoAnchor * (0.95 + persistence * 0.1),
    Math.max(atoAnchor - atoGuardrailBand, 0.35),
    Math.min(atoAnchor + atoGuardrailBand, 2.2),
  );

  const scenarioPresets = {
    stress: {
      growthStart: clamp(blendedSalesGrowth * (0.35 + persistence * 0.05) - 0.01, -0.04, 0.08),
      marginStart: clamp(blendedMargin * (0.62 + persistence * 0.08), 0.02, 0.2),
      atoStart: clamp(blendedAto * (0.86 + persistence * 0.04), 0.35, 2),
    },
    base: {
      growthStart: clamp(blendedSalesGrowth, 0.01, Math.max(0.18, template.normalizedGrowth + 0.03)),
      marginStart: clamp(blendedMargin, 0.04, 0.3),
      atoStart: clamp(blendedAto, 0.4, 2.5),
    },
    bull: {
      growthStart: clamp(blendedSalesGrowth * (1.08 + persistence * 0.12), 0.03, Math.max(0.24, template.normalizedGrowth + 0.08)),
      marginStart: clamp(blendedMargin * (1.03 + persistence * 0.07), 0.05, 0.34),
      atoStart: clamp(blendedAto * (0.99 + persistence * 0.04), 0.45, 2.8),
    },
    "historical-panic": {
      growthStart: clamp(blendedSalesGrowth * 0.12 - 0.02, -0.08, 0.04),
      marginStart: clamp(blendedMargin * 0.5, 0.01, 0.16),
      atoStart: clamp(blendedAto * 0.82, 0.3, 1.8),
    },
  } as const;

  const preset = scenarioPresets[scenarioKey];
  const operatingMode = bridgeCoverage != null && bridgeCoverage >= 0.72 ? "cost-bridge" : "margin";
  const growthAlpha = clamp(template.growthFadeAlpha - fadePenalty, 0.45, 0.96);
  const marginAlpha = clamp(template.marginFadeAlpha - fadePenalty, 0.5, 0.97);
  const atoAlpha = clamp(template.atoFadeAlpha - fadePenalty * 0.7, 0.6, 0.98);

  return {
    persistenceBand,
    companyEvidenceWeight,
    templateGuardrailStrength: clamp(1 - companyEvidenceWeight, 0.2, 0.75),
    operatingMode,
    workingCapitalPressure,
    reinvestmentPosture,
    balanceSheetFlexibility,
    year1: {
      salesGrowth: preset.growthStart,
      coreMargin: preset.marginStart,
      ato: preset.atoStart,
    },
    targets: {
      salesGrowth: growthTarget,
      coreMargin: marginTarget,
      ato: atoTarget,
    },
    fade: {
      growthAlpha,
      marginAlpha,
      atoAlpha,
    },
    capitalIntensityNarrative: [
      `ATO anchor ${atoTarget.toFixed(2)}x versus latest ${(latest.ratios?.ATO ?? 0).toFixed(2)}x.`,
      workingCapitalPressure === "high"
        ? "Working-capital drag is elevated and reduces persistence confidence."
        : "Working-capital drag is contained enough to avoid extra fade pressure.",
    ],
    narrative: [
      ...businessModel.evidence,
      workingCapitalPressure === "high"
        ? "Working-capital pressure is high, so growth fades faster and capital efficiency must rebuild from a lower-confidence base."
        : "Working-capital discipline does not force additional fade pressure.",
      `Scenario ${scenarioKey} starts at ${(preset.growthStart * 100).toFixed(1)}% growth and fades toward ${(growthTarget * 100).toFixed(1)}%.`,
    ],
  } satisfies DriverForecastPlan;
}
