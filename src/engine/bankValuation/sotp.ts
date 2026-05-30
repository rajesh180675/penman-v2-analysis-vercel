import type { BankPeriodMetrics } from "../bankPipeline";
import type { SOTPResult, SegmentDefinition } from "../sotpValuation";

// ─── SOTP for Bank/NBFC ──────────────────────────────────────────────────

/**
 * Build SOTP (Sum-of-the-Parts) valuation for a bank/NBFC with subsidiaries.
 *
 * Bajaj Finance has identifiable lending segments (consumer, SME, commercial,
 * rural) with different risk profiles. The SOTP valuation is computed by the
 * existing `buildSOTPValuation` engine when segment data is available.
 *
 * This bridge function is a placeholder — the actual SOTP computation is
 * best done at the pipeline layer (bankPipeline.ts) where RecastPeriod data
 * is available, not here where only BankPeriodMetrics exist.
 * The `sotp` field on BankValuationBundle is populated by the pipeline caller.
 */
export function buildBankSOTP(_params: {
  metrics: BankPeriodMetrics[];
  ke: number;
  segments?: SegmentDefinition[] | undefined;
}): SOTPResult | null {
  // SOTP requires RecastPeriod data which is not available from BankPeriodMetrics alone.
  // The pipeline layer (bankPipeline.ts) should call buildSOTPValuation directly
  // when segment data is present, and assign the result to this field.
  return null;
}
