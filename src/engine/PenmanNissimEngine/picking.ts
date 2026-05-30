/* ================================================================
   PenmanNissimEngine decomposition — pick/extraction helpers.

   Lifted verbatim from src/engine/PenmanNissimEngine.ts. These are the
   raw-line resolution primitives (normalisation, fuzzy picking, trace
   pushing, statement-scoped value readers, share-count extraction) shared
   by the recast and quality layers. Imports DOWN from the ./types barrel
   only; no coupling back to the parent. Behaviour byte-for-byte identical.
================================================================ */

import {
  RawPeriodData,
  TraceMap,
  TraceEntry,
  ShareCountInputSnapshot,
} from "../types";

const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .replace(/0ther/g, "other")
    .replace(/shorttem/g, "shortterm")
    .replace(/longtem/g, "longterm")
    .replace(/\btem\b/g, "term")
    .replace(/amotisation/g, "amortisation");
const norm = (s: string) => normalizeText(s).replace(/[^a-z0-9]/g, "").trim();
export const stdNormCdf = (x: number) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};

type PickResult = {
  value: number;
  key: string;
  statement: "BalanceSheet" | "ProfitLoss" | "CashFlow" | "Fallback";
  matchType: "exact_composite" | "exact_base" | "fuzzy";
  note?: string | undefined;
};
type PickResultWithSource = PickResult & { sourceId: string };

export function pushTrace(trace: TraceMap | undefined, line: string | undefined, entry: TraceEntry) {
  if (!trace || !line) return;
  if (!trace[line]) trace[line] = [];
  if (entry.note === undefined) {
    const { note: _note, ...withoutUndefinedNote } = entry;
    trace[line].push(withoutUndefinedNote);
    return;
  }
  trace[line].push(entry);
}

function pickOneWithSource(data: RawPeriodData, key: string, stmt?: "BalanceSheet" | "ProfitLoss" | "CashFlow"): PickResultWithSource | null {
  const rv = data.raw_metric_values;
  if (stmt) {
    const compositeKey = `${key}__${stmt}`;
    const direct = rv[compositeKey];
    if (direct != null && Number.isFinite(direct)) {
      return { value: direct, key, statement: stmt, matchType: "exact_composite", sourceId: compositeKey };
    }
  }
  const base = rv[key];
  if (base != null && Number.isFinite(base)) {
    return { value: base, key, statement: "Fallback", matchType: "exact_base", sourceId: key };
  }

  const nk = norm(key);
  let best: number | null = null;
  let bestKey = key;
  let bestStmt: "BalanceSheet" | "ProfitLoss" | "CashFlow" | "Fallback" = "Fallback";
  let bestRawKey = key;
  let bestP = -1;
  for (const [k, v] of Object.entries(rv)) {
    if (v == null || !Number.isFinite(v)) continue;
    const i = k.lastIndexOf("__");
    const b = i >= 0 ? k.slice(0, i) : k;
    const st = i >= 0 ? (k.slice(i + 2) as "BalanceSheet" | "ProfitLoss" | "CashFlow") : undefined;
    if (norm(b) !== nk) continue;
    const p = stmt && st === stmt ? 10 : st === "BalanceSheet" ? 3 : st === "ProfitLoss" ? 2 : st === "CashFlow" ? 1 : 0;
    if (p > bestP) {
      bestP = p;
      best = v;
      bestKey = b;
      bestStmt = st ?? "Fallback";
      bestRawKey = k;
    }
  }
  if (best != null) {
    return { value: best, key: bestKey, statement: bestStmt, matchType: "fuzzy", sourceId: bestRawKey };
  }
  return null;
}

function pickWithSource(data: RawPeriodData, keys: readonly string[], stmt?: "BalanceSheet" | "ProfitLoss" | "CashFlow"): PickResult {
  for (const key of keys) {
    const picked = pickOneWithSource(data, key, stmt);
    if (picked) {
      return picked;
    }
  }
  return { value: 0, key: keys[0] ?? "", statement: stmt ?? "Fallback", matchType: "exact_base", note: "unmatched" };
}

export function sumWithDistinctSource(
  data: RawPeriodData,
  keys: readonly string[],
  stmt: "BalanceSheet" | "ProfitLoss" | "CashFlow",
  line?: string | undefined,
  trace?: TraceMap | undefined,
) {
  let total = 0;
  const usedSource = new Set<string>();
  for (const key of keys) {
    const picked = pickOneWithSource(data, key, stmt);
    if (!picked) {
      pushTrace(trace, line, {
        statement: stmt,
        key,
        value: 0,
        matchType: "exact_base",
        note: "unmatched",
      });
      continue;
    }
    if (usedSource.has(picked.sourceId)) {
      pushTrace(trace, line, {
        statement: picked.statement,
        key: picked.key,
        value: 0,
        matchType: picked.matchType,
        note: `duplicate_source_ignored:${picked.sourceId}`,
      });
      continue;
    }
    usedSource.add(picked.sourceId);
    total += picked.value;
    pushTrace(trace, line, {
      statement: picked.statement,
      key: picked.key,
      value: picked.value,
      matchType: picked.matchType,
    });
  }
  if (line) {
    pushTrace(trace, line, { statement: "Derived", key: "SUM", value: total, matchType: "derived" });
  }
  return total;
}

export const valBS = (d: RawPeriodData, k: readonly string[], line?: string | undefined, trace?: TraceMap) => {
  const r = pickWithSource(d, k, "BalanceSheet");
  pushTrace(trace, line, { statement: r.statement, key: r.key, value: r.value, matchType: r.matchType, note: r.note });
  return r.value;
};
export const valPL = (d: RawPeriodData, k: readonly string[], line?: string | undefined, trace?: TraceMap) => {
  const r = pickWithSource(d, k, "ProfitLoss");
  pushTrace(trace, line, { statement: r.statement, key: r.key, value: r.value, matchType: r.matchType, note: r.note });
  return r.value;
};
export const valCF = (d: RawPeriodData, k: readonly string[], line?: string | undefined, trace?: TraceMap) => {
  const r = pickWithSource(d, k, "CashFlow");
  pushTrace(trace, line, { statement: r.statement, key: r.key, value: r.value, matchType: r.matchType, note: r.note });
  return r.value;
};

export function sumPLWithTrace(d: RawPeriodData, keys: readonly string[], line: string, trace?: TraceMap) {
  return sumWithDistinctSource(d, keys, "ProfitLoss", line, trace);
}

function normalizeShareCountToCrore(value: number): number {
  return value > 1_000_000 ? value / 10_000_000 : value;
}

export function extractShareCountInput(data: RawPeriodData): ShareCountInputSnapshot {
  const firstValid = (keys: readonly string[], stmt: "BalanceSheet" | "ProfitLoss") => {
    for (const key of keys) {
      const picked = pickOneWithSource(data, key, stmt);
      if (picked && picked.value > 0) return picked;
    }
    return null;
  };

  const shareCapitalPick = firstValid(["Share Capital", "Equity Share Capital"], "BalanceSheet");
  const faceValuePick = firstValid([
    "Face Value of Subscribed Shares Fully Paid up",
    "Face Value of Ordinary Shares A - Subscribed Fully Paid up",
    "Face Value of Equity Shares",
  ], "BalanceSheet");
  const shareCapital = shareCapitalPick?.value ?? null;
  const faceValue = faceValuePick?.value ?? null;
  const capitalDerivedShares = shareCapital != null && faceValue != null && faceValue > 0
    ? shareCapital / faceValue
    : null;

  const countCandidates = [
    firstValid(["Number of Equity Shares - Subscribed Fully Paid up"], "BalanceSheet"),
    firstValid(["Number of Equity Shares - Paid Up"], "BalanceSheet"),
    firstValid(["Number of Equity Shares - Issued"], "BalanceSheet"),
    firstValid(["Total Number of Equity Shares - Subscribed"], "BalanceSheet"),
  ].filter((picked): picked is NonNullable<typeof picked> => Boolean(picked));

  const bestCandidate = countCandidates
    .map((picked) => {
      const shares = normalizeShareCountToCrore(picked.value);
      const relErr = capitalDerivedShares && capitalDerivedShares > 0
        ? Math.abs(shares - capitalDerivedShares) / capitalDerivedShares
        : null;
      let score = 0;
      if (/subscribed fully paid up|paid up/i.test(picked.key)) score += 3;
      else if (/issued/i.test(picked.key)) score += 1;
      if (picked.value > 1_000_000) score += 1;
      if (relErr != null) {
        if (relErr <= 0.02) score += 5;
        else if (relErr <= 0.10) score += 3;
        else if (relErr <= 0.25) score += 1;
        else score -= 3;
      }
      const normalizedSource = picked.value > 1_000_000
        ? `${picked.key} (absolute count normalised to crore shares)`
        : `${picked.key} (reported share-count units)`;
      return { shares, source: normalizedSource, score, relErr: relErr ?? Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => (b.score - a.score) || (a.relErr - b.relErr))[0];

  const weightedAverageBasicPick = firstValid(["Weighted Average Number of Shares in Issue - Basic"], "ProfitLoss");
  const weightedAverageDilutedPick = firstValid(["Weighted Average Number of Shares in Issue - Diluted"], "ProfitLoss");

  const endPeriodShares = bestCandidate && bestCandidate.score >= 0
    ? bestCandidate.shares
    : capitalDerivedShares;
  const endPeriodSharesSource = bestCandidate && bestCandidate.score >= 0
    ? bestCandidate.source
    : capitalDerivedShares != null && faceValue != null
    ? `Share Capital ÷ face value ₹${faceValue}`
    : "";

  return {
    endPeriodShares: endPeriodShares ?? null,
    endPeriodSharesSource,
    weightedAverageBasicShares: weightedAverageBasicPick ? normalizeShareCountToCrore(weightedAverageBasicPick.value) : null,
    weightedAverageBasicSource: weightedAverageBasicPick?.key ?? "",
    weightedAverageDilutedShares: weightedAverageDilutedPick ? normalizeShareCountToCrore(weightedAverageDilutedPick.value) : null,
    weightedAverageDilutedSource: weightedAverageDilutedPick?.key ?? "",
    faceValue,
    shareCapital,
  };
}
