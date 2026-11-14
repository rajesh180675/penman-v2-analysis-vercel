#!/usr/bin/env tsx
/**
 * fetch-panel-history.ts — the panel companies' income statements for the
 * years before the panel starts, for the margin estimate.
 *
 *   npx tsx scripts/filings/fetch-panel-history.ts [--from=2018] [--delay-ms=1500]
 *
 * The panel (fetch-panel.ts, data/filings-panel/panel.json) starts at FY t0,
 * the first year results filings carry a balance sheet. Their income statement
 * goes back further, and a margin needs nothing else. For each panel company
 * this reads every March year from --from to t0 − 1 that its annual listing
 * holds, on the basis the panel follows it on and as first filed.
 *
 * These years are history for a forecast made at t0 or later, never an
 * outcome: the companies were chosen at t0, so a year before it is known only
 * for those that lasted to t0.
 *
 * None of these filings declares its contexts, so the year is read by the ID
 * convention (`FourD`), and some March 2018 filings hold another quarter
 * there. A year whose revenue is under 1.5 times the same filing's quarter is
 * left out and listed (`notAYear`). Across the panel (2026-11-15) that is 68
 * of the 385 March 2018 filings that report a quarter, and of the 59 with
 * FY2019 filed, 52 read under 0.4 of FY2019's revenue. It is also 19 of the
 * 2,949 for FY2019–FY2022, and there the rule costs real years: 9 of the 18
 * with a next year read 0.6 or more of it, six of them a year whose fourth
 * quarter is most of it (S Chand's in three years, Godrej Properties' FY2022,
 * Ganesh Housing's FY2019, Peninsula Land's FY2020). Two March 2018 filings
 * between 1.5 and 2 read as quarters against FY2019 and stay in (Bliss GVS,
 * Uttam Sugar). A filing that reports no quarter cannot be checked this way
 * (237 for FY2018, 185 for FY2019): of the 318 with a next year, 304 read
 * 0.6–1.5 of its revenue and none under 0.2.
 *
 * A listed year that cannot be read is listed too (`unread`). On 2026-11-15
 * that was 65 years, each a 404 from the archive: 64 are the consolidated half
 * of a May 2019 filing (`…_WEB_2.xml`). The standalone half (`…_WEB.xml`) is
 * there, and is no substitute for a company followed on consolidated figures.
 *
 * Writes data/filings-panel/history.json. It reads the listings fetch-panel.ts
 * cached and caches each XBRL instance beside the panel's (git-ignored), so an
 * interrupted run resumes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractOperatingFigures, parseXbrlInstance, quarterShareOfYear, type OperatingFigures } from "../../src/engine/filings/xbrlInstance";
import { cachedGet, isXbrl, listedFilings, RESULTS_REFERER, type NseResultRow } from "./nse";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const from = Number(arg("from") ?? 2018);
const delayMs = Number(arg("delay-ms") ?? 1500);
/** A year is at least this many times the quarter its own filing reports. */
const MIN_YEAR_TO_QUARTER = 1.5;
const DIR = join(ROOT, "data", "filings-panel");
const RAW = join(DIR, "raw");
mkdirSync(join(RAW, "xbrl"), { recursive: true });

const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);

const panel = JSON.parse(readFileSync(join(DIR, "panel.json"), "utf8")) as {
  t0: number;
  companies: { symbol: string; consolidated: boolean }[];
};

interface HistoryYear {
  filingDate: string;
  xbrlUrl: string;
  figures: OperatingFigures;
}
interface HistoryCompany {
  symbol: string;
  years: Record<string, HistoryYear>;
  /** Years the listing holds whose filing could not be read: not shown to be missing. */
  unread?: number[];
  /** Years whose filing holds a quarter where the year should be. */
  notAYear?: number[];
}

const history: HistoryCompany[] = [];
// One company per line, so a refetch diffs by company.
const write = () => writeFileSync(join(DIR, "history.json"), [
  "{",
  ` "from": ${from},`,
  ` "before": ${panel.t0},`,
  ' "source": "NSE corporates-financial-results (Annual); income statement as first filed",',
  ' "companies": [',
  history.map((c) => `  ${JSON.stringify(c)}`).join(",\n"),
  " ]",
  "}",
  "",
].join("\n"));

let fetched = 0;
for (const [index, company] of panel.companies.entries()) {
  const listing = join(RAW, "listings", `${encodeURIComponent(company.symbol)}-annual.json`);
  const entry: HistoryCompany = { symbol: company.symbol, years: {} };
  const filings = existsSync(listing) ? listedFilings(JSON.parse(readFileSync(listing, "utf8")) as NseResultRow[], []) : [];
  for (let year = from; year < panel.t0; year++) {
    const first = filings
      .filter((f) => f.fiscalYearEnd === `${year}-03-31` && f.consolidated === company.consolidated && /^INDAS_\d/i.test(f.xbrl!.split("/").pop()!))
      .sort((a, b) => a.filingDate.localeCompare(b.filingDate))[0];
    if (!first) continue;
    const file = join(RAW, "xbrl", first.xbrl!.split("/").pop()!);
    if (!existsSync(file)) fetched++;
    const xml = cachedGet(file, first.xbrl!, RESULTS_REFERER, isXbrl, { delayMs, log });
    if (!xml) {
      (entry.unread ??= []).push(year);
      continue;
    }
    const instance = parseXbrlInstance(xml);
    const quarterShare = quarterShareOfYear(instance, first.fiscalYearEnd);
    if (quarterShare != null && quarterShare * MIN_YEAR_TO_QUARTER > 1) {
      (entry.notAYear ??= []).push(year);
      continue;
    }
    entry.years[String(year)] = { filingDate: first.filingDate, xbrlUrl: first.xbrl!, figures: extractOperatingFigures(instance, first.fiscalYearEnd) };
  }
  history.push(entry);
  if ((index + 1) % 25 === 0) {
    log(`${index + 1}/${panel.companies.length} companies, ${fetched} instances fetched`);
    write();
  }
}
write();
const years = history.flatMap((c) => Object.keys(c.years));
log(`wrote data/filings-panel/history.json: ${history.length} companies, ${years.length} company-years, ${history.filter((c) => c.unread).length} with an unread year, ${history.flatMap((c) => c.notAYear ?? []).length} years left out as quarters`);
