#!/usr/bin/env tsx
/**
 * score-frozen.ts — score the frozen forecasts against results filed since.
 *
 *   npx tsx scripts/accountability/score-frozen.ts
 *
 * Every snapshot in accountability/snapshots/<made-at>/ is scored against the
 * as-filed ledger (data/filings/<SYMBOL>/as-filed.json, first filings) for the
 * years it forecast that its data never reached (scoreSnapshotAgainstFilings).
 * Writes accountability/frozen-scores.json and
 * docs/generated/frozen-forecast-scores.md.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { firstFiledYears, scoreSnapshotAgainstFilings, type FiledScore, type FiledYear, type ForecastSnapshot } from "../../src/engine/accountability";
import type { AsFiledHeadlineRecord } from "../../src/engine/filings";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const SNAPSHOTS = join(ROOT, "accountability", "snapshots");

type Snapshot = ForecastSnapshot & { latestReportedPeriod?: string };

/** Each fiscal year as first filed. */
function filedYears(ticker: string): FiledYear[] | null {
  const path = join(ROOT, "data", "filings", ticker, "as-filed.json");
  if (!existsSync(path)) return null;
  return firstFiledYears((JSON.parse(readFileSync(path, "utf8")) as { records: AsFiledHeadlineRecord[] }).records);
}

const sets = readdirSync(SNAPSHOTS).sort();
const load = (madeAt: string) => readdirSync(join(SNAPSHOTS, madeAt)).filter((f) => f.endsWith(".json")).sort()
  .map((f) => JSON.parse(readFileSync(join(SNAPSHOTS, madeAt, f), "utf8")) as Snapshot);
// v1 snapshots do not record their accounts; the rule that chose them is the
// one v2 snapshots record (standalone where consolidated history is short).
const accountsByTicker = new Map<string, string>();
for (const madeAt of sets) {
  for (const s of load(madeAt)) if (s.basis?.accounts) accountsByTicker.set(s.ticker, s.basis.accounts);
}

interface Scored { madeAt: string; ticker: string; cutoff: string; scores: FiledScore[]; skipped: string | null }
const results: Scored[] = [];
for (const madeAt of sets) {
  for (const snapshot of load(madeAt)) {
    const filings = filedYears(snapshot.ticker);
    let outcome: { scores: FiledScore[]; skipped: string | null };
    if (!filings) outcome = { scores: [], skipped: "no as-filed ledger" };
    else if (!snapshot.basis && accountsByTicker.get(snapshot.ticker) === "standalone") outcome = { scores: [], skipped: "a forecast on standalone accounts; the ledger is consolidated" };
    else outcome = scoreSnapshotAgainstFilings(snapshot, filings);
    results.push({ madeAt, ticker: snapshot.ticker, cutoff: snapshot.cutoffPeriod, ...outcome });
  }
}
writeFileSync(join(ROOT, "accountability", "frozen-scores.json"), JSON.stringify(results, null, 1) + "\n");

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN;
};
const pct = (x: number, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}` : "—");
const signed = (x: number, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}` : "—");
const LABEL = { "sales-log-error": "Sales (log error, %)", "core-margin-point-error": "Core margin (points of sales)", "cni-roe-point-error": "Earnings (ROE points)" } as const;

function summary(scores: FiledScore[]) {
  return (["sales-log-error", "core-margin-point-error", "cni-roe-point-error"] as const).map((metric) => {
    const xs = scores.filter((s) => s.metric === metric);
    const model = median(xs.map((s) => Math.abs(s.model)));
    const rw = median(xs.map((s) => Math.abs(s.randomWalk)));
    const bias = xs.length ? xs.reduce((a, s) => a + s.model, 0) / xs.length : NaN;
    const wins = xs.filter((s) => Math.abs(s.model) < Math.abs(s.randomWalk)).length;
    const skill = 1 - model / rw;
    return `| ${LABEL[metric]} | ${xs.length} | ${pct(model)} | ${pct(rw)} | ${Number.isFinite(skill) ? `${signed(skill, 0)}%` : "—"} | ${signed(bias)} | ${wins} of ${xs.length} |`;
  }).join("\n");
}

const MEASURE = { "sales-log-error": "Sales", "core-margin-point-error": "Core margin", "cni-roe-point-error": "Earnings" } as const;

/** Where the filed figures fell against the frozen stress and bull cases, for forecasts that record them. */
function bands(scores: FiledScore[]) {
  const banded = scores.filter((s) => s.band);
  if (!banded.length) return "";
  const rows = (["sales-log-error", "core-margin-point-error", "cni-roe-point-error"] as const).map((metric) => {
    const xs = banded.filter((s) => s.metric === metric);
    const share = (test: (s: FiledScore) => boolean) => (xs.length ? `${Math.round((xs.filter(test).length / xs.length) * 100)}%` : "—");
    return `| ${MEASURE[metric]} | ${xs.length} | ${share((s) => s.band!.position === "below")} | ${share((s) => s.band!.position === "within")} | ${share((s) => s.band!.position === "above")} | ${share((s) => s.actual < s.band!.historicalPanic)} |`;
  });
  return `\n\nAgainst the frozen scenario cases:\n\n| Measure | n | Below stress | Between | Above bull | Below panic |\n|---|---|---|---|---|---|\n${rows.join("\n")}`;
}

const header ="| Metric | n | Model median error | Random-walk median error | Median skill | Mean bias | Beat the random walk |\n|---|---|---|---|---|---|---|";
const latest = sets.at(-1)!;
const latestRows = results.filter((r) => r.madeAt === latest);
const report = `# Frozen forecasts, scored against results filed since

Generated by \`scripts/accountability/score-frozen.ts\`. Do not edit by hand.

Each forecast frozen in \`accountability/snapshots/\` is scored against the results the company later filed on NSE, as first filed (\`data/filings\`), for the years its data never reached. This is the out-of-sample test the walk-forward backtest can only approximate. Capitaline serves restated history, but here the actuals are what was first reported, and the forecast never saw them. Model, benchmark and actuals all come from the same filings:
- **Sales** are compared net of the excise duty a filing itemizes.
- **Core margin** is operating income after tax over sales, built from the filed lines on the recast's tax rules (\`src/engine/accountability/filedCoreIncome.ts\`). It is scored as a move from the cutoff year: the forecast's margin less the one it started from, against the filed margin less the cutoff year's. The recast and the filings measure the level a median 0.5 points apart, which a move cancels; their moves differ by a median 0.20 points (into FY2023–FY2026, 6% of them by more than a point). Only forecasts that record the year they started from are scored on it: snapshots of schema v3, frozen from 2026-10-19 on.
- **Earnings** compare forecast CNI with the owners' profit filed (OCI aside), in points of the opening year's filed owners' equity.
- **Random walk** is "the cutoff year again". **Skill** = 1 − median error / random-walk median error.
- **Scenario bands.** Snapshots of schema v4 also record the stress, bull and historical-panic cases, and each filed figure is placed below stress, between stress and bull, or above bull, on the basis its base case is scored on (the margin moved from the cutoff year's filed margin). The bands were calibrated on the walk-forward (\`docs/generated/scenario-band-coverage.md\`), so this tests them on years the calibration never saw. Sets frozen before v4 have no band table.
- **One-offs.** Filed profit includes them on both sides. ITC's FY2025 owners' profit carries the hotels demerger gain, so its random walk for FY2026 misses by 20 ROE points. The forecast models neither.

Not scored:
- years the forecast's data already covered: an anchor that walked back was built on later years too;
- forecasts of a business the consolidated filings do not describe (a lending arm carved out, standalone accounts).

## By frozen set

${sets.map((madeAt) => {
    const rows = results.filter((r) => r.madeAt === madeAt);
    const scored = rows.filter((r) => r.scores.length > 0);
    return `### Frozen ${madeAt} (${scored.length} of ${rows.length} forecasts scored)\n\n${header}\n${summary(rows.flatMap((r) => r.scores))}${bands(rows.flatMap((r) => r.scores))}`;
  }).join("\n\n")}

## Frozen ${latest}, by company

| Company | Cutoff | Year | Sales error | Random walk | Margin error (pts) | Random walk | Earnings error (ROE pts) | Random walk |
|---|---|---|---|---|---|---|---|---|
${latestRows.flatMap((r) => {
    if (r.skipped) return [`| ${r.ticker} | ${r.cutoff} | — | not scored: ${r.skipped} | | | | | |`];
    if (!r.scores.length) return [`| ${r.ticker} | ${r.cutoff} | — | no filed year after its data yet | | | | | |`];
    const years = [...new Set(r.scores.map((s) => s.periodEnd))];
    return years.map((y) => {
      const cell = (metric: FiledScore["metric"]) => {
        const x = r.scores.find((s) => s.periodEnd === y && s.metric === metric);
        return x ? `${signed(x.model)} | ${signed(x.randomWalk)}` : "— | —";
      };
      return `| ${r.ticker} | ${r.cutoff} | ${y} | ${cell("sales-log-error")} | ${cell("core-margin-point-error")} | ${cell("cni-roe-point-error")} |`;
    });
  }).join("\n")}
`;
writeFileSync(join(ROOT, "docs", "generated", "frozen-forecast-scores.md"), report);
console.log(`${results.filter((r) => r.scores.length).length} of ${results.length} frozen forecasts scored across ${sets.length} sets.`);
