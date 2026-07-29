import type { UnmappedLabelSummary } from "../../engine/conceptOntology";

/**
 * The unmapped-label count as it appears in a `MetricCard`.
 *
 * The tile used to be labelled "Top unmapped" and rendered
 * `rankUnmappedLabels(rawData, 8).length`, which cannot exceed 8 because the
 * limit *is* 8 — it read as a count of unmapped labels while being
 * `min(unmapped, 8)`. Across the bundled ZIPs it printed 8 for every company;
 * the true figures are 221 (Infosys, NTPC) and 1,696–1,698 (Cholamandalam,
 * HDFC Bank). And nothing rendered the ranked labels the name promised: the
 * list was built and discarded on every render.
 *
 * Shows the denominator alongside the count, for two reasons. A bare 221 next to
 * "Coverage 75%" invites subtracting one from the other, and they do not share a
 * denominator — coverage is 9 of 12 *concepts* the model asks for, this is 221 of
 * 235 *raw labels* the file supplies. And 221 alone says nothing about whether a
 * statement barely mapped or is simply long: 221 of 235 and 221 of 1,700 are
 * different findings.
 *
 * Deliberately not the `221/235` shape `Core matched` uses one tile over. That
 * form reads as "how many of the total are good", and this count is the
 * complement — the same glyphs would flip the meaning while looking identical.
 *
 * An em dash rather than "0 of 0" when the period supplies no labels at all:
 * zero unmapped out of zero is arithmetically true and reads as a clean bill,
 * which is the class of false sentence this tile is being fixed for.
 */
export function unmappedLabelsMetric(summary: UnmappedLabelSummary): string {
  if (summary.distinct === 0) return "—";
  return `${summary.unmapped} of ${summary.distinct}`;
}
