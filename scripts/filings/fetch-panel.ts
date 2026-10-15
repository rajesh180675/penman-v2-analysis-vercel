#!/usr/bin/env tsx
/**
 * fetch-panel.ts — a survivorship-free panel of industrial companies' as-filed
 * operating figures, for the persistence estimate.
 *
 *   npx tsx scripts/filings/fetch-panel.ts [--t0=2023] [--min-revenue-cr=500] [--delay-ms=1500]
 *
 * The universe is fixed on what was known at t0: every company that filed
 * annual results for the March t0 year on NSE (listings from April t0 to March
 * t0+1, so late filers count), in the industrial format, with revenue from operations
 * of at least the floor in that filing. Each is then followed through every
 * later March year it filed, so a company that stopped filing stays in the
 * panel for the years it did; a company whose listings could not be read is
 * marked, so it is not mistaken for one that stopped. t0 defaults to FY2023, the first year results
 * filings carry a balance sheet.
 *
 * Out of the universe at t0: banks (NSE's bank flag), lenders filing in the
 * Division III format (`NBFC_INDAS_`), other formats, and industrial-format
 * filers whose loans given exceed half their assets (lenders in all but format).
 *
 * Writes data/filings-panel/panel.json. Listings and XBRL instances are cached
 * under data/filings-panel/raw/ (git-ignored), so an interrupted run resumes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractOperatingFigures, parseXbrlInstance, type OperatingFigures } from "../../src/engine/filings/xbrlInstance";
import {
  annualListingUrl,
  curl,
  INTEGRATED_REFERER,
  integratedListingUrl,
  isoDate,
  isXbrl,
  listedFilings,
  RESULTS_REFERER,
  sleep,
  type ListedFiling,
  type NseIntegratedRow,
  type NseResultRow,
} from "./nse";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const t0 = Number(arg("t0") ?? 2023);
const minRevenueCr = Number(arg("min-revenue-cr") ?? 500);
const delayMs = Number(arg("delay-ms") ?? 1500);
const DIR = join(ROOT, "data", "filings-panel");
const RAW = join(DIR, "raw");
mkdirSync(join(RAW, "listings"), { recursive: true });
mkdirSync(join(RAW, "xbrl"), { recursive: true });

const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);

/** A cached GET: JSON listings and XBRL instances are fetched once. */
function cached(file: string, url: string, referer: string, valid: (text: string) => boolean): string | null {
  if (existsSync(file)) return readFileSync(file, "utf8");
  sleep(delayMs);
  let text: string;
  try {
    text = curl(url, referer);
  } catch (error) {
    log(`fetch failed ${url} — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return null;
  }
  if (!valid(text)) {
    // NSE answers a throttled client with an HTML page: wait and try once more.
    sleep(30_000);
    try {
      text = curl(url, referer);
    } catch {
      return null;
    }
    if (!valid(text)) return null;
  }
  writeFileSync(file, text);
  return text;
}
const isJson = (text: string) => /^\s*[[{]/.test(text);

function figuresOf(filing: { xbrl: string | null; fiscalYearEnd: string }): OperatingFigures | null {
  const name = filing.xbrl!.split("/").pop()!;
  const xml = cached(join(RAW, "xbrl", name), filing.xbrl!, RESULTS_REFERER, isXbrl);
  return xml ? extractOperatingFigures(parseXbrlInstance(xml), filing.fiscalYearEnd) : null;
}

// ── The universe at t0 ──────────────────────────────────────────────────────
const fyEnd = `${t0}-03-31`;
const pad = (n: number) => String(n).padStart(2, "0");
const rows: NseResultRow[] = [];
for (let offset = 0; offset < 12; offset++) {
  const year = t0 + Math.floor((offset + 3) / 12);
  const month = ((offset + 3) % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const from = `01-${pad(month)}-${year}`;
  const to = `${last}-${pad(month)}-${year}`;
  const url = `https://www.nseindia.com/api/corporates-financial-results?index=equities&period=Annual&from_date=${from}&to_date=${to}&fo_sec=false`;
  const text = cached(join(RAW, "listings", `annual-${year}-${pad(month)}.json`), url, RESULTS_REFERER, isJson);
  if (text == null) throw new Error(`The ${from}–${to} listing could not be read; the universe would be incomplete.`);
  rows.push(...(JSON.parse(text) as NseResultRow[]));
}
const ofYear = rows.filter((r) => isoDate(r.toDate) === fyEnd && r.xbrl && /\.xml$/i.test(r.xbrl));
const excluded = { bank: 0, lenderFormat: 0, otherFormat: 0, noFiling: 0, noBalanceSheet: 0, belowFloor: 0, lenderByLoans: 0 };
const bySymbol = new Map<string, NseResultRow[]>();
for (const row of ofYear) (bySymbol.get(row.symbol) ?? bySymbol.set(row.symbol, []).get(row.symbol)!).push(row);
log(`${bySymbol.size} companies filed ${fyEnd} annual results with an XBRL instance`);

interface PanelYear {
  filingDate: string;
  xbrlUrl: string;
  figures: OperatingFigures;
}
interface PanelCompany {
  symbol: string;
  isin: string | null;
  name: string | null;
  consolidated: boolean;
  years: Record<string, PanelYear>;
  /** Why the later years could not all be read, when they could not: such a company has not been shown to stop filing. */
  followError?: string;
}
const universe: PanelCompany[] = [];
for (const [symbol, filings] of [...bySymbol].sort(([a], [b]) => a.localeCompare(b))) {
  const sample = filings[0]!;
  const format = sample.xbrl!.split("/").pop()!;
  if (sample.bank !== "N") { excluded.bank++; continue; }
  if (/NBFC_INDAS/i.test(format)) { excluded.lenderFormat++; continue; }
  if (!/^INDAS_\d/i.test(format)) { excluded.otherFormat++; continue; }
  // The group's results where it files them; the original filing, not a revision.
  const consolidated = filings.some((f) => f.consolidated === "Consolidated");
  const filing = filings
    .filter((f) => (f.consolidated === "Consolidated") === consolidated && /^INDAS_\d/i.test(f.xbrl!.split("/").pop()!))
    .sort((a, b) => isoDate(a.broadCastDate ?? a.filingDate).localeCompare(isoDate(b.broadCastDate ?? b.filingDate)))[0];
  if (!filing) { excluded.otherFormat++; continue; }
  const figures = figuresOf({ xbrl: filing.xbrl, fiscalYearEnd: fyEnd });
  if (!figures) { excluded.noFiling++; continue; }
  if (figures.assets == null || figures.equity == null) { excluded.noBalanceSheet++; continue; }
  if (!(figures.revenue != null && figures.revenue >= minRevenueCr)) { excluded.belowFloor++; continue; }
  if ((figures.loans ?? 0) > 0.5 * figures.assets) { excluded.lenderByLoans++; continue; }
  universe.push({
    symbol,
    isin: sample.isin ?? null,
    name: sample.companyName ?? null,
    consolidated,
    years: { [String(t0)]: { filingDate: isoDate(filing.broadCastDate ?? filing.filingDate), xbrlUrl: filing.xbrl!, figures } },
  });
}
log(`universe: ${universe.length} companies; excluded ${JSON.stringify(excluded)}`);

// ── Every later year each company filed ─────────────────────────────────────
const header = {
  t0,
  minRevenueCr,
  source: "NSE corporates-financial-results (Annual) and integrated-filing-results (March quarter); figures as first filed",
  excludedAtT0: excluded,
};
// One company per line, so a refetch diffs by company.
const write = () => writeFileSync(join(DIR, "panel.json"), [
  "{",
  ...Object.entries(header).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
  ' "companies": [',
  universe.map((c) => `  ${JSON.stringify(c)}`).join(",\n"),
  " ]",
  "}",
  "",
].join("\n"));
for (const [index, company] of universe.entries()) {
  const key = encodeURIComponent(company.symbol);
  const annual = cached(join(RAW, "listings", `${key}-annual.json`), annualListingUrl(company.symbol), RESULTS_REFERER, isJson);
  const integrated = cached(join(RAW, "listings", `${key}-integrated.json`), integratedListingUrl(company.symbol), INTEGRATED_REFERER, isJson);
  if (annual == null || integrated == null) company.followError = `${annual == null ? "annual" : "integrated"} listing unreadable`;
  const filings: ListedFiling[] = listedFilings(
    annual ? (JSON.parse(annual) as NseResultRow[]) : [],
    integrated ? ((JSON.parse(integrated) as { data?: NseIntegratedRow[] }).data ?? []) : [],
  );
  // Each later March year on the basis it was selected on, as first filed.
  for (const year of [...new Set(filings.map((f) => Number(f.fiscalYearEnd.slice(0, 4))))].filter((y) => y > t0).sort()) {
    const first = filings
      .filter((f) => f.fiscalYearEnd === `${year}-03-31` && f.consolidated === company.consolidated && !/NBFC_INDAS/i.test(f.xbrl!.split("/").pop()!))
      .sort((a, b) => a.filingDate.localeCompare(b.filingDate))[0];
    if (!first) continue;
    const figures = figuresOf(first);
    if (figures) company.years[String(year)] = { filingDate: first.filingDate, xbrlUrl: first.xbrl!, figures };
    else company.followError = `FY${year} filing unreadable`;
  }
  if ((index + 1) % 25 === 0) {
    log(`${index + 1}/${universe.length} followed`);
    write();
  }
}
write();
log(`wrote data/filings-panel/panel.json: ${universe.length} companies`);
