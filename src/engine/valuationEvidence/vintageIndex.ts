import type { HoldoutVintageIndex, PeriodVintage } from "./types";

/**
 * Derives the publication vintage of each period from ingestion provenance.
 *
 * Inputs are described structurally rather than by importing the canonical fact
 * contracts: `valuationEvidence` sits above `facts`, and a `SourceArtifact` is
 * assignable to `VintageArtifact` as-is.
 *
 * The classification is deliberately pessimistic. `per-filing` is the only kind
 * that can support an out-of-sample claim, so it is granted only when every
 * period is traceable to its own artifact carrying its own filing date. A
 * Capitaline export — many periods, one dated snapshot — classifies as
 * `single-export`, which is the truth: those figures are as-restated-at-export,
 * not as-published-then.
 */
export interface VintageArtifact {
  readonly artifactId: string;
  readonly filingAsOf: string | null;
  readonly acquiredAt: string | null;
}

export function buildHoldoutVintageIndex(input: {
  readonly artifacts: readonly VintageArtifact[];
  /** periodEnd → artifactId that supplied that period. */
  readonly periodArtifacts: Readonly<Record<string, string>>;
}): HoldoutVintageIndex {
  const byId = new Map(input.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  const periodEnds = Object.keys(input.periodArtifacts).sort();

  const periods: PeriodVintage[] = periodEnds.map((periodEnd) => {
    const artifact = byId.get(input.periodArtifacts[periodEnd]!);
    return {
      periodEnd,
      filingAsOf: artifact?.filingAsOf ?? null,
      acquiredAt: artifact?.acquiredAt ?? null,
    };
  });

  if (!periods.length || !input.artifacts.length) {
    return { kind: "unknown", periods };
  }

  // One artifact serving several periods is a snapshot, not a filing history —
  // regardless of how many periods it carries.
  const distinctArtifacts = new Set(periodEnds.map((periodEnd) => input.periodArtifacts[periodEnd]));
  const everyPeriodHasOwnArtifact = distinctArtifacts.size === periodEnds.length;
  const everyPeriodHasFilingDate = periods.every((period) => period.filingAsOf != null);

  return {
    kind: everyPeriodHasOwnArtifact && everyPeriodHasFilingDate ? "per-filing" : "single-export",
    periods,
  };
}
