import { RecastPeriod, EngineConfig, ForecastScenario, BusinessModelProfile } from "../types";
import { resolveShareBasis } from "../shareCountTools";
import { computeValuation } from "../PenmanNissimEngine";
import { buildScenario, buildValuationPeriodsFromForecast, derivePersistenceForecastScenario } from "../forecastingEngine";
import { ValuationSectorTemplateDefinition } from "../valuationSectorTemplates";
import { buildSOTPValuation, SOTP_PRESETS, SOTPResult } from "../sotpValuation";
import { runSOTPFromSegmentData, segmentDataToDefinitions } from "../segmentSOTPBridge";
import type { SegmentData } from "../segmentParser";
import { evaluateWorkingCapitalGate, WorkingCapitalGateResult } from "../valuation/workingCapitalGate";
import { checkCleanSurplus, CleanSurplusResult } from "../valuation/cleanSurplus";
import { selectIndustryBetaForCompanyType, capmKe, CapmResult } from "../valuation/damodaranCapm";
import { runReverseDcfMonteCarlo, ReverseDcfMonteCarloResult } from "../valuation/reverseDcfMonteCarlo";
import { computeOwnerEarningsDcf } from "./solvers";
import {
  ValuationScenarioCard,
  DcfCashFlowDiagnostics,
  ConglomerateAssessment,
} from "./types";
import {
  clamp,
  annualizedReturn,
  marginOfSafety,
  computeScenarioIntrinsicPerShare,
  normalizeScenarioCards,
} from "./helpers";

export function buildSotpAssessment(
  segmentData: SegmentData | null | undefined,
  config: EngineConfig,
  latest: RecastPeriod,
  keBase: number,
): { sotpResult: SOTPResult | null; conglomerateAssessment: ConglomerateAssessment | null } {
  let sotpResult: SOTPResult | null = null;
  let conglomerateAssessment: ConglomerateAssessment | null = null;

  if (segmentData && segmentData.segmentationType === "business" && segmentData.segments.length >= 2) {
    // Phase C5: use actual parsed segment data
    const enhanced = runSOTPFromSegmentData(segmentData, latest, keBase);
    sotpResult = enhanced;
    const { definitions } = segmentDataToDefinitions(segmentData);
    const distinctTemplates = new Set(definitions.map(d => d.sectorTemplate));
    const maxShare = definitions.length > 0 ? Math.max(...definitions.map(d => d.operatingProfitShare)) : 0;
    const dominantDef = definitions.reduce((a, b) => a && a.operatingProfitShare > b.operatingProfitShare ? a : b, definitions[0]);
    const isConglomerate = definitions.length >= 3 && distinctTemplates.size >= 2;
    conglomerateAssessment = {
      isConglomerate,
      segmentCount: definitions.length,
      distinctSectorTemplates: distinctTemplates.size,
      dominantSegmentPct: maxShare,
      dominantSegmentName: dominantDef?.name ?? "",
      dataSource: "parsed",
      sotpPreferred: isConglomerate && distinctTemplates.size >= 2,
    };
  } else {
    // Fallback: preset-based SOTP
    const sotpPresetKey = config.sotp_preset ?? null;
    if (sotpPresetKey && sotpPresetKey in SOTP_PRESETS) {
      const presetDefs = SOTP_PRESETS[sotpPresetKey]!;
      sotpResult = buildSOTPValuation(latest, presetDefs, keBase);
      const distinctTemplates = new Set(presetDefs.map(d => d.sectorTemplate));
      const maxShare = Math.max(...presetDefs.map(d => d.operatingProfitShare));
      const dominantDef = presetDefs.reduce((a, b) => a && a.operatingProfitShare > b.operatingProfitShare ? a : b, presetDefs[0]);
      const isConglomerate = presetDefs.length >= 3 && distinctTemplates.size >= 2;
      conglomerateAssessment = {
        isConglomerate,
        segmentCount: presetDefs.length,
        distinctSectorTemplates: distinctTemplates.size,
        dominantSegmentPct: maxShare,
        dominantSegmentName: dominantDef?.name ?? "",
        dataSource: "preset",
        sotpPreferred: isConglomerate && distinctTemplates.size >= 2,
      };
    }
  }

  return { sotpResult, conglomerateAssessment };
}

export function buildClassAModels(
  data: RecastPeriod[],
  config: EngineConfig,
  latest: RecastPeriod,
  shares: number | null,
  marketPrice: number | null,
  keBase: number,
): {
  workingCapitalGateResult: WorkingCapitalGateResult | null;
  cleanSurplusResult: CleanSurplusResult | null;
  damodaranCapmResult: CapmResult | null;
  reverseDcfMonteCarloResult: ReverseDcfMonteCarloResult | null;
} {
  // workingCapitalGate: CCC-based quality gate
  const wcgPeriods = data.length >= 2
    ? data.map((p) => ({
        periodEnd: p.period_end,
        revenue: p.is.Sales,
        cogs: p.is.COGS,
        receivables: p.bs.TradeReceivables,
        inventory: p.bs.Inventory,
        payables: p.bs.TradePayables,
      }))
    : null;
  const workingCapitalGateResult: WorkingCapitalGateResult | null = wcgPeriods
    ? evaluateWorkingCapitalGate({ periods: wcgPeriods, sectorKey: config.company_type ?? undefined })
    : null;

  // cleanSurplus: detects dirty-surplus accounting
  const cleanSurplusResult: CleanSurplusResult | null = data.length >= 2
    ? checkCleanSurplus({
        periods: data.map((p) => ({
          periodEnd: p.period_end,
          commonEquity: p.bs.CSE,
          // CSE excludes minority interest (recast: CSE = totalSE - MI), so the
          // comprehensive-income basis must also be parent-attributable. Group
          // TCI includes the NCI share; subtract TCI_NCI to align the bases,
          // else every period's residual falsely absorbs the minority's CI and
          // flags a phantom dirty-surplus for any firm with non-wholly-owned
          // subsidiaries. Preferred dividends are left in TCI to net against the
          // total DividendPaid term below (using CNI would double-remove them).
          comprehensiveIncome: p.is.TCI - p.is.TCI_NCI,
          dividends: Math.abs(p.cf.DividendPaid),
          netStockIssuance: p.cf.EquityIssued - p.cf.ShareBuybacks,
        })),
      })
    : null;

  // damodaranCapm: independent ke cross-check from Damodaran industry betas.
  // Resolve via the deterministic CompanyType→industry map (the free-text matcher
  // mis-resolves enum values like "auto"/"it-services").
  const industryBeta = config.company_type ? selectIndustryBetaForCompanyType(config.company_type) : null;
  const damodaranCapmResult: CapmResult | null = industryBeta
    ? capmKe({ beta: industryBeta.leveredBeta })
    : null;

  // reverseDcfMonteCarlo: implied terminal growth distribution
  const revenuePerShare = shares && shares > 0 ? latest.is.Sales / shares : null;
  const historicalMargins = data.map((p) => p.is.Sales > 0 ? p.cf.FCF_cash / p.is.Sales : 0).filter(Number.isFinite);
  const historicalGrowths = data.slice(1).map((p, i) => data[i]!.is.Sales > 0 ? (p.is.Sales - data[i]!.is.Sales) / data[i]!.is.Sales : 0).filter(Number.isFinite);
  const meanMargin = historicalMargins.length ? historicalMargins.reduce((a, b) => a + b, 0) / historicalMargins.length : 0.10;
  const meanGrowth = historicalGrowths.length ? historicalGrowths.reduce((a, b) => a + b, 0) / historicalGrowths.length : 0.08;
  const sigmaMargin = historicalMargins.length > 1 ? Math.sqrt(historicalMargins.reduce((s, v) => s + (v - meanMargin) ** 2, 0) / (historicalMargins.length - 1)) : 0.03;
  const sigmaGrowth = historicalGrowths.length > 1 ? Math.sqrt(historicalGrowths.reduce((s, v) => s + (v - meanGrowth) ** 2, 0) / (historicalGrowths.length - 1)) : 0.04;
  const reverseDcfMonteCarloResult: ReverseDcfMonteCarloResult | null =
    marketPrice != null && marketPrice > 0 && revenuePerShare != null && revenuePerShare > 0
      ? runReverseDcfMonteCarlo({
          runId: `${config.ticker ?? "unknown"}-${latest.period_end}`,
          currentPrice: marketPrice,
          revenuePerShare,
          margin: { mean: meanMargin, sigma: Math.max(sigmaMargin, 0.01) },
          growth: { mean: meanGrowth, sigma: Math.max(sigmaGrowth, 0.01) },
          wacc: { mean: keBase, sigma: 0.015 },
        })
      : null;

  return { workingCapitalGateResult, cleanSurplusResult, damodaranCapmResult, reverseDcfMonteCarloResult };
}

export function buildScenarioCards(args: {
  config: EngineConfig;
  sectorTemplate: ValuationSectorTemplateDefinition;
  latest: RecastPeriod;
  shareBasis: ReturnType<typeof resolveShareBasis>;
  diagnostics: DcfCashFlowDiagnostics;
  marketPrice: number | null;
  businessModel: BusinessModelProfile;
  keBase: number;
  kwBase: number;
  riskFreeRate: number;
  valuationData: RecastPeriod[];
  horizon: number;
}): {
  scenarios: ValuationScenarioCard[];
  derivedScenarios: {
    stress: ForecastScenario;
    base: ForecastScenario;
    bull: ForecastScenario;
    historicalPanic: ForecastScenario;
  };
} {
  const { config, sectorTemplate, latest, shareBasis, diagnostics, marketPrice, businessModel, keBase, kwBase, riskFreeRate, valuationData, horizon } = args;
  const makeScenario = (
    key: ValuationScenarioCard["key"],
    scenario: ForecastScenario,
    reinvestmentLift: number,
  ) => {
    const terminalGrowth = clamp(
      config.g_terminal_override ?? scenario.drivers.g_terminal,
      sectorTemplate.terminalGrowthFloor,
      sectorTemplate.terminalGrowthCap,
    );
    const scenarioWithTerminal = {
      ...scenario,
      drivers: {
        ...scenario.drivers,
        g_terminal: terminalGrowth,
      },
    } satisfies ForecastScenario;
    const periods = buildScenario(scenarioWithTerminal, latest);
    const valuationPeriods = buildValuationPeriodsFromForecast(latest, periods);
    const valuation = computeValuation(
      valuationPeriods,
      scenarioWithTerminal.drivers.ke,
      scenarioWithTerminal.drivers.kw,
      terminalGrowth,
      shareBasis.valuationConfig,
    );
    const ownerDcf = computeOwnerEarningsDcf(diagnostics.ownerEarningsPerShare, scenarioWithTerminal.drivers.sales_growth, scenarioWithTerminal.drivers.ke, terminalGrowth);
    const intrinsicPerShare = computeScenarioIntrinsicPerShare(valuation, ownerDcf);
    const marginOfSafetyPct = marginOfSafety(intrinsicPerShare, marketPrice);
    return {
      key,
      label: key === "stress" ? "Stress case" : key === "base" ? "Base case" : key === "bull" ? "Bull case" : "Historical panic",
      scenario: scenarioWithTerminal,
      intrinsicPerShare,
      ownerEarningsDcfPerShare: ownerDcf,
      upsidePct: intrinsicPerShare != null && marketPrice != null && marketPrice > 0 ? (intrinsicPerShare - marketPrice) / marketPrice : null,
      marginOfSafetyPct,
      expectedCagr: annualizedReturn(marketPrice, intrinsicPerShare, 3),
      valuation,
      forecastPolicy: scenarioWithTerminal.forecastPolicy,
      assumptions: {
        ke: scenarioWithTerminal.drivers.ke,
        kw: scenarioWithTerminal.drivers.kw,
        g: terminalGrowth,
        salesGrowthYear1: scenarioWithTerminal.drivers.sales_growth[0] ?? 0,
        corePmYear1: scenarioWithTerminal.drivers.core_sales_pm[0] ?? 0,
        reinvestmentRateYear1: diagnostics.reinvestmentRate != null
          ? clamp(diagnostics.reinvestmentRate * reinvestmentLift, 0, 1.2)
          : null,
        incrementalRoicYear1: diagnostics.incrementalRoic != null
          ? clamp(diagnostics.incrementalRoic * (1 - (reinvestmentLift - 1) * 0.2), -0.1, 0.5)
          : null,
      },
    } satisfies ValuationScenarioCard;
  };

  const derivedScenarios = {
    stress: derivePersistenceForecastScenario({
      scenarioKey: "stress",
      periods: valuationData,
      latest,
      businessModel,
      horizon,
      template: sectorTemplate,
      riskInputs: { ke: keBase, kw: kwBase, riskFreeRate },
    }),
    base: derivePersistenceForecastScenario({
      scenarioKey: "base",
      periods: valuationData,
      latest,
      businessModel,
      horizon,
      template: sectorTemplate,
      riskInputs: { ke: keBase, kw: kwBase, riskFreeRate },
    }),
    bull: derivePersistenceForecastScenario({
      scenarioKey: "bull",
      periods: valuationData,
      latest,
      businessModel,
      horizon,
      template: sectorTemplate,
      riskInputs: { ke: keBase, kw: kwBase, riskFreeRate },
    }),
    historicalPanic: derivePersistenceForecastScenario({
      scenarioKey: "historical-panic",
      periods: valuationData,
      latest,
      businessModel,
      horizon,
      template: sectorTemplate,
      riskInputs: { ke: keBase, kw: kwBase, riskFreeRate },
    }),
  };

  const scenarios: ValuationScenarioCard[] = normalizeScenarioCards([
    makeScenario("stress", derivedScenarios.stress, 1.15),
    makeScenario("base", derivedScenarios.base, 1),
    makeScenario("bull", derivedScenarios.bull, 0.9),
    makeScenario("historical-panic", derivedScenarios.historicalPanic, 1.2),
  ], marketPrice);

  return { scenarios, derivedScenarios };
}
