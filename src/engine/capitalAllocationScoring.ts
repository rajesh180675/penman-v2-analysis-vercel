/**
 * Capital Allocation Scoring Module
 *
 * Scores management's capital allocation quality using purely financial
 * evidence from recast data. No qualitative inputs required.
 *
 * Five dimensions:
 *   1. Dividend Consistency   — stable, growing dividends vs erratic cuts
 *   2. Buyback Quality        — buybacks when SPREAD > 0 (value-accretive) vs dilutive issuance
 *   3. Reinvestment ROIC      — incremental NOA earns above kw?
 *   4. FCF Conversion         — CFO → FCF conversion quality over time
 *   5. Payout Sustainability  — dividends + buybacks covered by FCF?
 *
 * For banks: uses ROE-based reinvestment quality (retained earnings → ROE vs ke).
 *
 * Composite score 0–100. Grade: A (≥80), B (60–79), C (40–59), D (<40).
 */

export type {
  CapAllocGrade,
  CapAllocDimension,
  CapAllocScoreResult,
  BankCapAllocResult,
} from "./capitalAllocationScoring/types";

export { scoreCapitalAllocation } from "./capitalAllocationScoring/industrial";
export { scoreBankCapitalAllocation } from "./capitalAllocationScoring/bank";
