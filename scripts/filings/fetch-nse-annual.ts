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
 * curl with a browser user agent is used because that is what was verified
 * to work against NSE (2026-09-25); api/market-data/snapshot.js notes NSE
 * blocks some server-side clients, so Node's fetch was not relied on.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractAnnualHeadline, parseXbrlInstance, type AnnualContextMethod, type AnnualHeadline } from "../../src/engine/filings/xbrlInstance";

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
}

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
/** "31-Mar-2024" → "2024-03-31"; "23-May-2024 17:03" → "2024-05-23T17:03". */
function isoDate(nse: string): string {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}:\d{2}))?/.exec(nse.trim());
  if (!m) return nse;
  return `${m[3]}-${MONTHS[m[2]!]}-${m[1]}${m[4] ? `T${m[4]}` : ""}`;
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
  const withXbrl = rows.filter((r) => r.xbrl && /\.xml$/i.test(r.xbrl));
  // A company without subsidiaries (e.g. Nestlé India) files standalone only;
  // its standalone results ARE its group results.
  const hasConsolidated = withXbrl.some((r) => r.consolidated === "Consolidated");
  const consolidated = withXbrl.filter((r) => (hasConsolidated ? r.consolidated === "Consolidated" : true));
  const records: AsFiledRecord[] = [];
  for (const row of consolidated) {
    const file = join(rawDir, row.xbrl!.split("/").pop()!);
    if (!existsSync(file)) {
      sleep(delayMs);
      try {
        writeFileSync(file, curl(row.xbrl!, referer));
      } catch (error) {
        console.log(`${symbol} ${row.toDate}: download failed — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
        continue;
      }
    }
    const xml = readFileSync(file, "utf8");
    if (!xml.includes("<xbrli:xbrl") && !xml.includes(":xbrl ")) {
      console.log(`${symbol} ${row.toDate}: not an XBRL instance (blocked or moved); skipped`);
      continue;
    }
    const fiscalYearEnd = isoDate(row.toDate);
    const { headline, method } = extractAnnualHeadline(parseXbrlInstance(xml), fiscalYearEnd);
    records.push({
      fiscalYearEnd,
      filingDate: isoDate(row.broadCastDate ?? row.filingDate),
      consolidated: row.consolidated === "Consolidated",
      audited: row.audited === "Audited",
      xbrlUrl: row.xbrl!,
      extraction: method,
      headline,
    });
  }
  records.sort((a, b) => a.fiscalYearEnd.localeCompare(b.fiscalYearEnd) || a.filingDate.localeCompare(b.filingDate));
  writeFileSync(join(dir, "as-filed.json"), JSON.stringify({ symbol, source: "NSE corporates-financial-results (Annual, Consolidated)", records }, null, 1) + "\n");
  console.log(`${symbol}: ${records.length} consolidated annual filings (${records.filter((r) => r.extraction === "none").length} without a full-year context)`);
  sleep(delayMs);
}
