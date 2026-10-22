#!/usr/bin/env tsx
/**
 * fetch-nse-year-to-date.ts — as-filed results for the year so far, from NSE.
 *
 *   npx tsx scripts/filings/fetch-nse-year-to-date.ts [--symbols=ITC,TCS] [--delay-ms=1500]
 *
 * With no --symbols, every company that already has a year-to-date.json.
 *
 * The June, September and December quarters' integrated filings (March 2025
 * onward) carry the fiscal year to date: three, six or nine months from
 * 1 April, in the `FourD` context (in June, the quarter's own context). For each symbol this lists them, downloads each
 * consolidated XBRL instance (cached under data/filings/<SYMBOL>/raw/,
 * git-ignored), and writes data/filings/<SYMBOL>/year-to-date.json, keyed by
 * filing date as as-filed.json is. A filing with no context running from
 * 1 April to its quarter's end is left out and reported. The March quarter is the full
 * year, which fetch-nse-annual.ts records.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractAnnualHeadline, parseXbrlInstance, selectAnnualContexts, type AnnualHeadline } from "../../src/engine/filings/xbrlInstance";
import { curl, INTEGRATED_REFERER, integratedListingUrl, isoDate, isXbrl, sleep, type NseIntegratedRow } from "./nse";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const FILINGS = join(ROOT, "data", "filings");
const symbols = arg("symbols")
  ? arg("symbols")!.split(",").map((s) => s.trim()).filter(Boolean)
  : readdirSync(FILINGS).filter((d) => existsSync(join(FILINGS, d, "year-to-date.json"))).sort();
const delayMs = Number(arg("delay-ms") ?? 1500);
if (!symbols.length) throw new Error("no symbols: pass --symbols=ITC,TCS");

export interface AsFiledYearToDateRecord {
  /** The quarter the filing closes: the year to date ends here. */
  periodEnd: string;
  /** The fiscal year the months belong to. */
  fiscalYearEnd: string;
  /** Months of the fiscal year the figures cover: 3, 6 or 9. */
  months: number;
  filingDate: string;
  consolidated: boolean;
  audited: boolean;
  xbrlUrl: string;
  /** ₹ crore, the year to date as reported in that filing. */
  headline: AnnualHeadline;
}

const MONTHS_TO: Record<string, number> = { "06": 3, "09": 6, "12": 9 };

for (const symbol of symbols) {
  const dir = join(FILINGS, symbol);
  const rawDir = join(dir, "raw");
  mkdirSync(rawDir, { recursive: true });
  let listed: NseIntegratedRow[];
  try {
    listed = (JSON.parse(curl(integratedListingUrl(symbol), INTEGRATED_REFERER)) as { data?: NseIntegratedRow[] }).data ?? [];
  } catch (error) {
    console.log(`${symbol}: integrated listing failed — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    continue;
  }
  const quarters = listed.filter((r) => r.xbrl && /\.xml$/i.test(r.xbrl) && !/-MAR-/i.test(r.qe_Date));
  // A company without subsidiaries (e.g. Nestlé India) files standalone only.
  const hasConsolidated = quarters.some((r) => r.consolidated === "Consolidated");
  const records: AsFiledYearToDateRecord[] = [];
  for (const row of quarters.filter((r) => (hasConsolidated ? r.consolidated === "Consolidated" : true))) {
    const periodEnd = isoDate(row.qe_Date);
    const months = MONTHS_TO[periodEnd.slice(5, 7)];
    if (!months) continue;
    const endYear = Number(periodEnd.slice(0, 4)) + 1;
    const fiscalYearEnd = `${endYear}-03-31`;
    const file = join(rawDir, row.xbrl!.split("/").pop()!);
    let xml: string;
    if (existsSync(file)) {
      xml = readFileSync(file, "utf8");
    } else {
      sleep(delayMs);
      try {
        xml = curl(row.xbrl!, INTEGRATED_REFERER);
      } catch (error) {
        console.log(`${symbol} ${periodEnd}: download failed — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
        continue;
      }
      if (isXbrl(xml)) writeFileSync(file, xml);
    }
    if (!isXbrl(xml)) {
      console.log(`${symbol} ${periodEnd}: not an XBRL instance (blocked or moved); skipped`);
      continue;
    }
    const instance = parseXbrlInstance(xml);
    // Dated, never taken on its ID alone: older results filings stamp `FourD` with the quarter's dates.
    const yearStart = `${endYear - 1}-04-01`;
    const spans = [...instance.contexts.values()].filter((c) => !c.dimensional && c.startDate === yearStart && c.endDate === periodEnd);
    const duration = spans.find((c) => /^FourD$/i.test(c.id)) ?? spans[0] ?? null;
    if (!duration) {
      console.log(`${symbol} ${periodEnd}: no context runs from ${yearStart} to ${periodEnd}; skipped`);
      continue;
    }
    const contexts = { duration, instant: selectAnnualContexts(instance, periodEnd).instant, method: /^FourD$/i.test(duration.id) ? "id-convention" as const : "date-span" as const };
    records.push({
      periodEnd,
      fiscalYearEnd,
      months,
      // A revision carries no broadcast date; it was filed when it was revised.
      filingDate: isoDate(row.broadcast_Date ?? row.revised_Date ?? row.creation_Date),
      consolidated: row.consolidated === "Consolidated",
      audited: row.audited === "Audited",
      xbrlUrl: row.xbrl!,
      headline: extractAnnualHeadline(instance, periodEnd, contexts).headline,
    });
  }
  records.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd) || a.filingDate.localeCompare(b.filingDate));
  writeFileSync(join(dir, "year-to-date.json"), JSON.stringify({ symbol, source: "NSE integrated-filing-results (June, September and December quarters), year to date", records }, null, 1) + "\n");
  console.log(`${symbol}: ${records.length} year-to-date filings (${[...new Set(records.map((r) => r.periodEnd))].join(", ")})`);
  sleep(delayMs);
}
