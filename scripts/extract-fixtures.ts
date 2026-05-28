/**
 * Extract fixture JSON from company ZIP files for golden suite expansion.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parseCapitalineZip } from "../src/engine/capitalineParser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const companies = [
  { folder: "Grasim Industries", file: "Grasim Industries.zip", companyId: "GRASIM", name: "grasim" },
  { folder: "HDFC Bank", file: "HDFC Bank.zip", companyId: "HDFC BANK", name: "hdfc-bank" },
  { folder: "Bajaj Finance", file: "Bajaj Finance.zip", companyId: "BAJAJ FINANCE", name: "bajaj-finance" },
  { folder: "Life Insurance Corporation of India", file: "Life Insurance Corporation of India.zip", companyId: "LIC", name: "lic" },
];

async function main() {
  for (const c of companies) {
    const zipPath = resolve(__dirname, `../public/data/companies/${c.folder}/${c.file}`);
    const buf = readFileSync(zipPath);
    const file = new File([new Uint8Array(buf)], c.file, { type: "application/zip" });
    const parsed = await parseCapitalineZip(file, { companyId: c.companyId });
    console.log(`${c.companyId}: ${parsed.periods.length} periods`);

    // Keep last 5 periods (most recent) to keep fixture size manageable
    const rawData = parsed.periods.slice(-5);

    const fixture = {
      source: "vercel-audit",
      runId: `fixture-${c.name}`,
      capturedAt: new Date().toISOString(),
      companyId: c.companyId,
      sourceMode: "capitaline",
      latestPeriod: rawData[rawData.length - 1]?.period_end ?? "",
      rawData,
    };

    const outPath = resolve(__dirname, `../src/engine/__fixtures__/${c.name}-capitaline-audited.json`);
    writeFileSync(outPath, JSON.stringify(fixture, null, 2));
    console.log(`Wrote ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
