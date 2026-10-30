/**
 * Evidence and synthesis, as one stage function (command-center decomposition
 * step 3, docs/architecture/plans/2026-10-30-command-center-decomposition.md).
 *
 * From the models stage's output (models.ts) and the history, it builds the
 * evidence the headline rests on and the headline itself: the triangulation
 * of the accrual, cash and multiple lenses, the assumption evidence ledger,
 * the out-of-sample forecast holdout, the market-implied expectations, and
 * the evidence-weighted synthesis over all of them. Each is computed exactly
 * as it was inline in `buildCoreCommandCenter`, in the same order and from the
 * same inputs, so the command center's output is unchanged.
 */
import type { LiveMarketDataSnapshot } from "../marketData";
import type { EngineConfig, RecastPeriod } from "../types";
import { buildValuationTriangulationEvidence } from "../valuationTriangulation";
import {
  buildAssumptionEvidenceLedger,
  buildEvidenceWeightedSynthesis,
  buildMarketImpliedExpectationLedger,
  evaluateForecastHoldout,
  type HoldoutVintageIndex,
} from "../valuationEvidence";
import type { ValuationModelsOutput } from "./models";

export const VALUATION_SYNTHESIS_STAGE_VERSION = "2026-10-valuation-synthesis-v1" as const;

export interface ValuationSynthesisInput {
  readonly models: ValuationModelsOutput;
  /** The basis periods, for the out-of-sample holdout. */
  readonly data: readonly RecastPeriod[];
  readonly latest: RecastPeriod;
  readonly config: EngineConfig;
  readonly shares: number | null;
  readonly kw: number;
  readonly marketData: LiveMarketDataSnapshot | null | undefined;
  /** The price the reverse DCF was solved on: the anchor's count, carved stake taken out. */
  readonly industrialMarketPrice: number | null;
  /** The price on the anchor's count, against which the synthesis's per-share lenses are set. */
  readonly priceOnValuationShares: number | null;
  readonly holdoutVintage: HoldoutVintageIndex | null | undefined;
}

export function runValuationSynthesis(input: ValuationSynthesisInput) {
  const { models, data, latest, config, shares, kw, marketData, industrialMarketPrice, priceOnValuationShares, holdoutVintage } = input;
  const { scenarios, cashFlowDcf, reverseDcf, evEbitda } = models;

  const valuationTriangulation = buildValuationTriangulationEvidence({
    scenarios,
    cashFlowDcf,
    evEbitda,
    shares,
    periodEnd: latest.period_end,
  });
  const evidenceLedger = buildAssumptionEvidenceLedger({
    scenarios,
    reverseDcf,
    periodEnd: latest.period_end,
    companyId: config.ticker ?? null,
  });
  const forecastHoldout = evaluateForecastHoldout([...data], holdoutVintage);
  const marketImpliedExpectations = buildMarketImpliedExpectationLedger({
    // The price the reverse DCF was solved on.
    marketPrice: industrialMarketPrice,
    asOf: marketData?.priceAsOf ?? marketData?.fetchedAt ?? null,
    reverseDcf,
    operatingCapitalCharge: kw,
  });
  const evEbitdaPerShare = evEbitda.equityFromMedian != null && shares != null && shares > 0
    ? evEbitda.equityFromMedian / shares
    : null;
  const evidenceWeightedSynthesis = buildEvidenceWeightedSynthesis({
    scenarios,
    cashFlowDcf,
    evEbitdaPerShare,
    reverseDcf,
    evidenceLedger,
    forecastHoldout,
    // Its per-share lenses are on the anchor's count.
    marketPrice: priceOnValuationShares,
  });

  return {
    stageVersion: VALUATION_SYNTHESIS_STAGE_VERSION,
    valuationTriangulation,
    evidenceLedger,
    forecastHoldout,
    marketImpliedExpectations,
    evidenceWeightedSynthesis,
  };
}

export type ValuationSynthesisOutput = ReturnType<typeof runValuationSynthesis>;
