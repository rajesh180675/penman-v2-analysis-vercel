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
 */
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
import { annualListingUrl, curl, INTEGRATED_REFERER, integratedListingUrl, isXbrl, listedFilings, RESULTS_REFERER, sleep, type NseIntegratedRow, type NseResultRow } from "./nse";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const symbols = (arg("symbols") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const delayMs = Number(arg("delay-ms") ?? 1500);
if (!symbols.length) throw new Error("--symbols=ITC,TCS is required");

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

for (const symbol of symbols) {
  const dir = join(ROOT, "data", "filings", symbol);
  const rawDir = join(dir, "raw");
  mkdirSync(rawDir, { recursive: true });
  const referer = RESULTS_REFERER;
  let rows: NseResultRow[];
  try {
    rows = JSON.parse(curl(annualListingUrl(symbol), referer)) as NseResultRow[];
  } catch (error) {
    console.log(`${symbol}: listing failed — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    continue;
  }
  // The integrated listing is quarterly: its March-quarter filings are the
  // annual results. A failed listing loses only FY2025 onward, so it is
  // reported and the annual listing still stands.
  let integrated: NseIntegratedRow[] = [];
  try {
    sleep(delayMs);
    integrated = (JSON.parse(curl(integratedListingUrl(symbol), INTEGRATED_REFERER)) as { data?: NseIntegratedRow[] }).data ?? [];
  } catch (error) {
    console.log(`${symbol}: integrated listing failed — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  const filings = listedFilings(rows, integrated);
  // A company without subsidiaries (e.g. Nestlé India) files standalone only;
  // its standalone results ARE its group results.
  const hasConsolidated = filings.some((f) => f.consolidated);
  const consolidated = filings.filter((f) => (hasConsolidated ? f.consolidated : true));
  const records: AsFiledRecord[] = [];
  for (const filing of consolidated) {
    const file = join(rawDir, filing.xbrl!.split("/").pop()!);
    let xml: string;
    if (existsSync(file)) {
      xml = readFileSync(file, "utf8");
    } else {
      sleep(delayMs);
      try {
        xml = curl(filing.xbrl!, referer);
      } catch (error) {
        console.log(`${symbol} ${filing.fiscalYearEnd}: download failed — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
        continue;
      }
      // Cached only once it is an instance: an archive's HTML error page,
      // cached, was never fetched again (L&T's July 2025 revision).
      if (isXbrl(xml)) writeFileSync(file, xml);
    }
    if (!isXbrl(xml)) {
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
