/**
 * The valuation models, as one stage function (command-center decomposition
 * step 2, docs/architecture/plans/2026-10-30-command-center-decomposition.md).
 *
 * Given the anchor, the share and price basis, the cost of capital and the
 * forecast cases, it values the company each way the command center does: the
 * scenario cards on the forecast cases, the reverse DCF at the price, the SOTP
 * of the segments, the EV/EBITDA cross-check, the Class-A models, the
 * cash-statement DCF and the no-growth EPV. Each is computed exactly as it was
 * inline in `buildCoreCommandCenter`, in the same order and from the same
 * inputs, so the command center's output is unchanged; it now copies these
 * results instead of computing them.
 *
 * What it does not do: synthesis, evidence ledgers, triangulation and the
 * signal stay in the command center (steps 3 and 4).
 */
import type { CostOfCapitalResult } from "../costOfCapital";
import type { GeneratedForecastCase } from "../forecastState/generation";
import { computeEvEbitdaCrossCheck, updateEvEbitdaWithMarketPrice } from "../evEbitdaCrossCheck";
import { computeEPV } from "../grahamDoddEPV";
import { computeCashFlowDcf } from "../cashFlowDcf";
import type { EquityBetaPack, MacroPack } from "../marketPacks";
import type { SegmentData } from "../segmentParser";
import type { ResolvedShareBasis } from "../shareCountTools";
import type { EngineConfig, RecastPeriod } from "../types";
import type { resolveValuationSectorTemplate } from "../valuationSectorTemplates";
import { buildClassAModels, buildScenarioCards, buildSotpAssessment } from "./builders";
import { buildReverseDcfExpectation, type computeCashFlowDiagnostics } from "./helpers";

export const VALUATION_MODELS_STAGE_VERSION = "2026-10-valuation-models-v1" as const;

export interface ValuationModelsInput {
  /** The basis periods, the run's whole valuation history. */
  readonly data: readonly RecastPeriod[];
  /** The anchor-truncated slice the forecast and cash DCF are built on. */
  readonly valuationData: readonly RecastPeriod[];
  readonly latest: RecastPeriod;
  readonly config: EngineConfig;
  readonly shareBasis: ResolvedShareBasis;
  readonly shares: number | null;
  readonly diagnostics: ReturnType<typeof computeCashFlowDiagnostics>;
  readonly sectorTemplate: ReturnType<typeof resolveValuationSectorTemplate>["template"];
  readonly costOfCapital: CostOfCapitalResult;
  readonly forecastCases: readonly GeneratedForecastCase[];
  readonly horizon: number;
  /** Today's price, on today's share count. */
  readonly marketPrice: number | null;
  /** The price on the anchor's share count, carved stake included. */
  readonly priceOnValuationShares: number | null;
  /** The price on the anchor's count, carved stake taken out: what the industrial business trades at. */
  readonly industrialMarketPrice: number | null;
  readonly carvedStake: number;
  readonly yearsToPriceDate: number;
  readonly shareCountChange: number | null;
  /** The segments the SOTP sums, a carved arm already removed. */
  readonly segmentData: SegmentData | null | undefined;
  readonly macroPack?: MacroPack | null | undefined;
  readonly betaPack?: EquityBetaPack | null | undefined;
  readonly analysisAsOf?: string | null | undefined;
}

export function runValuationModels(input: ValuationModelsInput) {
  const {
    data, valuationData, latest, config, shareBasis, shares, diagnostics, sectorTemplate, costOfCapital,
    forecastCases, horizon, marketPrice, priceOnValuationShares, industrialMarketPrice, carvedStake,
    yearsToPriceDate, shareCountChange, segmentData, macroPack, betaPack, analysisAsOf,
  } = input;
  const keBase = costOfCapital.ke;
  const kwBase = costOfCapital.kw;

  const scenarios = buildScenarioCards({
    latest,
    shareBasis,
    diagnostics,
    marketPrice,
    forecastCases: [...forecastCases],
    yearsToPriceDate,
    shareCountChange,
  });
  const baseCard = scenarios.find((card) => card.key === "base") ?? null;

  const reverseDcf = buildReverseDcfExpectation({
    marketPrice: industrialMarketPrice,
    diagnostics,
    baseCard,
    keBase,
    kwBase,
    cse0: latest.bs.CSE,
    noaT: latest.bs.NOA,
    shares,
    normalizedGrowth: sectorTemplate.normalizedGrowth,
    terminalGrowth: baseCard?.assumptions.g ?? forecastCases.find((generated) => generated.key === "base")!.scenario.drivers.g_terminal,
  });

  // A carved arm is not one of the segments the SOTP sums: it enters at its
  // own valuation, through the bridge (the caller removed it from segmentData).
  const { sotpResult, conglomerateAssessment } = buildSotpAssessment(segmentData ?? null, config, latest, keBase);

  const evEbitda = computeEvEbitdaCrossCheck(latest, config.ev_ebitda_peers ?? []);
  const evEbitdaWithMarket = marketPrice != null && shares != null && shares > 0
    ? updateEvEbitdaWithMarketPrice(evEbitda, priceOnValuationShares! * shares - carvedStake, latest.bs.NFO)
    : evEbitda;

  const { workingCapitalGateResult, cleanSurplusResult, damodaranCapmResult, reverseDcfMonteCarloResult } =
    buildClassAModels([...data], config, latest, shares, industrialMarketPrice, keBase);

  const cashFlowDcf = computeCashFlowDcf([...valuationData], config, shares, {
    terminalGrowth: baseCard?.assumptions.g ?? sectorTemplate.normalizedGrowth,
    nearTermGrowth: baseCard?.assumptions.salesGrowthYear1 ?? sectorTemplate.normalizedGrowth,
    horizon,
    // Discount at the kw the base card's valuation settled on, so the cash and
    // accrual lenses differ in their flows, not in their capital cost (S-9.4C).
    kw: baseCard?.assumptions.kw ?? null,
    minorityClaim: baseCard?.valuation.minorityClaim ?? null,
  });

  // EPV is spread over today's count and not carried: a no-growth value that
  // pays out all it earns (d = ke·V) is, by its own assumptions, the same at
  // the price's date.
  const epvResult = computeEPV([...data], shareBasis.valuationConfig, { macroPack, betaPack, analysisAsOf });
  const epvAtPrice = epvResult?.epvPerShare != null ? epvResult.epvPerShare / (shareCountChange ?? 1) : null;
  const epv = epvResult
    ? { ...epvResult, marginOfSafety: marketPrice != null && marketPrice > 0 && epvAtPrice != null ? (epvAtPrice - marketPrice) / marketPrice : null }
    : epvResult;

  return {
    stageVersion: VALUATION_MODELS_STAGE_VERSION,
    scenarios,
    reverseDcf,
    sotpResult,
    conglomerateAssessment,
    evEbitda: evEbitdaWithMarket,
    workingCapitalGate: workingCapitalGateResult,
    cleanSurplus: cleanSurplusResult,
    damodaranCapm: damodaranCapmResult,
    reverseDcfMonteCarlo: reverseDcfMonteCarloResult,
    cashFlowDcf,
    epv,
  };
}

export type ValuationModelsOutput = ReturnType<typeof runValuationModels>;
