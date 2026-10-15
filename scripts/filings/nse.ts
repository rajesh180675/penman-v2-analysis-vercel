/**
 * NSE's results listings and XBRL archive, as the filings fetchers read them.
 *
 * curl with a browser user agent is used because that is what was verified
 * to work against NSE (2026-09-25); api/market-data/snapshot.js notes NSE
 * blocks some server-side clients, so Node's fetch was not relied on.
 */
import { execFileSync } from "node:child_process";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export const RESULTS_REFERER = "https://www.nseindia.com/companies-listing/corporate-filings-financial-results";
export const INTEGRATED_REFERER = "https://www.nseindia.com/companies-listing/corporate-integrated-filing";

export const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function curl(url: string, referer: string): string {
  return execFileSync("curl", ["-s", "--max-time", "60", "-A", UA, "-H", "Accept: application/json, text/xml, */*", "-H", `Referer: ${referer}`, url], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

export const isXbrl = (text: string) => text.includes("<xbrli:xbrl") || text.includes(":xbrl ");

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
  return `https://www.nseindia.com/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(symbol)}&period=Annual`;
}

export function integratedListingUrl(symbol: string): string {
  return `https://www.nseindia.com/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(symbol)}&type=Integrated%20Filing-%20Financials`;
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
