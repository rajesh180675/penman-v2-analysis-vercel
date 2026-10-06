#!/usr/bin/env tsx
/**
 * fetch-nse-annual.ts — as-filed annual results from NSE, point-in-time.
 *
 *   npx tsx scripts/filings/fetch-nse-annual.ts --symbols=ITC,TCS [--delay-ms=1500]
 *
 * For each symbol: list NSE's annual financial-result filings, download each
 * consolidated XBRL instance (raw XML cached under data/filings/<SYMBOL>/raw/,
 * git-ignored), extract the full-year headline figures, and write
 * data/filings/<SYMBOL>/as-filed.json keyed by FILING DATE — the first
 * point-in-time record in this repo: what was reported, and when.
 *
 * Results for March 2025 onward are filed as "Integrated Filing - Financials",
 * a quarterly listing on its own endpoint; its March-quarter filings carry the
 * full year in the same `FourD` context. A lender's filing (Division III)
 * also yields its closing balance-sheet subtotals.
 *
 * curl with a browser user agent is used because that is what was verified
 * to work against NSE (2026-09-25); api/market-data/snapshot.js notes NSE
 * blocks some server-side clients, so Node's fetch was not relied on.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractAnnualHeadline,
  extractLenderBalanceSheet,
  parseXbrlInstance,
  type AnnualContextMethod,
  type AnnualHeadline,
  type LenderBalanceSheet,
} from "../../src/engine/filings/xbrlInstance";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const symbols = (arg("symbols") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const delayMs = Number(arg("delay-ms") ?? 1500);
if (!symbols.length) throw new Error("--symbols=ITC,TCS is required");

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function curl(url: string, referer: string): string {
  return execFileSync("curl", ["-s", "--max-time", "60", "-A", UA, "-H", "Accept: application/json, text/xml, */*", "-H", `Referer: ${referer}`, url], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

interface NseResultRow {
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

export interface AsFiledRecord {
  fiscalYearEnd: string;
  filingDate: string;
  consolidated: boolean;
  audited: boolean;
  xbrlUrl: string;
  extraction: AnnualContextMethod;
  /** ₹ crore, as reported in that filing. */
  headline: AnnualHeadline;
  /** A lender's closing balance-sheet subtotals (₹ crore), when the filing is in that format. */
  lenderBalanceSheet?: LenderBalanceSheet;
}

/** A row of the integrated-filing listing (March 2025 onward). */
interface NseIntegratedRow {
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
function isoDate(nse: string): string {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}:\d{2}))?/.exec(nse.trim());
  if (!m) return nse;
  return `${m[3]}-${MONTHS[m[2]!.toUpperCase()]}-${m[1]}${m[4] ? `T${m[4]}` : ""}`;
}

for (const symbol of symbols) {
  const dir = join(ROOT, "data", "filings", symbol);
  const rawDir = join(dir, "raw");
  mkdirSync(rawDir, { recursive: true });
  const listUrl = `https://www.nseindia.com/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(symbol)}&period=Annual`;
  const referer = "https://www.nseindia.com/companies-listing/corporate-filings-financial-results";
  let rows: NseResultRow[];
  try {
    rows = JSON.parse(curl(listUrl, referer)) as NseResultRow[];
  } catch (error) {
    console.log(`${symbol}: listing failed — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    continue;
  }
  // The integrated listing is quarterly: its March-quarter filings are the
  // annual results. A failed listing loses only FY2025 onward, so it is
  // reported and the annual listing still stands.
  const integratedUrl = `https://www.nseindia.com/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(symbol)}&type=Integrated%20Filing-%20Financials`;
  let integrated: NseIntegratedRow[] = [];
  try {
    sleep(delayMs);
    integrated = (JSON.parse(curl(integratedUrl, "https://www.nseindia.com/companies-listing/corporate-integrated-filing")) as { data?: NseIntegratedRow[] }).data ?? [];
  } catch (error) {
    console.log(`${symbol}: integrated listing failed — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  const filings = [
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
  // A company without subsidiaries (e.g. Nestlé India) files standalone only;
  // its standalone results ARE its group results.
  const hasConsolidated = filings.some((f) => f.consolidated);
  const consolidated = filings.filter((f) => (hasConsolidated ? f.consolidated : true));
  const records: AsFiledRecord[] = [];
  for (const filing of consolidated) {
    const file = join(rawDir, filing.xbrl!.split("/").pop()!);
    if (!existsSync(file)) {
      sleep(delayMs);
      try {
        writeFileSync(file, curl(filing.xbrl!, referer));
      } catch (error) {
        console.log(`${symbol} ${filing.fiscalYearEnd}: download failed — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
        continue;
      }
    }
    const xml = readFileSync(file, "utf8");
    if (!xml.includes("<xbrli:xbrl") && !xml.includes(":xbrl ")) {
      console.log(`${symbol} ${filing.fiscalYearEnd}: not an XBRL instance (blocked or moved); skipped`);
      continue;
    }
    const instance = parseXbrlInstance(xml);
    const { headline, method } = extractAnnualHeadline(instance, filing.fiscalYearEnd);
    const lenderBalanceSheet = extractLenderBalanceSheet(instance, filing.fiscalYearEnd);
    records.push({
      fiscalYearEnd: filing.fiscalYearEnd,
      filingDate: filing.filingDate,
      consolidated: filing.consolidated,
      audited: filing.audited,
      xbrlUrl: filing.xbrl!,
      extraction: method,
      headline,
      ...(lenderBalanceSheet ? { lenderBalanceSheet } : {}),
    });
  }
  records.sort((a, b) => a.fiscalYearEnd.localeCompare(b.fiscalYearEnd) || a.filingDate.localeCompare(b.filingDate));
  writeFileSync(join(dir, "as-filed.json"), JSON.stringify({ symbol, source: "NSE corporates-financial-results (Annual) and integrated-filing-results (March quarter), Consolidated", records }, null, 1) + "\n");
  console.log(`${symbol}: ${records.length} consolidated annual filings (${records.filter((r) => r.extraction === "none").length} without a full-year context)`);
  sleep(delayMs);
}
