#!/usr/bin/env tsx
/**
 * tie-out.ts — compare every as-filed record under data/filings/ with the
 * Capitaline dataset the app analyses.
 *
 *   npx tsx scripts/filings/tie-out.ts [--year-to-date-only]
 *
 * Writes data/filings/tie-out.json, its browser copy
 * public/data/filings/tie-out.json (read by the Case's Evidence and Forecast sections), and
 * docs/generated/source-tieout.md.
 *
 * --year-to-date-only refreshes the year in progress from year-to-date.json
 * and keeps the last full run's comparison with Capitaline, which parses and
 * recasts every company and takes minutes. It refuses a company whose annual
 * ledger's first filings have changed since: that needs the full run.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCapitalineZip } from "../../src/engine/capitalineParser";
import { processCompanyDataFull } from "../../src/engine/pipeline";
import { DEFAULT_CONFIG, type RecastPeriod } from "../../src/engine/types";
import { TIE_OUT_FIELDS, tieOutAsFiled, type AsFiledHeadlineRecord, type TieOutRow } from "../../src/engine/filings";
import { firstFiledYears, firstFiledYearsToDate, type FiledYear, type FiledYearToDate } from "../../src/engine/accountability";
import type { AsFiledYearToDateRecord } from "./fetch-nse-year-to-date";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const FILINGS = join(ROOT, "data", "filings");
const registry: { folder: string; ticker: string; type: string }[] =
  JSON.parse(readFileSync(join(ROOT, "public", "data", "companies", "registry.json"), "utf-8"));

const results: {
  symbol: string;
  rows: TieOutRow[];
  firstFiling: string | null;
  /**
   * The latest fiscal year on file, by its first filing: what the Case compares
   * its own data's end with, and the shares in issue then, which the run sets
   * values against the price on when the quote reports none.
   */
  latestFiling: { fiscalYearEnd: string; filingDate: string; sharesOutstandingCr: number | null } | null;
  /** Each fiscal year as first filed: what the Case's forecast is set against once its years are filed. */
  filedYears: FiledYear[];
  /** The year in progress as first filed, quarter by quarter (fetch-nse-year-to-date.ts). */
  filedYearsToDate: FiledYearToDate[];
}[] = [];
const previous = process.argv.includes("--year-to-date-only")
  ? (JSON.parse(readFileSync(join(FILINGS, "tie-out.json"), "utf8")) as typeof results)
  : null;
for (const symbol of readdirSync(FILINGS).filter((d) => existsSync(join(FILINGS, d, "as-filed.json"))).sort()) {
  const company = registry.find((c) => c.ticker === symbol);
  if (!company) continue;
  const { records } = JSON.parse(readFileSync(join(FILINGS, symbol, "as-filed.json"), "utf8")) as { records: AsFiledHeadlineRecord[] };
  const kept = previous?.find((r) => r.symbol === symbol);
  if (previous && !kept) throw new Error(`${symbol} is not in the last tie-out: run it in full`);
  // A bank's, NBFC's or insurer's filings are on file for their share count;
  // the comparison is with the industrial recast, which does not describe them.
  const financial = company.type === "bank" || company.type === "nbfc" || company.type === "insurance";
  let periods: RecastPeriod[] = [];
  if (!financial && !kept) {
    const buf = readFileSync(join(ROOT, "public", "data", "companies", company.folder, `${company.folder}.zip`));
    const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: company.folder });
    periods = processCompanyDataFull(parsed.periods, { ...DEFAULT_CONFIG, company_type: company.type as typeof DEFAULT_CONFIG.company_type }).periods;
  }
  const yearToDatePath = join(FILINGS, symbol, "year-to-date.json");
  const yearToDate = existsSync(yearToDatePath)
    ? (JSON.parse(readFileSync(yearToDatePath, "utf8")) as { records: AsFiledYearToDateRecord[] }).records
    : [];
  const latestYear = records.reduce<string | null>((max, r) => (max == null || r.fiscalYearEnd > max ? r.fiscalYearEnd : max), null);
  const latestFirst = latestYear == null ? null : records
    .filter((r) => r.fiscalYearEnd === latestYear)
    .reduce((first, r) => (r.filingDate < first.filingDate ? r : first));
  const result = {
    symbol,
    rows: kept ? kept.rows : tieOutAsFiled(records, periods),
    firstFiling: records[0]?.filingDate ?? null,
    latestFiling: latestFirst
      ? { fiscalYearEnd: latestFirst.fiscalYearEnd, filingDate: latestFirst.filingDate, sharesOutstandingCr: latestFirst.headline.sharesOutstandingCr ?? null }
      : null,
    filedYears: firstFiledYears(records),
    filedYearsToDate: firstFiledYearsToDate(yearToDate, records),
  };
  const annual = (r: typeof result) => JSON.stringify([r.firstFiling, r.latestFiling, r.filedYears]);
  if (kept && annual(kept) !== annual(result)) throw new Error(`${symbol}'s annual filings changed since the last tie-out: run it in full`);
  results.push(result);
  console.log(`${symbol}: ${results.at(-1)!.rows.length} comparisons`);
}

writeFileSync(join(FILINGS, "tie-out.json"), JSON.stringify(results, null, 1) + "\n");
// The browser copy, read by the Case's Evidence and Forecast sections.
mkdirSync(join(ROOT, "public", "data", "filings"), { recursive: true });
writeFileSync(join(ROOT, "public", "data", "filings", "tie-out.json"), JSON.stringify(results, null, 1) + "\n");

const all = results.flatMap((r) => r.rows.map((row) => ({ ...row, symbol: r.symbol })));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fieldTable = TIE_OUT_FIELDS.map((field) => {
  const rows = all.filter((r) => r.field === field);
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  const median = rows.length ? [...rows.map((r) => Math.abs(r.relativeDifference))].sort((a, b) => a - b)[Math.floor(rows.length / 2)]! : 0;
  return `| ${field} | ${rows.length} | ${count("match")} | ${count("minor")} | ${count("mismatch")} | ${count("filing-inconsistent")} | ${pct(median)} |`;
}).join("\n");
const worst = [...all].filter((r) => r.status === "mismatch").sort((a, b) => Math.abs(b.relativeDifference) - Math.abs(a.relativeDifference)).slice(0, 25);

writeFileSync(join(ROOT, "docs", "generated", "source-tieout.md"), `# Source tie-out: Capitaline vs as-filed XBRL

Generated by \`scripts/filings/tie-out.ts\`. Do not edit by hand.

Each company's consolidated annual results as **first filed** on NSE (XBRL, fetched by \`scripts/filings/fetch-nse-annual.ts\`) against the Capitaline figure the app analyses for the same year-end. Capitaline serves the latest (possibly restated) figures, so a difference is a mapping error, a restatement, or a definitional mismatch. Match ≤ 0.5%, minor ≤ 2%. **Filing inconsistent** means the as-filed figure contradicts its own filing (e.g. PAT above 1.5× PBT), so it cannot arbitrate — Asian Paints' FY22 XBRL reports PAT of ₹9,167 Cr against PBT of ₹4,156 Cr, and Capitaline's ₹3,085 Cr is right. As-filed is a source to reconcile against, not an oracle. Revenue from operations is filed gross of excise duty and Capitaline's is net, so where a filing itemizes excise it is netted before comparing (ITC FY18: ₹47,689 Cr filed less ₹4,240 Cr excise = Capitaline's ₹43,449 Cr).

${results.filter((r) => r.rows.length).length} companies, ${all.length} comparisons. The ledger also holds the filings of ${results.filter((r) => !r.rows.length).length} financial institutions, for their share counts; the industrial recast does not describe them.

| Field | Compared | Match | Minor | Mismatch | Filing inconsistent | Median |difference| |
|---|---|---|---|---|---|---|
${fieldTable}

## Largest mismatches

Showing ${worst.length} of ${all.filter((r) => r.status === "mismatch").length} mismatches, largest first.

| Company | Year-end | Field | As filed (₹ Cr) | Capitaline (₹ Cr) | Difference |
|---|---|---|---|---|---|
${worst.map((r) => `| ${r.symbol} | ${r.fiscalYearEnd} | ${r.field}${r.netOf ? ` (net of ${r.netOf.label} ${r.netOf.value.toFixed(0)})` : ""} | ${r.asFiled.toFixed(0)} | ${r.capitaline.toFixed(0)} | ${pct(r.relativeDifference)} |`).join("\n")}
`);
console.log(`\n${all.length} comparisons across ${results.filter((r) => r.rows.length).length} companies.`);
