import type { EarningsQualitySummary } from "../../engine/types/earningsQualitySummary";

/**
 * Shared by the two ways no scorecard exists — the envelope field absent, and a
 * summary projected from a null card — because they are the same fact about the
 * run and must not read as two different explanations.
 *
 * Says the scorecard is missing, not that no valuation ran, which this helper is
 * not in a position to claim. `DashboardView` builds its own command center and
 * prints an intrinsic value from it, while this signal comes from the one in
 * `useAuditAnalysis` — which is wrapped in try/catch and yields null on throw. If
 * those two ever diverge, "No valuation ran" would sit on a screen showing a
 * valuation, which is the same contradiction this tile is being fixed for.
 */
const NO_SCORECARD = "No scorecard for this run";

/**
 * The earnings-quality composite as it appears in a `Metric` tile.
 *
 * The tile used to render `traceability.parserFidelity.score / 100`, which is a
 * different claim entirely. Parser fidelity is whether the source file was
 * *read* correctly — `QualitySignalPanel` details it as "% of labels mapped" and
 * `analysisTraceability` uses it to clear the syntactic rung. Earnings quality is
 * whether the reported earnings are economically real: accrual timeliness,
 * real-earnings-management, clean surplus, cash backing. And `QualitySignalPanel`
 * renders in the same grid block, already showing that exact number under its own
 * name, so the screen printed one figure twice — once labelled correctly, once as
 * a concept nobody had computed.
 *
 * Reads the envelope's gated summary, never the card's raw composite. That
 * distinction is the whole point of the summary existing:
 * `buildEarningsQualityCard` scores every dimension whether or not its input
 * existed, falling back to a neutral mid-band value, so an all-null card still
 * totals 51/100 and calls itself "moderate". `buildEarningsQualitySummary`
 * reports `totalScore: null` in that state because a composite of placeholders is
 * the absence of a score, not a low one. Reaching past it would reintroduce the
 * 51 on the landing surface.
 *
 * Three states, deliberately distinct — the same shape `formatMoatBannerMetric`
 * uses for the moat score one panel over:
 *   "72/100" + "4 of 4 dimensions measured"  — the scorecard stands behind it
 *   null     + "No dimension had inputs"     — it ran and found nothing to score
 *   null     + "No scorecard for this run"   — it was never built
 *
 * `null` rather than a string for the two absent cases so `Metric` renders its
 * own em dash; a score out of 100 rather than a percentage because that is what
 * the composite is, and because `format="pct"` would have to multiply it by 100
 * to display it — the arithmetic that made the old value look plausible.
 *
 * Lives here rather than in the engine: this is presentation copy.
 */
export function earningsQualityMetric(
  summary: EarningsQualitySummary | null | undefined,
): { value: string | null; context: string } {
  // A structural-only envelope carries no summary at all. Silence about earnings
  // quality must not read as a clean bill, so the tile says which kind of blank
  // this is instead of leaving a bare dash.
  if (summary == null) return { value: null, context: NO_SCORECARD };

  if (summary.totalScore == null) {
    // Two states reach here and only one of them scored anything. A real card
    // always contributes its four dimensions, so an empty `checks` array means no
    // scorecard was built at all — saying "no dimension had inputs" there would
    // send a reviewer looking for missing statement lines rather than at the run
    // that produced no scorecard.
    //
    // Not reachable through today's call site: both envelope builders guard with
    // `commandCenter ? buildEarningsQualitySummary(...) : null`, so a no-run
    // arrives as a null summary and is answered above. Handled anyway because
    // `buildEarningsQualitySummary(null)` is a public projection that returns
    // exactly this shape, and a wrong reason is the class of false sentence this
    // whole tile is being fixed for.
    return {
      value: null,
      context: summary.checks.length === 0 ? NO_SCORECARD : "No dimension had inputs",
    };
  }

  return {
    value: `${Math.round(summary.totalScore)}/100`,
    // A partly-measured composite must not read as a fully-measured one: each
    // unmeasured dimension still contributes its neutral placeholder points, so
    // 4-of-4 and 2-of-4 at the same score are not the same evidence. Four is the
    // fixed dimension count the card scores, and the phrasing the summary line
    // already uses.
    context: `${summary.measuredCount} of 4 dimensions measured`,
  };
}
