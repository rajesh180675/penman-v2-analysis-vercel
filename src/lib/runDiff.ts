/* ================================================================
   Plan 8 PR-8.2 — Run-diff between two runs of the same company.

   Two runs of the same company often differ in subtle ways: a
   parser fix, a manual override, an updated peer set. Reviewers
   need to see WHAT changed and WHICH changes matter most. A
   line-by-line diff buries the signal — the reviewer wants the
   top 5 cells where the numbers moved.

   This module ships:
     diffRuns(prior, current) -> ChangedCell[]
     rankByImpact(diff)       -> ChangedCell[] sorted by abs delta

   Pure function — takes two flat key/value snapshots, returns the
   set of changed cells with both absolute and relative deltas.

   The wire format intentionally collapses an envelope to a flat
   dictionary so diffing is path-agnostic; UI builds the dictionary
   from whatever envelope shape it has.
================================================================ */

export type RunSnapshot = Record<string, number | string | null | undefined>;

export interface ChangedCell {
  /** Dotted path: "valuation.ke" */
  key: string;
  prior: number | string | null | undefined;
  current: number | string | null | undefined;
  /** Numeric delta for numbers; null for non-numeric or missing. */
  delta: number | null;
  /** Relative delta (current/prior - 1), null when prior=0 or non-numeric. */
  relativeDelta: number | null;
  /** Magnitude used for impact ranking — abs(relativeDelta) when both numeric, else +Inf for added/removed strings. */
  impact: number;
}

function isNumeric(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Returns cells whose value differs between prior and current.
 * Cells present in only one snapshot are included with the missing
 * side as undefined.
 */
export function diffRuns(prior: RunSnapshot, current: RunSnapshot): ChangedCell[] {
  const keys = Array.from(new Set<string>([...Object.keys(prior), ...Object.keys(current)]));
  const changes: ChangedCell[] = [];

  for (const key of keys) {
    const a = prior[key];
    const b = current[key];

    // Skip unchanged
    if (a === b) continue;

    let delta: number | null = null;
    let relativeDelta: number | null = null;
    let impact: number;

    if (isNumeric(a) && isNumeric(b)) {
      delta = b - a;
      relativeDelta = a !== 0 ? (b - a) / Math.abs(a) : null;
      impact = relativeDelta !== null ? Math.abs(relativeDelta) : Math.abs(b - a);
    } else if (a === undefined || a === null || b === undefined || b === null) {
      // Added or removed — large impact
      impact = Number.POSITIVE_INFINITY;
    } else {
      // Type-mismatch or string change — large impact
      impact = Number.POSITIVE_INFINITY;
    }

    changes.push({ key, prior: a, current: b, delta, relativeDelta, impact });
  }

  return changes;
}

/**
 * Sort changes by impact descending. Stable on ties (preserves key order).
 */
export function rankByImpact(diff: ChangedCell[]): ChangedCell[] {
  return [...diff].sort((x, y) => {
    if (x.impact === y.impact) return 0;
    return y.impact - x.impact;
  });
}

/**
 * Convenience: top N changes by impact.
 */
export function topChanges(prior: RunSnapshot, current: RunSnapshot, n: number = 5): ChangedCell[] {
  return rankByImpact(diffRuns(prior, current)).slice(0, n);
}
