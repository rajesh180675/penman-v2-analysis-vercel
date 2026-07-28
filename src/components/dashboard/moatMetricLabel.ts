import { decisiveMoat, type MoatScoreResult } from "../../engine/moatScoring";

/**
 * The moat score as it appears in a one-line slot — a `VerdictBanner` metric or
 * a collapsed `EvidenceItem` summary.
 *
 * Both are places where a raw `compositeScore` is unsafe for the same reason:
 * the scorer can return an ordinary-looking 0-100 while setting
 * `dataSufficient: false` (a loss-maker, or an IT-services company whose RNOA
 * is inflated by a NOA denominator near zero), and neither slot has room for
 * the `skipReason` beside it. `MoatPanel` may print the raw score because it
 * renders that reason in the same panel; a label with a value cannot.
 *
 * Three states, deliberately distinct:
 *   "82/100" — the scorer stands behind the number
 *   "n/a"    — a score exists but the scorer disowned it
 *   "—"      — no score at all (fewer than three periods)
 *
 * Lives under components/dashboard rather than in the engine: this is
 * presentation copy, and the engine should not own display strings.
 */
export function formatMoatBannerMetric(moat: MoatScoreResult | null | undefined): string {
  if (!moat) return "—";
  return decisiveMoat(moat) ? `${moat.compositeScore}/100` : "n/a";
}
