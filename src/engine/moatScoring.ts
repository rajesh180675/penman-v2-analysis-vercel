/**
 * Economic Moat Scoring Module
 *
 * Quantifies the durability and width of a company's competitive advantage
 * using purely financial evidence from the recast data.
 *
 * Framework: Buffett/Munger moat analysis operationalized through
 * Penman-Nissim ratios. No qualitative inputs required — the numbers
 * speak for themselves.
 *
 * Five moat dimensions:
 *   1. RNOA Persistence    — does RNOA stay above cost of capital over time?
 *   2. SPREAD Durability   — is RNOA − kw consistently positive?
 *   3. Margin Stability    — how stable is CoreSalesPM across the cycle?
 *   4. Reinvestment Quality — does incremental NOA earn above kw?
 *   5. Competitive Advantage Period (CAP) — how many years until RNOA fades to kw?
 *
 * Moat width classification:
 *   Wide   — score ≥ 70, SPREAD > 5% for 7+ years
 *   Narrow — score ≥ 40, SPREAD > 0% for 4+ years
 *   None   — score < 40 or SPREAD ≤ 0% in majority of periods
 *
 * For banks: uses ROE-based moat (ROE vs ke) instead of RNOA/SPREAD.
 *
 * This module has been decomposed into ./moatScoring/* — this file is a
 * re-export barrel preserving the original public surface.
 */

export type {
  MoatWidth,
  MoatDimension,
  CAPEstimate,
  MoatScoreResult,
  BankMoatResult,
} from "./moatScoring/types";

export { computeMoatScore } from "./moatScoring/industrial";
export { computeBankMoatScore } from "./moatScoring/bank";
