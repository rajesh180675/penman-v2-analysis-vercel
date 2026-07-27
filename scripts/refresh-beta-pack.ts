/**
 * refresh-beta-pack.ts — regenerate the pinned India equity beta pack.
 *
 * Usage:
 *   npx tsx scripts/refresh-beta-pack.ts            # writes the pack
 *   npx tsx scripts/refresh-beta-pack.ts --dry-run  # prints the table, writes nothing
 *
 * Why a script rather than a runtime fetch: the pack is an input to valuation,
 * and an input fetched at run time is not pinned — two runs of the same company
 * on the same data would get different discount rates depending on when they
 * ran. So the network call happens here, deliberately outside the run, and its
 * result is committed. This is the same discipline `indiaMacroPack.ts` follows
 * by hand; a beta needs a script because it is a regression over 261
 * observations rather than a single published figure.
 *
 * The regression is plain OLS of the stock's return on the index's return —
 * beta = cov(rs, rm) / var(rm) — with the standard error of the slope,
 * sqrt((SSE/(n-2)) / SSxx). No shrinkage and no relevering; see
 * `equityBetaPack.ts` for why both are deliberately out of scope.
 *
 * A self-regression control runs before anything is written: regressing the
 * benchmark on itself must give beta 1 and r-squared 1 to within floating-point
 * tolerance. If the alignment or return maths were wrong, that is the cheapest
 * place to see it, and the script refuses to emit a pack when it fails.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT, "public", "data", "companies", "registry.json");
const OUT_PATH = path.join(ROOT, "src", "engine", "marketPacks", "indiaEquityBetaPack.ts");

/** NIFTY 50. The broad Indian large-cap index, and the one the repo's own market-data route already quotes. */
const BENCHMARK_SYMBOL = "^NSEI";
const BENCHMARK_LABEL = "NIFTY 50 (^NSEI)";
const INTERVAL = "1wk";
const RANGE = "5y";
const SOURCE = `Yahoo Finance adjusted-close history (query1.finance.yahoo.com/v8/finance/chart), ${INTERVAL} bars over ${RANGE}, regressed against ${BENCHMARK_LABEL}`;

interface RegistryEntry {
  readonly folder: string;
  readonly name: string;
  readonly ticker: string;
}

/** Date (YYYY-MM-DD) → adjusted close. */
type Series = Map<string, number>;

async function fetchSeries(symbol: string): Promise<Series> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${INTERVAL}&range=${RANGE}`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (penman-v2-analysis beta pack refresh)" } });
  if (!response.ok) throw new Error(`${symbol}: HTTP ${response.status}`);
  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { adjclose?: Array<{ adjclose?: (number | null)[] }>; quote?: Array<{ close?: (number | null)[] }> };
      }>;
      error?: unknown;
    };
  };
  const result = payload.chart?.result?.[0];
  if (!result?.timestamp) throw new Error(`${symbol}: no timestamps in response`);

  // Adjusted close, so splits and dividends do not enter the returns as jumps.
  // Falls back to raw close only when the adjusted series is absent entirely.
  const closes = result.indicators?.adjclose?.[0]?.adjclose ?? result.indicators?.quote?.[0]?.close;
  if (!closes) throw new Error(`${symbol}: no close series in response`);

  const series: Series = new Map();
  for (let i = 0; i < result.timestamp.length; i += 1) {
    const value = closes[i];
    if (value == null || !Number.isFinite(value) || value <= 0) continue;
    series.set(new Date(result.timestamp[i]! * 1000).toISOString().slice(0, 10), value);
  }
  return series;
}

interface Regression {
  readonly beta: number;
  readonly standardError: number;
  readonly rSquared: number;
  readonly observations: number;
  readonly windowStart: string;
  readonly windowEnd: string;
}

/**
 * OLS of the stock's return on the benchmark's return over their shared dates.
 *
 * The join is on the bar date, which is exact here rather than approximate:
 * every series Yahoo returns for this interval carries identical period keys,
 * so no calendar alignment or forward-filling is involved. A missing bar drops
 * that observation for that company only.
 *
 * The final bar is dropped from both series before returning. It is the current
 * period, still moving, so including it would make a pinned figure depend on the
 * hour the script ran.
 */
function regress(stock: Series, benchmark: Series): Regression | { readonly error: string } {
  const dates = [...stock.keys()].filter((date) => benchmark.has(date)).sort();
  if (dates.length < 3) return { error: `only ${dates.length} overlapping bar(s) with the benchmark` };
  const usable = dates.slice(0, -1);

  const stockReturns: number[] = [];
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < usable.length; i += 1) {
    const previousDate = usable[i - 1]!;
    const currentDate = usable[i]!;
    stockReturns.push(stock.get(currentDate)! / stock.get(previousDate)! - 1);
    benchmarkReturns.push(benchmark.get(currentDate)! / benchmark.get(previousDate)! - 1);
  }

  const n = stockReturns.length;
  if (n < 3) return { error: `only ${n} return observation(s)` };

  const meanBenchmark = benchmarkReturns.reduce((sum, value) => sum + value, 0) / n;
  const meanStock = stockReturns.reduce((sum, value) => sum + value, 0) / n;
  let sumCross = 0;
  let sumSquares = 0;
  for (let i = 0; i < n; i += 1) {
    sumCross += (benchmarkReturns[i]! - meanBenchmark) * (stockReturns[i]! - meanStock);
    sumSquares += (benchmarkReturns[i]! - meanBenchmark) ** 2;
  }
  if (sumSquares <= 0) return { error: "benchmark returns have zero variance" };

  const beta = sumCross / sumSquares;
  const alpha = meanStock - beta * meanBenchmark;
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i += 1) {
    sse += (stockReturns[i]! - (alpha + beta * benchmarkReturns[i]!)) ** 2;
    sst += (stockReturns[i]! - meanStock) ** 2;
  }
  if (sst <= 0) return { error: "stock returns have zero variance" };

  return {
    beta,
    standardError: Math.sqrt((sse / (n - 2)) / sumSquares),
    rSquared: 1 - sse / sst,
    observations: n,
    // usable[0] is the base price for the first return, so the first return
    // period is usable[1].
    windowStart: usable[1]!,
    windowEnd: usable[usable.length - 1]!,
  };
}

function round(value: number, places: number): number {
  return Number(value.toFixed(places));
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const registry: RegistryEntry[] = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));

  const benchmark = await fetchSeries(BENCHMARK_SYMBOL);
  console.log(`Benchmark ${BENCHMARK_LABEL}: ${benchmark.size} bars`);

  // Self-regression control. If the join or the return maths were wrong this is
  // where it shows, and it is checked before any output is produced.
  const control = regress(benchmark, benchmark);
  if ("error" in control) throw new Error(`self-regression control failed: ${control.error}`);
  if (Math.abs(control.beta - 1) > 1e-9 || Math.abs(control.rSquared - 1) > 1e-9) {
    throw new Error(`self-regression control returned beta ${control.beta} / r2 ${control.rSquared}; expected exactly 1 / 1`);
  }
  console.log(`Self-regression control: beta ${control.beta.toFixed(6)}, r2 ${control.rSquared.toFixed(6)}, n ${control.observations} — OK`);

  const rows: Array<{ ticker: string; regression: Regression }> = [];
  const skipped: string[] = [];
  for (const entry of registry) {
    const symbol = `${entry.ticker}.NS`;
    try {
      const series = await fetchSeries(symbol);
      const regression = regress(series, benchmark);
      if ("error" in regression) {
        skipped.push(`${entry.ticker}: ${regression.error}`);
        continue;
      }
      rows.push({ ticker: entry.ticker, regression });
      console.log(
        `${entry.ticker.padEnd(12)} beta ${regression.beta.toFixed(4)}  se ${regression.standardError.toFixed(4)}  r2 ${regression.rSquared.toFixed(3)}  n ${regression.observations}`,
      );
    } catch (error) {
      skipped.push(`${entry.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (skipped.length) {
    // Loud, and not a silent omission: a company missing from the pack resolves
    // to a sector prior, and a reviewer needs to know that happened.
    console.log(`\nNot in pack (${skipped.length}):`);
    for (const line of skipped) console.log(`  ${line}`);
  }

  rows.sort((left, right) => left.ticker.localeCompare(right.ticker));
  const packAsOf = rows.reduce((latest, row) => (row.regression.windowEnd > latest ? row.regression.windowEnd : latest), "0000-00-00");

  const body = rows
    .map(({ ticker, regression }) => `  {
    ticker: ${JSON.stringify(ticker)},
    leveredBeta: ${round(regression.beta, 4)},
    standardError: ${round(regression.standardError, 4)},
    rSquared: ${round(regression.rSquared, 4)},
    observations: ${regression.observations},
    windowStart: ${JSON.stringify(regression.windowStart)},
    windowEnd: ${JSON.stringify(regression.windowEnd)},
  },`)
    .join("\n");

  const contents = `/**
 * The pinned India equity beta pack — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Regenerate with:
 *   npx tsx scripts/refresh-beta-pack.ts
 *
 * Every number here is an OLS slope of a company's ${INTERVAL} return on the
 * ${BENCHMARK_LABEL} return over ${RANGE}, together with the standard error,
 * r-squared, and observation count that say how much to trust it. Editing a
 * value by hand would break the one property that makes this pack defensible:
 * that a reviewer can re-derive all of it by re-running one command.
 *
 * Constituents whose standard error exceeds MAX_BETA_STANDARD_ERROR are still
 * listed. They are excluded at resolve time, with a stated reason, rather than
 * omitted here — a name absent from the pack and a name whose beta was measured
 * and found too noisy are different facts, and the second one is worth showing.
 */

import type { EquityBetaPack } from "./equityBetaPack";

export const INDIA_EQUITY_BETA_PACK: EquityBetaPack = {
  asOf: ${JSON.stringify(packAsOf)},
  benchmark: ${JSON.stringify(BENCHMARK_LABEL)},
  frequency: "weekly",
  source: ${JSON.stringify(SOURCE)},
  constituents: [
${body}
  ],
};
`;

  if (dryRun) {
    console.log(`\n--dry-run: would write ${rows.length} constituent(s) to ${path.relative(ROOT, OUT_PATH)}`);
    return;
  }
  fs.writeFileSync(OUT_PATH, contents, "utf-8");
  console.log(`\nWrote ${rows.length} constituent(s) to ${path.relative(ROOT, OUT_PATH)} (asOf ${packAsOf})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
