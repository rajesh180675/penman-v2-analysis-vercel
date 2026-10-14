import { RecastPeriod, EngineConfig, ForecastScenario, BusinessModelProfile, type ValuationResult } from "../types";
import { resolveShareBasis } from "../shareCountTools";
import { computeConsistentValuation, type KwConsistency } from "../valueConsistentKw";
import { RE_REOI_BLOCK_GAP, reReoiGap } from "../reReoiConsistency";
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
  carryValueToPriceDate,
  clamp,
  expectedReturnToValue,
  forecastDividendsPerShare,
  marginOfSafety,
  primaryValuationPerShare,
} from "./helpers";

/**
 * Whether a card's RE and ReOI value its forecast alike, so their median is
 * its value, or no kw consistent with its ke and forecast exists and RE alone
 * (which needs no kw) is. NTPC's deep stress, Tata Steel's and the net-cash
 * historical panics have none: the solve leaves the structural kw, or the two
 * stay beyond the block gap at the kw it settles on.
 *
 * Not the base: its pair is gated on the rigor ladder (RE_REOI_BLOCK_GAP
 * withholds valuation-eligible), and break-even and PVRE re-value it as the
 * median, which must stay the value they start from.
 */
export function scenarioValueBasis(
  key: ValuationScenarioCard["key"],
  valuation: ValuationResult,
  kwConsistency: KwConsistency,
): NonNullable<ValuationScenarioCard["valueBasis"]> {
  if (key === "base") return { model: "re-reoi", reason: null };
  const re = valuation.perShare?.intrinsic_re_per_share;
  const reoi = valuation.perShare?.intrinsic_reoi_per_share;
  if (re == null || !Number.isFinite(re) || reoi == null || !Number.isFinite(reoi)) return { model: "re-reoi", reason: null };
  const gap = reReoiGap(re, reoi);
  if (kwConsistency.method !== "value-consistent") {
    return { model: "re", reason: `${kwConsistency.reason ?? "The value-weighted kw did not settle."} No kw reconciles residual operating income with residual earnings on this forecast, so the case is valued on residual earnings, which need none.` };
  }
  if (gap != null && gap > RE_REOI_BLOCK_GAP) {
    return { model: "re", reason: `At the kw that settles, residual operating income and residual earnings still differ by ${(gap * 100).toFixed(0)}%; valued on residual earnings, which need no kw.` };
  }
  return { model: "re-reoi", reason: null };
}

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
          // comprehensive-income basis must also be parent-attributable, else
          // every period's residual absorbs the minority's CI and flags a
          // phantom dirty-surplus for any firm with non-wholly-owned
          // subsidiaries. CNI is that basis (Capitaline's TCI line is already
          // the owners' share); preferred dividends are added back to net
          // against the total DividendPaid term below.
          comprehensiveIncome: p.is.CNI + p.is.PreferredDividend,
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
  /** Years from the anchor to the price's date (yearsBetween); 0 when undated. */
  yearsToPriceDate: number;
  /** Today's share count over the anchor's (marketContext.shareCountChange); null when unknown. */
  shareCountChange: number | null;
}): {
  scenarios: ValuationScenarioCard[];
  derivedScenarios: {
    stress: ForecastScenario;
    base: ForecastScenario;
    bull: ForecastScenario;
    historicalPanic: ForecastScenario;
  };
} {
  const { config, sectorTemplate, latest, shareBasis, diagnostics, marketPrice, businessModel, keBase, kwBase, riskFreeRate, valuationData, horizon, yearsToPriceDate, shareCountChange } = args;
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
    // RE and ReOI value one forecast alike only at a value-consistent kw; the
    // structural kw seeds the solve (see valueConsistentKw.ts). The scenario
    // then carries the solved kw, so its forecast ReOI and anything seeded
    // from this card (PVRE, break-even) agree with the value.
    //
    // Every scenario solves its own. Held at the base case's kw, a scenario
    // far from the base was valued at a kw its own forecast contradicts: NTPC's
    // stress, at 8.89% while its equity weight collapsed and its forecast still
    // borrowed at 3.48%, put RE at ₹88.7 and ReOI at −₹92.6 a share, and their
    // median, −₹1.95, read as equity worth nothing. Over the 20 industrial
    // companies (2026-10-14) every scenario stayed in order but Grasim's bull,
    // set against a base whose own RE and ReOI already disagree by 30%.
    const forecast = buildScenario(scenarioWithTerminal, latest);
    const forecastPeriods = buildValuationPeriodsFromForecast(latest, forecast);
    const { valuation, kwConsistency } = computeConsistentValuation(
      forecastPeriods,
      scenarioWithTerminal.drivers.ke,
      scenarioWithTerminal.drivers.kw,
      terminalGrowth,
      shareBasis.valuationConfig,
      scenarioWithTerminal.drivers.nbc[0],
    );
    const scenarioAtKw = {
      ...scenarioWithTerminal,
      drivers: { ...scenarioWithTerminal.drivers, kw: kwConsistency.kw },
    } satisfies ForecastScenario;
    // Owner earnings are the industrial business's; a carved lending-arm stake
    // is added at its value per share, as every accrual value adds it.
    const perShareBasis = shareBasis.sharesForPerShare ?? shareBasis.shares ?? null;
    const stakePerShare = perShareBasis != null && perShareBasis > 0 ? (latest.bs.CarvedArmStakeValue ?? 0) / perShareBasis : 0;
    const industrialOwnerDcf = computeOwnerEarningsDcf(diagnostics.ownerEarningsPerShare, scenarioAtKw.drivers.sales_growth, scenarioAtKw.drivers.ke, terminalGrowth);
    const ownerDcf = industrialOwnerDcf != null ? industrialOwnerDcf + stakePerShare : null;
    // The headline is the RE/ReOI median (AFES round-one, eec49c26): the
    // owner-earnings DCF is reported beside it as a cross-check, not blended
    // in. It used to be blended here and then overwritten by a normalization
    // pass, so a value was computed that no reader ever saw.
    //
    // Where no kw reconciles the two (the solve did not settle, or settled with
    // them still beyond the block gap) the median would average a value with
    // one at a kw the forecast contradicts. RE needs no kw, so the card is RE.
    const valueBasis = scenarioValueBasis(key, valuation, kwConsistency);
    const intrinsicPerShare = valueBasis.model === "re"
      ? valuation.perShare?.intrinsic_re_per_share ?? null
      : primaryValuationPerShare(valuation);
    // Dated at the anchor year-end; the price is today's. Set beside it, the
    // value is carried to the price's date first.
    const dividendsPerShare = forecastDividendsPerShare(forecast, latest.bs.CSE, perShareBasis);
    // …and spread over the price's share count.
    const carried = carryValueToPriceDate(intrinsicPerShare, scenarioAtKw.drivers.ke, yearsToPriceDate, dividendsPerShare);
    const valueAtPriceDate = carried != null && shareCountChange != null ? carried / shareCountChange : carried;
    const marginOfSafetyPct = marginOfSafety(valueAtPriceDate, marketPrice);
    return {
      key,
      label: key === "stress" ? "Stress case" : key === "base" ? "Base case" : key === "bull" ? "Bull case" : "Historical panic",
      scenario: scenarioAtKw,
      intrinsicPerShare,
      ownerEarningsDcfPerShare: ownerDcf,
      valueAtPriceDate,
      dividendsPerShare,
      upsidePct: valueAtPriceDate != null && marketPrice != null && marketPrice > 0 ? (valueAtPriceDate - marketPrice) / marketPrice : null,
      marginOfSafetyPct,
      expectedCagr: expectedReturnToValue(marketPrice, valueAtPriceDate, scenarioAtKw.drivers.ke, 3),
      valuation,
      kwConsistency,
      valueBasis,
      forecastPolicy: scenarioAtKw.forecastPolicy,
      assumptions: {
        ke: scenarioAtKw.drivers.ke,
        kw: scenarioAtKw.drivers.kw,
        g: terminalGrowth,
        salesGrowthYear1: scenarioAtKw.drivers.sales_growth[0] ?? 0,
        corePmYear1: scenarioAtKw.drivers.core_sales_pm[0] ?? 0,
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

  const scenarios: ValuationScenarioCard[] = [
    makeScenario("stress", derivedScenarios.stress, 1.15),
    makeScenario("base", derivedScenarios.base, 1),
    makeScenario("bull", derivedScenarios.bull, 0.9),
    makeScenario("historical-panic", derivedScenarios.historicalPanic, 1.2),
  ];

  return { scenarios, derivedScenarios };
}
