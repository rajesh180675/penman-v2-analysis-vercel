/**
 * NSE's results listings and XBRL archive, as the filings fetchers read them.
 *
 * curl with a browser user agent is used because that is what was verified
 * to work against NSE (2026-09-25); api/market-data/snapshot.js notes NSE
 * blocks some server-side clients, so Node's fetch was not relied on.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
/**
 * NSE's site. It was www.nseindia.com until November 2026; on 2026-11-15 that
 * host answered every request with an empty 301 to this one, which curl does
 * not follow, so every listing read as empty. The listings here name the
 * archive on nsearchives.nseindia.in.
 */
export const NSE_SITE = "https://www.nseindia.in";
export const RESULTS_REFERER = `${NSE_SITE}/companies-listing/corporate-filings-financial-results`;
export const INTEGRATED_REFERER = `${NSE_SITE}/companies-listing/corporate-integrated-filing`;

export const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function curl(url: string, referer: string): string {
  return execFileSync("curl", ["-s", "--max-time", "60", "-A", UA, "-H", "Accept: application/json, text/xml, */*", "-H", `Referer: ${referer}`, url], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

export const isXbrl = (text: string) => text.includes("<xbrli:xbrl") || text.includes(":xbrl ");

export const isJson = (text: string) => /^\s*[[{]/.test(text);

/**
 * A GET cached on disk: listings and XBRL instances are fetched once, so an
 * interrupted run resumes. Null when the fetch fails or NSE's answer is not
 * what was asked for.
 */
export function cachedGet(
  file: string,
  url: string,
  referer: string,
  valid: (text: string) => boolean,
  options: { readonly delayMs: number; readonly log: (line: string) => void },
): string | null {
  if (existsSync(file)) return readFileSync(file, "utf8");
  sleep(options.delayMs);
  let text: string;
  try {
    text = curl(url, referer);
  } catch (error) {
    options.log(`fetch failed ${url} — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
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
  // Written whole or not at all: a run stopped mid-write must not leave a
  // truncated instance that every later run reads as cached.
  writeFileSync(`${file}.part`, text);
  renameSync(`${file}.part`, file);
  return text;
}

/** The file a filing is under in NSE's archive: the same on either host. */
export const archiveName = (url: string) => url.split("/").pop()!;

/**
 * The records a ledger already holds, by the archive name of the filing each
 * came from. A fetcher rewrites its whole ledger from the listing, so a filing
 * that cannot be read now (the archive throttles, or drops a file) took its
 * year out of the record. It keeps the record it had instead.
 */
export function recordsByArchiveName<T extends { readonly xbrlUrl: string }>(records: readonly T[]): Map<string, T> {
  return new Map(records.map((record) => [archiveName(record.xbrlUrl), record]));
}

/** A row of the annual results listing. */
export interface NseResultRow {
  symbol: string;
  isin?: string;
  companyName?: string;
  bank?: string;
  consolidated: string;
  audited: string;
  period: string;
  relatingTo: string;
  toDate: string;
  filingDate: string;
  broadCastDate: string | null;
  xbrl: string | null;
  indAs: string | null;
}

/** A row of the integrated-filing listing (March 2025 onward). */
export interface NseIntegratedRow {
  consolidated: string;
  audited: string;
  qe_Date: string;
  broadcast_Date: string | null;
  revised_Date: string | null;
  creation_Date: string;
  xbrl: string | null;
}

const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
/** "31-Mar-2024" → "2024-03-31"; "23-May-2024 17:03" → "2024-05-23T17:03"; the integrated listing's "31-MAR-2025" too. */
export function isoDate(nse: string): string {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}:\d{2}))?/.exec(nse.trim());
  if (!m) return nse;
  return `${m[3]}-${MONTHS[m[2]!.toUpperCase()]}-${m[1]}${m[4] ? `T${m[4]}` : ""}`;
}

/** One company's annual results filings, both listings, in one shape. */
export interface ListedFiling {
  fiscalYearEnd: string;
  filingDate: string;
  consolidated: boolean;
  audited: boolean;
  xbrl: string | null;
}

export function annualListingUrl(symbol: string): string {
  return `${NSE_SITE}/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(symbol)}&period=Annual`;
}

export function integratedListingUrl(symbol: string): string {
  return `${NSE_SITE}/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(symbol)}&type=Integrated%20Filing-%20Financials`;
}

/**
 * The annual listing's rows and the integrated listing's March quarters, whose
 * filings carry the full year in the same `FourD` context.
 */
export function listedFilings(rows: readonly NseResultRow[], integrated: readonly NseIntegratedRow[]): ListedFiling[] {
  return [
    ...rows.map((r) => ({
      fiscalYearEnd: isoDate(r.toDate),
      filingDate: isoDate(r.broadCastDate ?? r.filingDate),
      consolidated: r.consolidated === "Consolidated",
      audited: r.audited === "Audited",
      xbrl: r.xbrl,
    })),
    ...integrated.filter((r) => /-MAR-/i.test(r.qe_Date)).map((r) => ({
      fiscalYearEnd: isoDate(r.qe_Date),
      // A revision carries no broadcast date; it was filed when it was revised.
      filingDate: isoDate(r.broadcast_Date ?? r.revised_Date ?? r.creation_Date),
      consolidated: r.consolidated === "Consolidated",
      audited: r.audited === "Audited",
      xbrl: r.xbrl,
    })),
  ].filter((f) => f.xbrl && /\.xml$/i.test(f.xbrl));
}
