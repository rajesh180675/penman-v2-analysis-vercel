/**
 * Test remaining companies (excluding TCS which takes 154s).
 * npx tsx scripts/test-remaining-companies.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCapitalineZip } from "../src/engine/capitalineParser.ts";
import { processCompanyDataFull } from "../src/engine/pipeline.ts";
import { DEFAULT_CONFIG } from "../src/engine/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPANIES_DIR = join(__dirname, "..", "public", "data", "companies");

const SKIP = new Set(["Tata Consultancy Services Ltd"]); // takes 154s, already tested

async function main() {
  const folders = readdirSync(COMPANIES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(COMPANIES_DIR, e.name, e.name + ".zip")))
    .map(e => e.name).sort();

  const already = new Set([
    "Asian Paints","Avenue Supermarts","Bajaj Finance","Bharti Airtel","Britannia Industries",
    "Cholamandalam Investment","Dabur India","Grasim Industries","HDFC Bank",
    "HDFC Life Insurance Company Ltd","Hindustan Unilever","ICICI Bank","ITC","Infosys",
    "KOTAKBANK","Larsen & Toubro Ltd","Life Insurance Corporation of India",
    "Mahindra & Mahindra","Maruti Suzuki India Ltd","Muthoot Finance","NTPC","Nestlé India","Paytm"
  ]);

  const remaining = folders.filter(f => !already.has(f) && !SKIP.has(f));
  console.log(`Testing ${remaining.length} remaining companies...\n`);

  let failures = 0;
  for (const folder of remaining) {
    process.stdout.write(`${folder.padEnd(45)} ... `);
    try {
      const zipBuf = readFileSync(join(COMPANIES_DIR, folder, `${folder}.zip`));
      const t0 = Date.now();
      const { periods } = await parseCapitalineZip(new Uint8Array(zipBuf), {
        companyId: folder, filename: `${folder}.zip`,
      });
      const parseMs = Date.now() - t0;

      const config = { ...DEFAULT_CONFIG, company_type: "auto" };
      const pipelineResult = processCompanyDataFull(periods, config);
      const recast = pipelineResult.periods.length;
      const family = pipelineResult.analysisFamily;
      const hasBank = pipelineResult.bankResult != null;
      const visible = recast > 0 || hasBank;

      if (visible) {
        console.log(`OK  periods=${String(periods.length).padStart(3)} recast=${String(recast).padStart(3)} family=${family} (${(parseMs/1000).toFixed(1)}s)`);
      } else {
        failures++;
        console.log(`*** HIDDEN *** periods=${periods.length} recast=${recast} family=${family} bank=${hasBank}`);
      }
    } catch (err) {
      failures++;
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${remaining.length - failures} OK, ${failures} HIDDEN/ERROR`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
