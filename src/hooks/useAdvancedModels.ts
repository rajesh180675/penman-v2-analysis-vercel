import { useMemo } from "react";
import type { RecastPeriod, EngineConfig } from "../engine/types";
import type { AllSegmentData } from "../engine/segmentParser";
import type { LiveMarketDataSnapshot } from "../engine/marketData";
import { analyzeFadeRate, type FadeRateAnalysis } from "../engine/fadeRateEngine";
import { decomposeSegmentRNOA, type SegmentRNOADecomposition } from "../engine/segmentRNOAEngine";
import { computePenmanExpectedReturn, type PenmanExpectedReturn } from "../engine/penmanExpectedReturn";
import { computeERI, type ERIResult } from "../engine/earningsReliabilityIndex";
import { computeReverseDCF, type ReverseDCFResult } from "../engine/reverseDCF";
import { computeAccountingAnchor, type AccountingAnchorResult } from "../engine/accountingAnchor";
import { analyzeCapitalAllocation, measureConglomerateDiscount, detectTransferPricingDistortion, type CapitalAllocationResult, type ConglomerateDiscountResult, type TransferPricingFlag } from "../engine/capitalAllocationEngine";
import { computeMertonCredit, computeRegimeConditionalValuation, type MertonCreditResult, type RegimeConditionalResult } from "../engine/mertonRegimeEngine";
import { resolveCostOfCapitalFromConfig } from "../engine/costOfCapital";

export interface AdvancedModelsResult {
  fadeRate: FadeRateAnalysis | null;
  eri: ERIResult | null;
  segmentRNOA: SegmentRNOADecomposition | null;
  penmanReturn: PenmanExpectedReturn | null;
  reverseDCF: ReverseDCFResult | null;
  accountingAnchor: AccountingAnchorResult | null;
  capitalAllocation: CapitalAllocationResult | null;
  conglomerateDiscount: ConglomerateDiscountResult | null;
  transferPricing: TransferPricingFlag[];
  mertonCredit: MertonCreditResult | null;
  regimeValuation: RegimeConditionalResult | null;
}

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
  segmentData?: AllSegmentData | null | undefined;
  marketData?: LiveMarketDataSnapshot | null | undefined;
  shares?: number | null | undefined;
}

export default function useAdvancedModels({ data, config, segmentData, marketData, shares }: Props): AdvancedModelsResult {
  const capitalCostResult = useMemo(() => resolveCostOfCapitalFromConfig({
    config,
    current: data.at(-1) ?? null,
    previous: data.at(-2) ?? null,
    riskFreeRate: marketData?.riskFreeRate ?? config.risk_free_rate,
    marketAsOf: marketData?.rateAsOf ?? marketData?.fetchedAt ?? null,
  }), [config, data, marketData]);
  const costOfCapital = capitalCostResult.ke;
  const price = marketData?.price ?? config.market_price ?? null;
  const sharesOut = shares ?? null;
  const bizSegments = segmentData?.business ?? null;
  const companyType = config.company_type ?? undefined;

  // Layer 1: Quality & Signal (no market data needed)
  const eri = useMemo(() => data.length >= 3 ? computeERI(data) : null, [data]);

  const fadeRate = useMemo(
    () => data.length >= 4 ? analyzeFadeRate(data, costOfCapital, companyType, bizSegments) : null,
    [data, costOfCapital, companyType, bizSegments],
  );

  const omega = fadeRate?.firm.omega ?? 0.55;

  const mertonCredit = useMemo(
    () => data.length >= 2 ? computeMertonCredit(data) : null,
    [data],
  );

  // Layer 2: Segment Intelligence (needs segment data)
  const segmentRNOA = useMemo(
    () => bizSegments ? decomposeSegmentRNOA(bizSegments, costOfCapital) : null,
    [bizSegments, costOfCapital],
  );

  const capitalAllocation = useMemo(
    () => bizSegments ? analyzeCapitalAllocation(bizSegments, costOfCapital) : null,
    [bizSegments, costOfCapital],
  );

  const transferPricing = useMemo(
    () => bizSegments ? detectTransferPricingDistortion(bizSegments) : [],
    [bizSegments],
  );

  // Layer 3: Market-Facing (needs price + shares)
  const penmanReturn = useMemo(
    () => price != null && sharesOut != null && sharesOut > 0
      ? computePenmanExpectedReturn(data, costOfCapital, omega, price, sharesOut)
      : null,
    [data, costOfCapital, omega, price, sharesOut],
  );

  const reverseDCF = useMemo(
    () => price != null && sharesOut != null && sharesOut > 0
      ? computeReverseDCF(data, costOfCapital, omega, price, sharesOut)
      : null,
    [data, costOfCapital, omega, price, sharesOut],
  );

  const accountingAnchor = useMemo(
    () => price != null && sharesOut != null && sharesOut > 0
      ? computeAccountingAnchor(data, costOfCapital, omega, price, sharesOut)
      : null,
    [data, costOfCapital, omega, price, sharesOut],
  );

  const conglomerateDiscount = useMemo(
    () => bizSegments && price != null && sharesOut != null && sharesOut > 0
      ? measureConglomerateDiscount(bizSegments, price, sharesOut)
      : null,
    [bizSegments, price, sharesOut],
  );

  const regimeValuation = useMemo(
    () => sharesOut != null && sharesOut > 0
      ? computeRegimeConditionalValuation(data, costOfCapital, omega, sharesOut)
      : null,
    [data, costOfCapital, omega, sharesOut],
  );

  return {
    fadeRate,
    eri,
    segmentRNOA,
    penmanReturn,
    reverseDCF,
    accountingAnchor,
    capitalAllocation,
    conglomerateDiscount,
    transferPricing,
    mertonCredit,
    regimeValuation,
  };
}
