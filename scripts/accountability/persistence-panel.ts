#!/usr/bin/env tsx
/**
 * persistence-panel.ts — how fast abnormal operating profitability fades in a
 * survivorship-free panel, beside the corpus estimate the app ships.
 *
 *   npm run accountability:panel
 *
 * Reads data/filings-panel/panel.json (scripts/filings/fetch-panel.ts): every
 * industrial company that filed FY t0 results above a revenue floor, followed
 * through each later year it filed. Core RNOA is measured from the filings
 * (src/engine/accountability/asFiledRnoa.ts) and the persistence estimator is
 * the one the corpus prior comes from (persistence.ts), deviations taken from
 * the WHOLE panel's median every time, so subsets differ only in who is in them.
 *
 * Writes docs/generated/persistence-panel.md.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimatePanelPersistence, type RnoaSeries } from "../../src/engine/accountability";
import { asFiledRnoaPoints } from "../../src/engine/accountability/asFiledRnoa";
import type { OperatingFigures } from "../../src/engine/filings/xbrlInstance";
import { PANEL_PERSISTENCE_PRIORS, PERSISTENCE_PRIORS_AS_OF } from "../../src/engine/selfConsistentValuation/persistencePriors.generated";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
interface PanelCompany {
  symbol: string;
  name: string | null;
  consolidated: boolean;
  years: Record<string, { filingDate: string; figures: OperatingFigures }>;
  followError?: string;
}
const panel = JSON.parse(readFileSync(join(ROOT, "data", "filings-panel", "panel.json"), "utf8")) as {
  t0: number;
  minRevenueCr: number;
  excludedAtT0: Record<string, number>;
  companies: PanelCompany[];
};
const registry: { ticker: string; type: string }[] = JSON.parse(readFileSync(join(ROOT, "public", "data", "companies", "registry.json"), "utf8"));
const corpus = new Set(registry.map((c) => c.ticker));

const followed = panel.companies.filter((c) => !c.followError);
const latestYear = Math.max(...followed.flatMap((c) => Object.keys(c.years).map(Number)));
const revenue = (c: PanelCompany, year: number) => c.years[String(year)]?.figures.revenue ?? null;
const series = new Map(followed.map((c) => [c.symbol, asFiledRnoaPoints(new Map(Object.entries(c.years).map(([y, v]) => [Number(y), v.figures])))]));
// Every company with a year of core RNOA is in that year's median, those that
// stopped filing after it among them; only those with two consecutive years add a pair.
const measured = followed.filter((c) => (series.get(c.symbol)?.length ?? 0) >= 1);
const survived = (c: PanelCompany) => c.years[String(latestYear)] != null;

/**
 * Rank by a year's revenue, largest first, among every company followed: a
 * rank among the measured alone would already favour those that kept filing.
 * Companies without that year rank last.
 */
const rankBy = (year: number) => new Map([...followed].sort((a, b) => (revenue(b, year) ?? -Infinity) - (revenue(a, year) ?? -Infinity)).map((c, i) => [c.symbol, i]));
const rankT0 = rankBy(panel.t0);
const rankLatest = rankBy(latestYear);

type Labeller = (c: PanelCompany) => string | null;
/** φ for each label, with deviations from the whole panel's yearly median (a null label stays in the median, outside every group). */
function estimateBy(label: Labeller) {
  const all: RnoaSeries[] = measured.map((c) => ({ companyId: c.symbol, group: label(c) ?? "(other)", points: series.get(c.symbol)! }));
  return estimatePanelPersistence(all);
}

/** Firm-cluster bootstrap of the pooled φ: the spread across companies, not across years. */
function bootstrap(label: Labeller, group: string, reps = 400): [number, number] | null {
  const members = measured.filter((c) => label(c) === group);
  if (members.length < 10) return null;
  // mulberry32, seeded: the same intervals on every run.
  let seed = 20261015;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const draws: number[] = [];
  const others = measured.filter((c) => label(c) !== group).map((c) => ({ companyId: c.symbol, group: "(other)", points: series.get(c.symbol)! }));
  for (let r = 0; r < reps; r++) {
    const sample: RnoaSeries[] = Array.from({ length: members.length }, (_, i) => {
      const c = members[Math.floor(random() * members.length)]!;
      return { companyId: `${c.symbol}#${i}`, group, points: series.get(c.symbol)! };
    });
    const est = estimatePanelPersistence([...sample, ...others]).find((e) => e.group === group);
    if (est) draws.push(est.phiUncapped);
  }
  draws.sort((a, b) => a - b);
  return draws.length ? [draws[Math.floor(draws.length * 0.05)]!, draws[Math.floor(draws.length * 0.95)]!] : null;
}

interface Row { label: string; group: string; labeller: Labeller }
const rows: Row[] = [
  { label: "Whole panel", group: "all", labeller: () => "panel" },
  { label: `Top 100 by FY${panel.t0} revenue (chosen when the panel starts)`, group: "top100-t0", labeller: (c) => (rankT0.get(c.symbol)! < 100 ? "top100-t0" : null) },
  { label: `Top 100 by FY${latestYear} revenue (chosen knowing who grew)`, group: "top100-latest", labeller: (c) => (rankLatest.get(c.symbol)! < 100 && revenue(c, latestYear) != null ? "top100-latest" : null) },
  { label: `Ranked 101–300 by FY${panel.t0} revenue`, group: "mid-t0", labeller: (c) => (rankT0.get(c.symbol)! >= 100 && rankT0.get(c.symbol)! < 300 ? "mid-t0" : null) },
  { label: `Ranked below 300 by FY${panel.t0} revenue`, group: "small-t0", labeller: (c) => (rankT0.get(c.symbol)! >= 300 ? "small-t0" : null) },
  { label: `Filed FY${latestYear} (survivors)`, group: "survivors", labeller: (c) => (survived(c) ? "survivors" : null) },
  { label: "The app's companies, as filed", group: "corpus", labeller: (c) => (corpus.has(c.symbol) ? "corpus" : null) },
];
/** The whole panel on one year-pair at a time: how much φ moves with the year, which the bootstrap cannot see. */
function byYearPair(from: number) {
  const all: RnoaSeries[] = measured.map((c) => ({ companyId: c.symbol, group: "panel", points: series.get(c.symbol)!.filter((p) => p.year === from || p.year === from + 1) }));
  return estimatePanelPersistence(all).find((e) => e.group === "all");
}
const results = rows.map((row) => {
  const est = row.group === "all" ? estimateBy(row.labeller).find((e) => e.group === "all") : estimateBy(row.labeller).find((e) => e.group === row.group);
  return { ...row, est, ci: est ? bootstrap(row.group === "all" ? () => "panel" : row.labeller, row.group === "all" ? "panel" : row.group) : null };
});

// The filed measure against the app's Capitaline core RNOA, where both exist.
const gaps: { symbol: string; year: number; filed: number; capitaline: number }[] = [];
for (const c of followed.filter((c) => corpus.has(c.symbol))) {
  const run = join(ROOT, "accountability", "runs", `${c.symbol}.json`);
  if (!existsSync(run)) continue;
  const capitaline = new Map((JSON.parse(readFileSync(run, "utf8")).rnoaPoints ?? []).map((p: { year: number; rnoa: number }) => [p.year, p.rnoa]));
  for (const p of series.get(c.symbol) ?? []) {
    const value = capitaline.get(p.year) as number | undefined;
    if (value != null) gaps.push({ symbol: c.symbol, year: p.year, filed: p.rnoa, capitaline: value });
  }
}
const quantile = (values: number[], q: number) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN;
};
const gapValues = gaps.map((g) => g.filed - g.capitaline);

const exits = measured.filter((c) => !survived(c));
const pct = (v: number) => `${(v * 100).toFixed(1)}`;
const phi = (v: number | undefined) => (v == null ? "—" : v.toFixed(2));
const years = [...new Set([...series.values()].flatMap((points) => points.map((p) => p.year)))].sort();
const pairsPerYear = years.slice(1).map((y) => `${y - 1}→${y}`).join(", ");

const doc = `# Persistence of operating profitability, survivorship-free

> Generated by \`npm run accountability:panel\` from \`data/filings-panel/panel.json\` (\`scripts/filings/fetch-panel.ts\`). Do not edit by hand.

## Why

The persistence prior the self-consistent model shows (\`persistencePriors.generated.ts\`, φ = ${PANEL_PERSISTENCE_PRIORS.all!.phi.toFixed(2)} over ${PANEL_PERSISTENCE_PRIORS.all!.companies} companies, as of ${PERSISTENCE_PRIORS_AS_OF}) is estimated on the app's own companies: today's large caps, selected because their returns persisted. This panel is chosen on what was known at its start and keeps every company for the years it filed.

## The panel

- **Universe:** every company that filed annual results for March ${panel.t0} on NSE in the industrial format, with revenue from operations of at least ₹${panel.minRevenueCr.toLocaleString("en-IN")} Cr in that filing (consolidated where it files consolidated results). Left out at the start: ${Object.entries(panel.excludedAtT0).map(([k, v]) => `${v} ${k}`).join(", ")}.
- **Followed:** ${panel.companies.length} companies; ${panel.companies.length - followed.length} whose later listings or filings could not be read are set aside (not counted as having stopped). ${measured.length} have core RNOA for at least one year, and each year's median is taken over all of them; ${results[0]!.est?.companies ?? 0} have two consecutive years and so add a year-pair.
- **Stopped filing before FY${latestYear}:** ${exits.length} of the ${measured.length} (merged, delisted or late); they stay in for the years they filed.
- **Measure:** core RNOA on opening NOA, from the filings as first reported (\`asFiledRnoa.ts\`). Results filings carry a balance sheet only from FY2023, so FY${panel.t0} is the earliest start and the panel's year-pairs are ${pairsPerYear}.

## Persistence (pooled AR(1) of the deviation from the panel's yearly median)

| Companies | φ | 90% interval (firm bootstrap) | Year-pairs | Companies measured |
|---|---|---|---|---|
${results.map((r) => `| ${r.label} | ${phi(r.est?.phiUncapped)} | ${r.ci ? `${r.ci[0].toFixed(2)}–${r.ci[1].toFixed(2)}` : "—"} | ${r.est?.pairs ?? "—"} | ${r.est?.companies ?? "—"} |`).join("\n")}
| *Reference: the shipped prior, the app's companies on Capitaline, all years* | *${PANEL_PERSISTENCE_PRIORS.all!.phi.toFixed(2)}* | | *${PANEL_PERSISTENCE_PRIORS.all!.pairs}* | *${PANEL_PERSISTENCE_PRIORS.all!.companies}* |

One year-pair at a time, the whole panel:

| Year-pair | φ | Companies |
|---|---|---|
${years.slice(0, -1).map((y) => { const e = byYearPair(y); return `| ${y}→${y + 1} | ${phi(e?.phiUncapped)} | ${e?.companies ?? "—"} |`; }).join("\n")}

φ is the pooled slope before the 0.98 cap the shipped prior applies for use as a fade rate. The interval resamples companies, not years: ${years.length - 1} year-pairs share their economy, so it understates the uncertainty that matters most (\`docs/generated/scenario-band-coverage.md\`).

## The filed measure against the app's

${gaps.length
  ? `Where a company is in both, core RNOA from the filings less the app's Capitaline core RNOA, ${gaps.length} company-years: median ${pct(quantile(gapValues, 0.5))} points, interquartile range ${pct(quantile(gapValues, 0.25))} to ${pct(quantile(gapValues, 0.75))}. Widest: ${[...gaps].sort((a, b) => Math.abs(b.filed - b.capitaline) - Math.abs(a.filed - a.capitaline)).slice(0, 4).map((g) => `${g.symbol} FY${g.year} (${pct(g.filed)} vs ${pct(g.capitaline)})`).join(", ")}.`
  : "Not compared: the app's core RNOA by year comes from `accountability/runs/` (`npm run accountability`), which is not on disk."}
`;
writeFileSync(join(ROOT, "docs", "generated", "persistence-panel.md"), doc);
console.log(doc);
