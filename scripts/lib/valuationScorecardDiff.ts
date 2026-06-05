import type {
  ScorecardFamilyId,
  ValuationMaturityScorecard,
  ValuationScorecardRowSummary,
} from "./valuationMaturityScorecard";
import type { AuditOutcome } from "./auditTypes";

const OUTCOME_RANK: Record<AuditOutcome, number> = {
  CALC_ERROR: 0,
  MODEL_GAP: 1,
  POLICY_WARNING: 2,
  EXPECTED_SKIP_UNSUPPORTED_SOURCE: 3,
  EXPECTED_SKIP_INSUFFICIENT_HISTORY: 3,
  EXPECTED_SKIP_MISSING_SIDECAR: 3,
  ECONOMICALLY_PLAUSIBLE_CAPPED: 4,
  VALUATION_ELIGIBLE_GUARDED: 5,
  PRODUCTION_READY: 6,
};

export interface ValuationScorecardFamilyDelta {
  id: ScorecardFamilyId;
  before: number;
  after: number;
  delta: number;
}

export interface ValuationScorecardRowChange {
  ticker: string;
  beforeOutcome: AuditOutcome | null;
  afterOutcome: AuditOutcome | null;
  beforeRigorLevel: string | null;
  afterRigorLevel: string | null;
  clearedBlockers: string[];
  addedBlockers: string[];
}

export interface ValuationScorecardDiff {
  beforeScore: number;
  afterScore: number;
  overallScoreDelta: number;
  familyDeltas: ValuationScorecardFamilyDelta[];
  rowChanges: ValuationScorecardRowChange[];
  regressions: string[];
}

function roundDelta(value: number): number {
  return Number(value.toFixed(1));
}

function byTicker(rows: ValuationScorecardRowSummary[]): Map<string, ValuationScorecardRowSummary> {
  return new Map(rows.map((row) => [row.ticker, row]));
}

function blockerCodes(row: ValuationScorecardRowSummary | undefined): Set<string> {
  return new Set((row?.blockers ?? []).map((blocker) => blocker.code));
}

function diffCodes(before: Set<string>, after: Set<string>): { cleared: string[]; added: string[] } {
  const cleared = Array.from(before).filter((code) => !after.has(code)).sort();
  const added = Array.from(after).filter((code) => !before.has(code)).sort();
  return { cleared, added };
}

export function diffValuationMaturityScorecards(
  before: ValuationMaturityScorecard,
  after: ValuationMaturityScorecard,
): ValuationScorecardDiff {
  const beforeFamilies = new Map(before.families.map((family) => [family.id, family]));
  const familyDeltas = after.families.map((family) => {
    const beforeScore = beforeFamilies.get(family.id)?.score ?? 0;
    return {
      id: family.id,
      before: beforeScore,
      after: family.score,
      delta: roundDelta(family.score - beforeScore),
    };
  });

  const beforeRows = byTicker(before.rowSummaries ?? []);
  const afterRows = byTicker(after.rowSummaries ?? []);
  const tickers = Array.from(new Set([...Array.from(beforeRows.keys()), ...Array.from(afterRows.keys())])).sort();
  const rowChanges: ValuationScorecardRowChange[] = [];
  const regressions: string[] = [];

  for (const ticker of tickers) {
    const beforeRow = beforeRows.get(ticker);
    const afterRow = afterRows.get(ticker);
    const { cleared, added } = diffCodes(blockerCodes(beforeRow), blockerCodes(afterRow));
    const outcomeChanged = beforeRow?.outcome !== afterRow?.outcome;
    const rigorChanged = beforeRow?.rigorLevel !== afterRow?.rigorLevel;
    if (outcomeChanged || rigorChanged || cleared.length > 0 || added.length > 0) {
      rowChanges.push({
        ticker,
        beforeOutcome: beforeRow?.outcome ?? null,
        afterOutcome: afterRow?.outcome ?? null,
        beforeRigorLevel: beforeRow?.rigorLevel ?? null,
        afterRigorLevel: afterRow?.rigorLevel ?? null,
        clearedBlockers: cleared,
        addedBlockers: added,
      });
    }

    if (beforeRow && afterRow && OUTCOME_RANK[afterRow.outcome] < OUTCOME_RANK[beforeRow.outcome]) {
      regressions.push(`${ticker}: outcome regressed from ${beforeRow.outcome} to ${afterRow.outcome}`);
    }
  }

  for (const family of familyDeltas) {
    if (family.delta < 0) regressions.push(`${family.id}: score regressed by ${Math.abs(family.delta).toFixed(1)}`);
  }

  return {
    beforeScore: before.overallScore,
    afterScore: after.overallScore,
    overallScoreDelta: roundDelta(after.overallScore - before.overallScore),
    familyDeltas,
    rowChanges,
    regressions,
  };
}
