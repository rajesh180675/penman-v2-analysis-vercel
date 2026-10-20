import { scoreSnapshotAgainstFilings, type FiledScore, type FiledYear, type FiledYearToDate, type ForecastToScore } from "./snapshot";

/** A frozen forecast as the scorer reads it: the snapshot file, or the browser's copy of it. */
export type FrozenToScore = ForecastToScore & { readonly madeAt: string; readonly ticker: string };

export interface FrozenScore {
  readonly madeAt: string;
  readonly ticker: string;
  readonly cutoff: string;
  readonly scores: FiledScore[];
  readonly skipped: string | null;
}

/**
 * Every frozen forecast scored against the results filed since
 * (scoreSnapshotAgainstFilings): score-frozen.ts from the snapshot files and
 * the as-filed ledger, the Record page from their published copies, so the
 * two cannot disagree. Snapshots in set order, then ticker; `filingsFor` is
 * null for a company with no as-filed ledger.
 */
export function scoreFrozenForecasts(
  snapshots: readonly FrozenToScore[],
  filingsFor: (ticker: string) => { readonly years: readonly FiledYear[]; readonly yearsToDate: readonly FiledYearToDate[] } | null,
): FrozenScore[] {
  // v1 snapshots do not record their accounts; the rule that chose them is the
  // one v2 snapshots record (standalone where consolidated history is short).
  const accountsByTicker = new Map<string, string>();
  for (const s of snapshots) if (s.basis?.accounts) accountsByTicker.set(s.ticker, s.basis.accounts);
  return snapshots.map((snapshot) => {
    const filings = filingsFor(snapshot.ticker);
    let outcome: { scores: FiledScore[]; skipped: string | null };
    if (!filings) outcome = { scores: [], skipped: "no as-filed ledger" };
    else if (!snapshot.basis && accountsByTicker.get(snapshot.ticker) === "standalone") outcome = { scores: [], skipped: "a forecast on standalone accounts; the ledger is consolidated" };
    else outcome = scoreSnapshotAgainstFilings(snapshot, filings.years, filings.yearsToDate);
    return { madeAt: snapshot.madeAt, ticker: snapshot.ticker, cutoff: snapshot.cutoffPeriod, ...outcome };
  });
}

export const SCORED_METRICS = ["sales-log-error", "core-margin-point-error", "cni-roe-point-error"] as const;

export interface FrozenSetScores {
  readonly madeAt: string;
  readonly forecasts: number;
  /** Forecasts with a filed year scored, the year in progress aside. */
  readonly scored: number;
  readonly final: FiledScore[];
  readonly provisional: FiledScore[];
  /** The months the year in progress was projected from, or null when they differ by company. */
  readonly provisionalMonths: number | null;
}

/** The scores of each frozen set, in set order: filed years apart from the year in progress. */
export function scoresBySet(results: readonly FrozenScore[]): FrozenSetScores[] {
  return [...new Set(results.map((r) => r.madeAt))].map((madeAt) => {
    const rows = results.filter((r) => r.madeAt === madeAt);
    const provisional = rows.flatMap((r) => r.scores.filter((s) => s.provisional));
    return {
      madeAt,
      forecasts: rows.length,
      scored: rows.filter((r) => r.scores.some((s) => !s.provisional)).length,
      final: rows.flatMap((r) => r.scores.filter((s) => !s.provisional)),
      provisional,
      provisionalMonths: new Set(provisional.map((s) => `${s.periodEnd}:${s.provisional!.months}`)).size > 1 ? null : provisional[0]?.provisional?.months ?? null,
    };
  });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN;
};

export interface ScoreSummary {
  readonly metric: FiledScore["metric"];
  readonly n: number;
  /** Median absolute error of the forecast, and of "the cutoff year again"; NaN when n is 0. */
  readonly model: number;
  readonly randomWalk: number;
  /** 1 − model / randomWalk. */
  readonly skill: number;
  /** Mean signed error of the forecast. */
  readonly bias: number;
  /** Forecasts closer than the random walk. */
  readonly closer: number;
}

export function summarizeScores(scores: readonly FiledScore[], metrics: readonly FiledScore["metric"][] = SCORED_METRICS): ScoreSummary[] {
  return metrics.map((metric) => {
    const xs = scores.filter((s) => s.metric === metric);
    const model = median(xs.map((s) => Math.abs(s.model)));
    const randomWalk = median(xs.map((s) => Math.abs(s.randomWalk)));
    return {
      metric,
      n: xs.length,
      model,
      randomWalk,
      skill: 1 - model / randomWalk,
      bias: xs.length ? xs.reduce((a, s) => a + s.model, 0) / xs.length : NaN,
      closer: xs.filter((s) => Math.abs(s.model) < Math.abs(s.randomWalk)).length,
    };
  });
}

export interface BandShares {
  readonly metric: FiledScore["metric"];
  readonly n: number;
  /** Shares of the banded scores; NaN when n is 0. */
  readonly below: number;
  readonly within: number;
  readonly above: number;
  readonly belowPanic: number;
}

/** Where the filed figures fell against the frozen stress and bull cases; null when no score records them. */
export function summarizeBands(scores: readonly FiledScore[], metrics: readonly FiledScore["metric"][] = SCORED_METRICS): BandShares[] | null {
  const banded = scores.filter((s) => s.band);
  if (!banded.length) return null;
  return metrics.map((metric) => {
    const xs = banded.filter((s) => s.metric === metric);
    const share = (test: (s: FiledScore) => boolean) => (xs.length ? xs.filter(test).length / xs.length : NaN);
    return {
      metric,
      n: xs.length,
      below: share((s) => s.band!.position === "below"),
      within: share((s) => s.band!.position === "within"),
      above: share((s) => s.band!.position === "above"),
      belowPanic: share((s) => s.actual < s.band!.historicalPanic),
    };
  });
}
