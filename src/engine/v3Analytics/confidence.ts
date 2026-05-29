/* ================================================================
   v3Analytics decomposition — §14 Composite Confidence Score.

   Lifted verbatim from src/engine/v3Analytics.ts. Imports DOWN only:
   RecastPeriod from ../types/recast, DirtySurplusSummary from
   ./eventFraming, TerminalAnchorResult from ./terminalValue, the
   CanonicalOutputRegistry type from ./shared, and numeric helpers from
   ./mathUtils. No back-edge to the parent. v3Analytics.ts re-exports
   the public surface, leaving external import paths (V3AnalyticsPanel)
   unchanged. Behaviour byte-for-byte identical.

   inferContaminationTier stays private to this module.
================================================================ */

import type { RecastPeriod } from "../types/recast";
import type { DirtySurplusSummary } from "./eventFraming";
import type { TerminalAnchorResult } from "./terminalValue";
import type { CanonicalOutputRegistry } from "./shared";
import { pctStr, numStr } from "./mathUtils";

export interface ConfidenceComponent {
  name: string;
  score: number; // 0–100
  weight: number;
  detail: string;
}
export interface ConfidenceResult {
  components: ConfidenceComponent[];
  composite: number; // 0–100
  classification: "HIGH" | "MODERATE" | "LOW";
  tier_message: string;
  separation_score: number;
}
function inferContaminationTier(nCrit: number, nWarn: number): "CLEAN" | "CAUTION" | "GUARDED" | "COMPROMISED" {
  if (nCrit >= 2) return "COMPROMISED";
  if (nCrit >= 1) return "GUARDED";
  if (nWarn >= 1) return "CAUTION";
  return "CLEAN";
}
export function computeConfidenceScore(
  periods: RecastPeriod[],
  dsSummary: DirtySurplusSummary,
  anchorResult: TerminalAnchorResult,
  V_RE_CV3: number,
  V_ReOI_CV03: number,
  _eq16_residual_latest: number | null,
  registry?: CanonicalOutputRegistry | undefined
): ConfidenceResult {
  const n = periods.length;
  const latest = periods[n - 1];
  const dataScore = Math.min(100, latest.bs.separationScore);
  const nCrit = anchorResult.terminal_event_flags.filter((f) =>
    ["STRUCTURAL_EVENT_CRITICAL", "PM_OUTLIER_CRITICAL", "CAPITAL_TRANSACTION_LIKELY", "ROCE_OUTLIER_CRITICAL"].includes(f)
  ).length;
  const nWarn = anchorResult.terminal_event_flags.filter((f) => f.includes("WARNING") || f === "STRUCTURAL_EVENT").length;
  const terminalScore = Math.max(0, 100 - nCrit * 20 - nWarn * 8);
  let robustnessScore = 100;
  const tv = anchorResult.TV_share ?? 1;
  if (tv > 0.6) robustnessScore -= 40;
  else if (tv > 0.4) robustnessScore -= 25;
  else if (tv > 0.25) robustnessScore -= 10;
  const gap = V_RE_CV3 !== 0 ? Math.abs(V_RE_CV3 - V_ReOI_CV03) / Math.abs(V_RE_CV3) : 1;
  if (gap > 0.30) robustnessScore -= 30;
  else if (gap > 0.20) robustnessScore -= 20;
  else if (gap > 0.10) robustnessScore -= 10;
  const dsPct = Math.abs(dsSummary.cumulative_dirty_surplus) / Math.max(Math.abs(latest.bs.CSE), 1);
  if (dsPct > 0.20) robustnessScore -= 20;
  else if (dsPct > 0.10) robustnessScore -= 10;
  else if (dsPct > 0.05) robustnessScore -= 5;
  robustnessScore = Math.max(0, robustnessScore);
  let eqScore = 100;
  const latestAccrual = Math.abs(latest.ratios?.accrual_ratio_bs ?? 0);
  if (latestAccrual > 0.20) eqScore -= 25;
  else if (latestAccrual > 0.10) eqScore -= 15;
  if (latest.ratios?.accrual_regime === "QUALITY_ACCRUAL") eqScore -= 20;
  const cc = latest.ratios?.cash_conversion_ratio ?? 0;
  if (cc < 0.5) eqScore -= 20;
  else if (cc < 0.7) eqScore -= 10;
  if ((latest.quality?.beneish_mscore ?? -3) > -1.78) eqScore -= 30;
  eqScore = Math.max(0, eqScore);
  let healthScore = 100;
  const p = latest.quality?.piotroski_total ?? 0;
  if (p <= 3) healthScore -= 30;
  else if (p <= 5) healthScore -= 15;
  else if (p <= 6) healthScore -= 5;
  const z = latest.quality?.altman_zprime ?? 0;
  if (z < 1.81) healthScore -= 30;
  else if (z < 2.99) healthScore -= 10;
  healthScore = Math.max(0, healthScore);
  const composite = Math.round(
    0.20 * dataScore +
    0.25 * terminalScore +
    0.25 * robustnessScore +
    0.15 * eqScore +
    0.15 * healthScore
  );
  let classification: ConfidenceResult["classification"] = "LOW";
  if (composite >= 70) classification = "HIGH";
  else if (composite >= 50) classification = "MODERATE";
  const tier_message = classification === "HIGH"
    ? "Valuation has high analytical confidence."
    : classification === "MODERATE"
    ? "Valuation has moderate confidence; use sensitivity range over point estimate."
    : "Valuation has low analytical confidence; treat as indicative only.";
  const components: ConfidenceComponent[] = [
    { name: "Data quality", score: dataScore, weight: 20, detail: `Separation score = ${dataScore.toFixed(0)}/100` },
    { name: "Terminal integrity", score: terminalScore, weight: 25, detail: `${nCrit} critical and ${nWarn} warning terminal flags` },
    { name: "Valuation robustness", score: robustnessScore, weight: 25, detail: `TV share ${pctStr(tv)} | RE/ReOI gap ${pctStr(gap)} | DS ${pctStr(dsPct)}` },
    { name: "Earnings quality", score: eqScore, weight: 15, detail: `Accrual ${pctStr(latest.ratios?.accrual_ratio_bs)} | cash conversion ${numStr(cc)}` },
    { name: "Financial health", score: healthScore, weight: 15, detail: `Piotroski ${p}/9 | Altman Z' ${numStr(z)}` },
  ];
  const contaminationTier = inferContaminationTier(nCrit, nWarn);
  registry?.register("composite_confidence", composite, "S-14.3");
  registry?.register("composite_tier", classification, "S-14.3");
  registry?.register("composite_components", components, "S-14.3");
  registry?.register("composite_tier_message", tier_message, "S-14.3");
  registry?.register("terminal_flag_score", nCrit * 3 + nWarn, "S-14.3");
  registry?.register("contamination_tier", contaminationTier, "S-14.3");
  return {
    components,
    composite,
    classification,
    tier_message,
    separation_score: dataScore,
  };
}
