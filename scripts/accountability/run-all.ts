#!/usr/bin/env tsx
/**
 * run-all.ts — forecast accountability over the whole registry.
 *
 *   npx tsx scripts/accountability/run-all.ts [--made-at=YYYY-MM-DD] [--skip-runs]
 *
 * 1. Runs company-run.ts once per company, each in its own process.
 * 2. Aggregates the walk-forward backtest into accountability/summary.json and
 *    docs/generated/forecast-accountability.md.
 * 3. Estimates panel persistence priors into
 *    src/engine/selfConsistentValuation/persistencePriors.generated.ts.
 * 4. Freezes today's forecasts into accountability/snapshots/<made-at>/ —
 *    never overwriting an existing snapshot: a frozen forecast is a record.
 * 5. Writes public/data/accountability/track-record.json — each company's
 *    one-year-ahead record against a random walk, for the Case Verdict.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  companyTrackRecord,
  estimatePanelPersistence,
  summarizeWalkForward,
  type AccountabilitySummary,
  type CompanyWalkForward,
  type PersistenceEstimate,
  type RnoaSeries,
} from "../../src/engine/accountability";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const madeAt = arg("made-at") ?? new Date().toISOString().slice(0, 10);
const skipRuns = process.argv.includes("--skip-runs");

const registry: { folder: string; ticker: string; type: string }[] =
  JSON.parse(readFileSync(join(ROOT, "public", "data", "companies", "registry.json"), "utf-8"));

if (!skipRuns) {
  for (const company of registry) {
    const started = Date.now();
    // Quoted: with shell: true, cmd.exe splits an unquoted "M&M" at the "&".
    const result = spawnSync("npx", ["tsx", "scripts/accountability/company-run.ts", `"--ticker=${company.ticker}"`, `--made-at=${madeAt}`], {
      cwd: ROOT,
      shell: true,
      encoding: "utf8",
      timeout: 300_000,
    });
    const status = result.status === 0 ? "ok" : `FAILED (${result.status}) ${(result.stderr ?? "").split("\n").slice(-3).join(" ")}`;
    console.log(`${company.ticker.padEnd(12)} ${status} ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
}

interface RunFile {
  ticker: string;
  companyType: string;
  skipped?: string;
  walkForward?: CompanyWalkForward;
  rnoaPoints?: { year: number; rnoa: number }[];
  snapshot?: (Record<string, unknown> & { cutoffPeriod?: string; latestReportedPeriod?: string; error?: string }) | null;
}

const runs: RunFile[] = registry.flatMap((c) => {
  const path = join(ROOT, "accountability", "runs", `${c.ticker}.json`);
  return existsSync(path) ? [JSON.parse(readFileSync(path, "utf8")) as RunFile] : [];
});
const industrial = runs.filter((r) => r.walkForward);
const walkForwards = industrial.map((r) => r.walkForward!);

// ── Backtest summary ──────────────────────────────────────────────────────
const overall = summarizeWalkForward(walkForwards);
const groups = [...new Set(industrial.map((r) => r.companyType))].sort();
const byGroup = Object.fromEntries(groups.map((g) => [g, summarizeWalkForward(walkForwards.filter((w) => w.companyType === g))]));

// ── Panel persistence priors ──────────────────────────────────────────────
const series: RnoaSeries[] = industrial.map((r) => ({ companyId: r.ticker, group: r.companyType, points: r.rnoaPoints ?? [] }));
const priors = estimatePanelPersistence(series);

// ── Frozen snapshots (never overwritten) ──────────────────────────────────
const snapshotDir = join(ROOT, "accountability", "snapshots", madeAt);
mkdirSync(snapshotDir, { recursive: true });
let written = 0;
let kept = 0;
const anchorLags: { ticker: string; cutoff: string; latest: string; lagYears: number }[] = [];
for (const r of industrial) {
  const s = r.snapshot;
  if (!s || s.error || !s.cutoffPeriod) continue;
  const lagYears = Number(String(s.latestReportedPeriod).slice(0, 4)) - Number(s.cutoffPeriod.slice(0, 4));
  anchorLags.push({ ticker: r.ticker, cutoff: s.cutoffPeriod, latest: String(s.latestReportedPeriod), lagYears });
  const path = join(snapshotDir, `${r.ticker}.json`);
  if (existsSync(path)) { kept++; continue; }
  writeFileSync(path, JSON.stringify(s, null, 1) + "\n");
  written++;
}

// ── Per-company track record, served to the browser ───────────────────────
const publicDir = join(ROOT, "public", "data", "accountability");
mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, "track-record.json"), JSON.stringify({
  madeAt,
  basis: "Walk-forward backtest of the base forecast (scripts/accountability/run-all.ts); one year ahead, against a random walk. Capitaline serves restated figures, so the record sees restatements of its own history.",
  companies: walkForwards.map(companyTrackRecord),
}, null, 1) + "\n");

writeFileSync(join(ROOT, "accountability", "summary.json"), JSON.stringify({ madeAt, overall, byGroup, priors, anchorLags }, null, 1) + "\n");
writeFileSync(join(ROOT, "src", "engine", "selfConsistentValuation", "persistencePriors.generated.ts"), renderPriors(priors, madeAt, series.length));
writeFileSync(join(ROOT, "docs", "generated", "forecast-accountability.md"), renderReport(overall, byGroup, priors, anchorLags, runs));
console.log(`\n${industrial.length} industrial companies, ${overall.origins} forecast origins; snapshots written ${written}, kept ${kept}.`);

// ── Renderers ─────────────────────────────────────────────────────────────
function pct(x: number, digits = 1) { return `${(x * 100).toFixed(digits)}%`; }
function signed(x: number, digits = 1) { return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}`; }

function metricLabel(metric: string) {
  return metric === "sales-log-error" ? "Sales (log error)"
    : metric === "core-oi-margin-error" ? "Core OI margin (pp of sales)"
    : metric === "core-rnoa-error" ? "Core RNOA (pp)"
    : "CNI (ROE pp)";
}

function summaryTable(summary: AccountabilitySummary) {
  const lines = [
    "| Metric | Horizon | n | Model MAE | Model MdAE | Bias | Skill vs RW (mean / median) | Skill vs trend (mean / median) | Beats RW |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const row of summary.rows) {
    lines.push(`| ${metricLabel(row.metric)} | t+${row.horizon} | ${row.n} | ${(row.modelMae * 100).toFixed(1)} | ${(row.modelMdae * 100).toFixed(1)} | ${signed(row.modelBias)} | ${signed(row.skill["random-walk"], 0)}% / ${signed(row.medianSkill["random-walk"], 0)}% | ${signed(row.skill["trailing-trend"], 0)}% / ${signed(row.medianSkill["trailing-trend"], 0)}% | ${pct(row.winRateVsRandomWalk, 0)} |`);
  }
  return lines.join("\n");
}

function renderReport(
  all: AccountabilitySummary,
  groupsSummary: Record<string, AccountabilitySummary>,
  estimates: PersistenceEstimate[],
  lags: typeof anchorLags,
  allRuns: RunFile[],
) {
  const skippedRuns = allRuns.filter((r) => r.skipped);
  const lagged = lags.filter((l) => l.lagYears > 0);
  return `# Forecast accountability

Generated by \`scripts/accountability/run-all.ts\` on ${madeAt}. Do not edit by hand.

The app's **base forecast** (the command center's persistence scenario — what the Valuation tab shows) is re-run at every historical cutoff with at least 5 years of history, and each forecast year is scored against what the company later reported. Every score sits beside two naive benchmarks built from the same truncated history:

- **random walk** — sales, core RNOA and CNI stay where they were;
- **trailing trend** — sales grow at their trailing 3-year CAGR, RNOA reverts to its 3-year mean, CNI grows with sales.

**Skill** = 1 − MAE(model) / MAE(benchmark). Positive means the model's forecast carries information the benchmark doesn't; negative means the benchmark was more accurate. **Bias** is the mean signed error (forecast − actual): positive is optimistic.

> **Caveat — restated data.** Capitaline serves the latest restated figures, not what was reported at each cutoff, so the backtest sees restatements of its own history. Results are optimistic to the extent those restatements were informative. The point-in-time filings ledger (next phase, Track A) removes this; the frozen snapshots below are the look-ahead-free record from today on.

## All industrial companies (${all.companies} companies, ${all.origins} forecast origins)

${summaryTable(all)}

## By company type

${Object.entries(groupsSummary).map(([group, summary]) => `### ${group} (${summary.companies} companies, ${summary.origins} origins)\n\n${summaryTable(summary)}`).join("\n\n")}

## Persistence of abnormal operating profitability (panel estimate)

Pooled AR(1) of each firm's core RNOA deviation from the year's cross-sectional median (Nissim–Penman fade). These replace the hand-set 0.7 prior in the self-consistent ReOI model. The within-firm figure (Nickell-corrected) measures persistence around each firm's *own* mean and is shown for context only.

| Group | φ (prior) | φ within-firm | Year-pairs | Companies |
|---|---|---|---|---|
${estimates.map((e) => `| ${e.group} | ${e.phi.toFixed(3)} | ${e.phiWithin == null ? "—" : e.phiWithin.toFixed(3)} | ${e.pairs} | ${e.companies} |`).join("\n")}

Groups with fewer than 3 companies or 20 year-pairs fall back to the pooled "all" estimate.

## Valuation anchor lag

The valuation readiness policy walks back from the latest period when that period fails economic sanity. ${lagged.length} of ${lags.length} companies are valued from a period older than their latest report:

${lagged.length ? `| Company | Valued from | Latest reported | Years behind |\n|---|---|---|---|\n${lagged.sort((a, b) => b.lagYears - a.lagYears).map((l) => `| ${l.ticker} | ${l.cutoff} | ${l.latest} | ${l.lagYears} |`).join("\n")}` : "None."}

## Frozen forecast snapshots

Today's base forecasts are frozen in \`accountability/snapshots/${madeAt}/\` and are never regenerated. As each company reports FY${Number(madeAt.slice(0, 4)) + 1}, \`scoreSnapshot\` scores them with no look-ahead.

## Not covered

${skippedRuns.length} companies are outside the industrial forecast engine (banks, NBFCs and insurers have no base forecast yet): ${skippedRuns.map((r) => r.ticker).join(", ") || "none"}.
`;
}

function renderPriors(estimates: PersistenceEstimate[], date: string, companies: number) {
  const entries = estimates.map((e) => `  ${JSON.stringify(e.group)}: { phi: ${e.phi.toFixed(4)}, pairs: ${e.pairs}, companies: ${e.companies} },`).join("\n");
  return `// GENERATED by scripts/accountability/run-all.ts on ${date} — do not edit by hand.
//
// Panel estimates of how fast abnormal operating profitability fades, from
// ${companies} Indian industrial companies' core-RNOA history (pooled AR(1) of
// the deviation from each year's cross-sectional median; see
// src/engine/accountability/persistence.ts). "all" is the pooled fallback.

export interface PanelPersistencePrior {
  readonly phi: number;
  readonly pairs: number;
  readonly companies: number;
}

export const PERSISTENCE_PRIORS_AS_OF = ${JSON.stringify(date)};

export const PANEL_PERSISTENCE_PRIORS: Readonly<Record<string, PanelPersistencePrior>> = {
${entries}
};
`;
}
