import { RecastPeriod, EngineConfig, ke_from_config } from "../types";
import { BankPeriodMetrics } from "../bankPipeline";
import { BankCapAllocResult } from "./types";
import { medianOf, clamp, linearScore, gradeFromScore, trendFromSeries } from "./shared";

// ─── Main: Bank ───────────────────────────────────────────────────────────────

/**
 * Score capital allocation quality for a bank.
 * Banks retain earnings to fund loan growth — reinvestment quality is
 * measured as ROE earned on retained earnings vs ke.
 *
 * @param bankMetrics  Per-period bank metrics (from bankPipeline)
 * @param periods      Recast periods (for dividend/buyback data)
 * @param config       Engine config
 */
export function scoreBankCapitalAllocation(
  bankMetrics: BankPeriodMetrics[],
  periods: RecastPeriod[],
  config: EngineConfig
): BankCapAllocResult {
  const notes: string[] = [];
  const ke = ke_from_config(config);

  if (bankMetrics.length < 3) {
    notes.push("Fewer than 3 periods — scores are low confidence");
  }

  // Payout ratio from recast periods
  const payoutRatios: number[] = [];
  for (const p of periods) {
    const div = p.cf.DividendPaid ?? 0;
    const cni = p.is.CNI ?? 0;
    if (cni > 1) payoutRatios.push(div / cni);
  }
  const medianPayoutRatio = medianOf(payoutRatios);

  // Retention ROE: ROE earned on retained earnings
  const retentionROEs: number[] = [];
  let retentionValueAccretive = 0;

  for (const bm of bankMetrics) {
    const roe = bm.roe ?? null;
    if (roe !== null && Number.isFinite(roe)) {
      retentionROEs.push(roe);
      if (roe > ke) retentionValueAccretive++;
    }
  }

  const medianRetentionROE = medianOf(retentionROEs);

  // Score: ROE vs ke
  let compositeScore = 50;
  if (medianRetentionROE !== null) {
    // ROE at ke → 50, at 1.5×ke → 100, at 0 → 0
    compositeScore = clamp(linearScore(medianRetentionROE, 0, 1.5 * ke), 0, 100);
  }

  // Payout adjustment: very high payout (>80%) for a bank is a red flag
  if (medianPayoutRatio !== null && medianPayoutRatio > 0.8) {
    compositeScore = clamp(compositeScore - 10, 0, 100);
    notes.push("High payout ratio (>80%) for a bank — limits capital retention for growth");
  }

  const trend = trendFromSeries(retentionROEs.map(r => linearScore(r, 0, 1.5 * ke) * 100));

  if (medianRetentionROE !== null)
    notes.push(`Median ROE: ${(medianRetentionROE * 100).toFixed(1)}% vs ke ${(ke * 100).toFixed(1)}%`);

  return {
    compositeScore,
    grade: gradeFromScore(compositeScore),
    medianPayoutRatio,
    medianRetentionROE,
    retentionValueAccretive,
    totalPeriods: bankMetrics.length,
    trend,
    notes,
  };
}
