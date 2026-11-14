#!/usr/bin/env tsx
/**
 * margin-panel.ts — how far a core operating margin moves back toward its own
 * earlier level, on the survivorship-free panel, beside what the forecast's
 * fade assumes.
 *
 *   npm run accountability:margins
 *
 * Reads data/filings-panel/panel.json (FY t0 on, scripts/filings/fetch-panel.ts)
 * and data/filings-panel/history.json (the years before, income statement
 * only, scripts/filings/fetch-panel-history.ts). The core margin is the filed
 * one a frozen forecast is scored on (src/engine/accountability/filedCoreIncome.ts).
 *
 * Every forecast origin is FY t0 or later, so each outcome is a year the
 * panel's selection never saw. The years before t0 are used as history only:
 * they are known just for companies that lasted to t0, which a forecast made
 * at t0 knows too.
 *
 * Writes docs/generated/margin-reversion-panel.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { filedCoreOperatingIncome } from "../../src/engine/accountability/filedCoreIncome";
import {
  fadedMargin,
  marginReversionObservations,
  reversionShare,
  shareClosedAt,
  type MarginReversionObservation,
  type MarginSeries,
} from "../../src/engine/accountability/marginReversion";
import type { OperatingFigures } from "../../src/engine/filings/xbrlInstance";
import { VALUATION_SECTOR_TEMPLATES } from "../../src/engine/valuationSectorTemplates";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const DIR = join(ROOT, "data", "filings-panel");
type Years = Record<string, { figures: OperatingFigures }>;
const panel = JSON.parse(readFileSync(join(DIR, "panel.json"), "utf8")) as {
  t0: number;
  minRevenueCr: number;
  companies: { symbol: string; years: Years; followError?: string }[];
};
const history = JSON.parse(readFileSync(join(DIR, "history.json"), "utf8")) as {
  from: number;
  companies: { symbol: string; years: Years; unread?: number[]; notAYear?: number[] }[];
};
const registry: { ticker: string }[] = JSON.parse(readFileSync(join(ROOT, "public", "data", "companies", "registry.json"), "utf8"));
const corpus = new Set(registry.map((c) => c.ticker));

// The forecast's own limits on a margin (forecastDriverModel.ts, baseMarginStart).
const BOUNDS = [-0.5, 0.6] as const;
const WINDOW = 5;
const HORIZONS = [1, 2, 3] as const;
// The fade constants the forecast can take: a sector template's α (forecastDriverModel.ts).
const templateAlphas = Object.values(VALUATION_SECTOR_TEMPLATES).map((t) => t.marginFadeAlpha);
const ALPHA_SLOWEST = Math.max(...templateAlphas);
const ALPHA_FASTEST = Math.min(...templateAlphas);
const ALPHA_MID = (ALPHA_SLOWEST + ALPHA_FASTEST) / 2;
// Until November 2026 a persistence penalty of 0.03–0.12 came off the template's α.
const PENALIZED_SLOWEST = ALPHA_SLOWEST - 0.03;
const PENALIZED_FASTEST = ALPHA_FASTEST - 0.12;
const PENALIZED_MID = (PENALIZED_SLOWEST + PENALIZED_FASTEST) / 2;

const followed = panel.companies.filter((c) => !c.followError);
const earlier = new Map(history.companies.map((c) => [c.symbol, c.years]));
const latestYear = Math.max(...followed.flatMap((c) => Object.keys(c.years).map(Number)));
const origins = Array.from({ length: latestYear - panel.t0 }, (_, i) => panel.t0 + i);

/** A company's filed years, oldest first, as margins after tax and before it. */
function marginsOf(company: { symbol: string; years: Years }): { afterTax: MarginSeries; preTax: MarginSeries } {
  const years = Object.entries({ ...(earlier.get(company.symbol) ?? {}), ...company.years })
    .map(([year, v]) => ({ year: Number(year), figures: v.figures }))
    .sort((a, b) => a.year - b.year);
  const income = filedCoreOperatingIncome(years.map((y) => y.figures));
  const afterTax = years.flatMap((y, i) => (income[i] != null && y.figures.revenue! > 0 ? [{ year: y.year, margin: income[i]! / y.figures.revenue! }] : []));
  const preTax = years.flatMap((y) => {
    const { revenue, expenses, financeCosts } = y.figures;
    return revenue != null && revenue > 0 && expenses != null ? [{ year: y.year, margin: (revenue - (expenses - (financeCosts ?? 0))) / revenue }] : [];
  });
  return { afterTax: { companyId: company.symbol, points: afterTax }, preTax: { companyId: company.symbol, points: preTax } };
}
const margins = followed.map(marginsOf);
const afterTax = margins.map((m) => m.afterTax);
const preTax = margins.map((m) => m.preTax);

const observe = (series: readonly MarginSeries[], horizon: number, window: number, at: readonly number[] = origins, minYears = window) =>
  marginReversionObservations(series, { origins: at.filter((o) => o + horizon <= latestYear), horizon, window, minYears, bounds: BOUNDS });

// ── Statistics ──────────────────────────────────────────────────────────────
const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b);
const quantile = (values: readonly number[], q: number) => {
  const s = sorted(values);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN;
};
const mean = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const errors = (observations: readonly MarginReversionObservation[], share: number) =>
  observations.map((o) => Math.abs(o.outcome - fadedMargin(o, share)));
const companiesIn = (observations: readonly MarginReversionObservation[]) => new Set(observations.map((o) => o.companyId)).size;

/** mulberry32, seeded: the same intervals on every run. */
function seeded(): () => number {
  let seed = 20261110;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Firm-cluster bootstrap of the share: the spread across companies, not across years. */
function interval(observations: readonly MarginReversionObservation[], reps = 400): [number, number] | null {
  const byCompany = new Map<string, MarginReversionObservation[]>();
  for (const o of observations) (byCompany.get(o.companyId) ?? byCompany.set(o.companyId, []).get(o.companyId)!).push(o);
  const groups = [...byCompany.values()];
  if (groups.length < 10) return null;
  const random = seeded();
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) {
    const sample = Array.from({ length: groups.length }, () => groups[Math.floor(random() * groups.length)]!).flat();
    const share = reversionShare(sample);
    if (share != null) draws.push(share);
  }
  return draws.length ? [quantile(draws, 0.05), quantile(draws, 0.95)] : null;
}

// ── Formatting ──────────────────────────────────────────────────────────────
const points = (v: number) => (v * 100).toFixed(2);
const share = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const range = (ci: [number, number] | null) => (ci ? `${ci[0].toFixed(2)}–${ci[1].toFixed(2)}` : "—");
/** The fade constant that closes `s` of the gap in h years. */
const alphaFor = (s: number | null, horizon: number) => (s == null || s >= 1 ? "—" : s <= 0 ? "≥ 1" : ((1 - s) ** (1 / horizon)).toFixed(2));
const row = (cells: readonly (string | number)[]) => `| ${cells.join(" | ")} |`;

// ── 1. The share closed, by horizon ─────────────────────────────────────────
const main = HORIZONS.map((horizon) => ({ horizon, observations: observe(afterTax, horizon, WINDOW) }));
const shareTable = main.map(({ horizon, observations }) => {
  const fitted = reversionShare(observations);
  return row([
    horizon,
    origins.filter((o) => o + horizon <= latestYear).map((o) => `FY${o}`).join(", "),
    observations.length,
    companiesIn(observations),
    share(fitted),
    range(interval(observations)),
    alphaFor(fitted, horizon),
    `${shareClosedAt(ALPHA_SLOWEST, horizon).toFixed(2)}–${shareClosedAt(ALPHA_FASTEST, horizon).toFixed(2)}`,
  ]);
});

// ── 2. The error each fade leaves ───────────────────────────────────────────
const errorRow = (label: string, observations: readonly MarginReversionObservation[], s: number, walk: readonly number[]) => {
  const e = errors(observations, s);
  const closer = e.filter((v, i) => v < walk[i]!).length;
  const further = e.filter((v, i) => v > walk[i]!).length;
  return row([label, s.toFixed(2), points(quantile(e, 0.5)), points(mean(e)), s === 0 ? "—" : `${closer} / ${further}`]);
};
const errorTables = main.map(({ horizon, observations }) => {
  const walk = errors(observations, 0);
  const fitted = reversionShare(observations) ?? 0;
  return [
    `**${horizon} year${horizon === 1 ? "" : "s"} ahead** (${observations.length} forecasts)`,
    "",
    "| Forecast | Share of the gap closed | Median error | Mean error | Closer / further than no change |",
    "|---|---|---|---|---|",
    errorRow("No change from the latest year", observations, 0, walk),
    errorRow(`Shipped fade, slowest (α ${ALPHA_SLOWEST.toFixed(2)})`, observations, shareClosedAt(ALPHA_SLOWEST, horizon), walk),
    errorRow(`Shipped fade, middle (α ${ALPHA_MID.toFixed(2)})`, observations, shareClosedAt(ALPHA_MID, horizon), walk),
    errorRow(`Shipped fade, fastest (α ${ALPHA_FASTEST.toFixed(2)})`, observations, shareClosedAt(ALPHA_FASTEST, horizon), walk),
    errorRow(`With the persistence penalty, middle (α ${PENALIZED_MID.toFixed(2)})`, observations, shareClosedAt(PENALIZED_MID, horizon), walk),
    errorRow(`With the persistence penalty, fastest (α ${PENALIZED_FASTEST.toFixed(2)})`, observations, shareClosedAt(PENALIZED_FASTEST, horizon), walk),
    errorRow("Fitted to these forecasts", observations, fitted, walk),
    errorRow("All the way to the median", observations, 1, walk),
  ].join("\n");
});

// ── 3. Fitted on the first origin, tested on the later ones ─────────────────
const outOfSample = HORIZONS.flatMap((horizon) => {
  const fit = observe(afterTax, horizon, WINDOW, [panel.t0]);
  const test = observe(afterTax, horizon, WINDOW, origins.filter((o) => o > panel.t0));
  const fitted = reversionShare(fit);
  if (fitted == null || test.length === 0) return [];
  const median = (s: number) => points(quantile(errors(test, s), 0.5));
  const average = (s: number) => points(mean(errors(test, s)));
  return [row([
    horizon,
    fit.length,
    share(fitted),
    test.length,
    `${median(0)} / ${average(0)}`,
    `${median(shareClosedAt(ALPHA_MID, horizon))} / ${average(shareClosedAt(ALPHA_MID, horizon))}`,
    `${median(shareClosedAt(PENALIZED_MID, horizon))} / ${average(shareClosedAt(PENALIZED_MID, horizon))}`,
    `${median(fitted)} / ${average(fitted)}`,
  ])];
});

// ── 4. Which years the target is the median of ──────────────────────────────
// On the companies with the whole five-year window, so the windows differ only in the target.
const windowRows = HORIZONS.flatMap((horizon) => {
  const full = new Set(observe(afterTax, horizon, WINDOW).map((o) => `${o.companyId}:${o.origin}`));
  return [2, 3, WINDOW].map((window) => {
    const observations = observe(afterTax, horizon, window).filter((o) => full.has(`${o.companyId}:${o.origin}`));
    const fitted = reversionShare(observations);
    return row([
      horizon,
      `${window} years before`,
      observations.length,
      share(fitted),
      range(interval(observations)),
      points(quantile(errors(observations, 0), 0.5)),
      points(quantile(errors(observations, fitted ?? 0), 0.5)),
      points(mean(errors(observations, fitted ?? 0))),
    ]);
  });
});

// ── 5. One fade constant for every horizon ──────────────────────────────────
// The forecast has one α per company, not a share per horizon: the α whose
// fade leaves the least summed absolute error over every horizon's forecasts.
const ALPHA_GRID = Array.from({ length: 51 }, (_, i) => 0.5 + i * 0.01);
const summedError = (observations: readonly MarginReversionObservation[], alpha: number) =>
  observations.reduce((sum, o) => sum + Math.abs(o.outcome - fadedMargin(o, shareClosedAt(alpha, o.horizon))), 0);
function fittedAlpha(observations: readonly MarginReversionObservation[]): number {
  let best = ALPHA_GRID[0]!;
  let least = Infinity;
  for (const alpha of ALPHA_GRID) {
    const total = summedError(observations, alpha);
    if (total < least) [best, least] = [alpha, total];
  }
  return best;
}
function alphaInterval(observations: readonly MarginReversionObservation[], reps = 200): [number, number] | null {
  const byCompany = new Map<string, MarginReversionObservation[]>();
  for (const o of observations) (byCompany.get(o.companyId) ?? byCompany.set(o.companyId, []).get(o.companyId)!).push(o);
  const groups = [...byCompany.values()];
  if (groups.length < 10) return null;
  const random = seeded();
  const draws = Array.from({ length: reps }, () => fittedAlpha(Array.from({ length: groups.length }, () => groups[Math.floor(random() * groups.length)]!).flat()));
  return [quantile(draws, 0.05), quantile(draws, 0.95)];
}

const spreadOf = new Map(afterTax.map((s) => [s.companyId, new Map(s.points.map((p) => [p.year, p.margin]))]));
/** The standard deviation of the window's margins and the origin's: how much this margin moves. */
function spread(o: MarginReversionObservation): number {
  const byYear = spreadOf.get(o.companyId)!;
  const values = Array.from({ length: WINDOW + 1 }, (_, i) => byYear.get(o.origin - i)!).filter((v) => v != null);
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}
const pooled = main.flatMap((m) => m.observations);
const spreads = pooled.map(spread);
const [steady, variable] = [quantile(spreads, 1 / 3), quantile(spreads, 2 / 3)];
// The move every company shared that year, which no forecast at the cutoff knew.
const sharedMove = new Map<string, number>(main.flatMap(({ horizon, observations }) => origins.map((origin) =>
  [`${origin}:${horizon}`, quantile(observations.filter((o) => o.origin === origin).map((o) => o.outcome - o.latest), 0.5)] as const)));
const withoutSharedMove = pooled.map((o) => ({ ...o, outcome: o.outcome - sharedMove.get(`${o.origin}:${o.horizon}`)! }));
const everyYear = HORIZONS.flatMap((horizon) => observe(afterTax, horizon, latestYear - history.from, origins, 3));
const alphaRow = (label: string, observations: readonly MarginReversionObservation[]) => {
  if (observations.length === 0) return row([label, 0, 0, "—", "—", "—", "—", "—", "—"]);
  const alpha = fittedAlpha(observations);
  const per = (a: number) => points(summedError(observations, a) / observations.length);
  const ci = alphaInterval(observations);
  return row([
    label,
    observations.length,
    companiesIn(observations),
    alpha.toFixed(2),
    ci ? `${ci[0].toFixed(2)}–${ci[1].toFixed(2)}` : "—",
    per(alpha),
    per(ALPHA_MID),
    per(PENALIZED_MID),
    per(1),
  ]);
};
const alphaRows = [
  alphaRow("Every forecast", pooled),
  alphaRow("Latest margin above its median", pooled.filter((o) => o.latest > o.target)),
  alphaRow("Latest margin below its median", pooled.filter((o) => o.latest < o.target)),
  alphaRow("Steadiest third of margins", pooled.filter((_, i) => spreads[i]! <= steady)),
  alphaRow("Middle third", pooled.filter((_, i) => spreads[i]! > steady && spreads[i]! <= variable)),
  alphaRow("Most variable third", pooled.filter((_, i) => spreads[i]! > variable)),
  ...origins.map((origin) => alphaRow(`From FY${origin} alone`, pooled.filter((o) => o.origin === origin))),
  alphaRow("With each year's shared move taken out", withoutSharedMove),
  alphaRow("Above its median, shared move taken out", withoutSharedMove.filter((o) => o.latest > o.target)),
  alphaRow("Below its median, shared move taken out", withoutSharedMove.filter((o) => o.latest < o.target)),
  ...origins.flatMap((origin) => [
    alphaRow(`Above its median, from FY${origin}`, pooled.filter((o) => o.origin === origin && o.latest > o.target)),
    alphaRow(`Below its median, from FY${origin}`, pooled.filter((o) => o.origin === origin && o.latest < o.target)),
  ]),
  alphaRow("Margin before tax", HORIZONS.flatMap((horizon) => observe(preTax, horizon, WINDOW))),
  alphaRow("Target: median of every year filed before (three or more)", everyYear),
  alphaRow("The app's companies", pooled.filter((o) => corpus.has(o.companyId))),
];

const depth = (minYears: number) => afterTax.filter((s) => Array.from({ length: minYears }, (_, i) => panel.t0 - 1 - i).every((y) => s.points.some((p) => p.year === y))).length;
const unread = history.companies.filter((c) => c.unread?.length).length;
const quarters = history.companies.flatMap((c) => c.notAYear ?? []);
const unbounded = marginReversionObservations(afterTax, { origins: origins.filter((o) => o + 1 <= latestYear), horizon: 1, window: WINDOW }).length;

const doc = `# Reversion of the core operating margin, survivorship-free

> Generated by \`npm run accountability:margins\` from \`data/filings-panel/panel.json\` and \`data/filings-panel/history.json\`. Do not edit by hand.

## Why

The forecast starts the core operating margin at the latest year's and fades it toward the median of the years before, closing a share 1 − α^h of the gap by year h. α is a sector template's constant, ${ALPHA_FASTEST.toFixed(2)}–${ALPHA_SLOWEST.toFixed(2)}, set by hand. Until November 2026 a penalty for weak persistence (0.03–0.12) came off it, so the fade ran at ${PENALIZED_FASTEST.toFixed(2)}–${PENALIZED_SLOWEST.toFixed(2)}; this panel is why it no longer does. On the app's own companies the margin forecast barely beats "nothing changes" (\`docs/generated/frozen-forecast-scores.md\`), and that sample is too small to fit a fade on. This panel measures the share directly.

## The sample

- **Universe:** the persistence panel's (\`docs/generated/persistence-panel.md\`): every company that filed March ${panel.t0} results on NSE in the industrial format with revenue of at least ₹${panel.minRevenueCr.toLocaleString("en-IN")} Cr, chosen on that filing alone and followed through FY${latestYear}. ${followed.length} companies were followed.
- **History:** each company's income statement for FY${history.from}–FY${panel.t0 - 1}, as first filed, where its listing holds one (${unread} companies have a listed year that could not be read). ${quarters.length} years smaller than 1.5 times their own filing's quarter are left out, ${quarters.filter((y) => y === history.from).length} of them FY${history.from}, where some filings hold a quarter in the year's place; the rule also costs a few real years that are mostly one quarter (\`fetch-panel-history.ts\`). ${depth(WINDOW)} companies filed all ${WINDOW} of those years, ${depth(3)} the last three.
- **Margin:** core operating income after tax over revenue from operations, on the rules a frozen forecast is scored on (\`filedCoreIncome.ts\`): revenue less expenses other than finance costs, taxed as the recast taxes it. Other income and exceptional items are left out, as the filing's own totals leave them out.
- **Forecast origins:** FY${origins[0]}–FY${origins.at(-1)}. Each outcome is a year filed after the panel was chosen. A company that stopped filing has no outcome and drops out of that origin.
- **Target:** the median of the ${WINDOW} years before the origin year, every one of them filed. The app's own target is the median of every year before the latest, 10–15 years for most of its companies; this panel cannot test a window that long.
- **Left out:** a forecast whose margin at the origin, at the outcome or in the target lies outside ${BOUNDS[0] * 100}% to +${BOUNDS[1] * 100}%, the forecast's own limits (${unbounded - main[0]!.observations.length} of ${unbounded} one year ahead).

## The share of the gap closed

The least-absolute-deviations slope of the margin's move on its gap to the target (\`marginReversion.ts\`). The interval resamples companies; ${origins.length} origins share three years of one economy, which it cannot see.

| Years ahead | Origins | Forecasts | Companies | Share closed | 90% interval | As a fade constant α | Shipped fade closes |
|---|---|---|---|---|---|---|---|
${shareTable.join("\n")}

## The error each fade leaves

Absolute error in points of sales, on the same forecasts.

${errorTables.join("\n\n")}

## Fitted on the first origin, tested on the later ones

The share fitted on forecasts from FY${panel.t0} alone, applied to forecasts from later years. Errors are median / mean, in points of sales.

| Years ahead | Fitted on | Share | Tested on | No change | Shipped fade, middle | With the penalty, middle | Fitted share |
|---|---|---|---|---|---|---|---|
${outOfSample.join("\n")}

## Which years the target is the median of

On the forecasts with all ${WINDOW} earlier years, so the rows differ only in the target.

| Years ahead | Target: median of | Forecasts | Share closed | 90% interval | Median error, no change | Median error, fitted | Mean error, fitted |
|---|---|---|---|---|---|---|---|
${windowRows.join("\n")}

## One fade constant for every horizon

The forecast fades with one α at every horizon. This is the α that leaves the least summed absolute error over the forecasts at one, two and three years together (a search over ${ALPHA_GRID[0]!.toFixed(2)}–${ALPHA_GRID.at(-1)!.toFixed(2)}; 1.00 is no fade at all). Errors are the mean, in points of sales.

| Forecasts | Count | Companies | α | 90% interval | Error at that α | Error at the shipped middle (α ${ALPHA_MID.toFixed(2)}) | Error at the penalized middle (α ${PENALIZED_MID.toFixed(2)}) | Error with no fade |
|---|---|---|---|---|---|---|---|---|
${alphaRows.join("\n")}
`;
writeFileSync(join(ROOT, "docs", "generated", "margin-reversion-panel.md"), doc);
console.log(doc);
