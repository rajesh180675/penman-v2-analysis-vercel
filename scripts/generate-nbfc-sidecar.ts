/**
 * Generate nbfc_sidecar.json for NBFC companies.
 * Reads LGD XLS files + RBI NHB Banks XLS, parses them with the engine parsers,
 * and writes structured JSON that the frontend fast-path can consume.
 *
 * Usage:
 *   npx tsx scripts/generate-nbfc-sidecar.ts "Muthoot Finance"
 *   npx tsx scripts/generate-nbfc-sidecar.ts   # all NBFCs in registry
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parseLgdFile, parseRbiNhbFile } from "../src/engine/nbfcSidecarParser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPANIES_DIR = resolve(__dirname, "../public/data/companies");

interface RegistryEntry {
  folder: string;
  type: string;
}

function fiscalLabelFromFilename(filename: string): string | null {
  // LossGivenDefault_202503.xls → "FY2025"
  const m = filename.match(/LossGivenDefault_(\d{4})(\d{2})\.xls$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  // Indian FY: April-March. 202503 = FY ending March 2025 = FY2025
  // 202103 = FY2021, 201803 = FY2018
  if (month <= 3) return `FY${year}`;
  return `FY${year + 1}`;
}

function generateForCompany(folder: string): boolean {
  const companyDir = resolve(COMPANIES_DIR, folder);
  const lgdDir = resolve(companyDir, "Loss Given Default");
  const nhbPath = resolve(companyDir, "RBI NHB Banks/RBINHBBanks_.xls");

  // Parse LGD files
  const lgd: Array<{ fiscal_label: string; [key: string]: unknown }> = [];
  if (existsSync(lgdDir)) {
    const files = readdirSync(lgdDir)
      .filter(f => f.endsWith(".xls"))
      .sort(); // lexicographic sort = chronological for YYYYMM names

    for (const fname of files) {
      const html = readFileSync(resolve(lgdDir, fname), "utf-8");
      const fiscalLabel = fiscalLabelFromFilename(fname);
      if (!fiscalLabel) {
        console.warn(`  WARN: Cannot extract FY from filename: ${fname}, skipping`);
        continue;
      }
      try {
        const parsed = parseLgdFile(html);
        lgd.push({ fiscal_label: fiscalLabel, ...parsed });
      } catch (err) {
        console.warn(`  WARN: Failed to parse ${fname}: ${err}`);
      }
    }
  }

  // Parse RBI NHB
  let rbiNhb: unknown[] = [];
  if (existsSync(nhbPath)) {
    try {
      const html = readFileSync(nhbPath, "utf-8");
      rbiNhb = parseRbiNhbFile(html);
    } catch (err) {
      console.warn(`  WARN: Failed to parse RBI NHB: ${err}`);
    }
  }

  if (lgd.length === 0 && rbiNhb.length === 0) {
    console.log(`  No LGD or RBI NHB data found for ${folder}, skipping.`);
    return false;
  }

  const output = {
    generated_at: new Date().toISOString(),
    source: "scripts/generate-nbfc-sidecar.ts",
    lgd,
    rbi_nhb: rbiNhb,
  };

  const outPath = resolve(companyDir, "nbfc_sidecar.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`  ✓ ${folder}: lgd=${lgd.length} periods, rbi_nhb=${(rbiNhb as unknown[]).length} periods → ${outPath}`);
  return true;
}

// Main
const targetFolder = process.argv[2];

if (targetFolder) {
  // Single company
  console.log(`[${targetFolder}]`);
  generateForCompany(targetFolder);
} else {
  // All NBFCs from registry
  const registry: RegistryEntry[] = JSON.parse(
    readFileSync(resolve(COMPANIES_DIR, "registry.json"), "utf-8")
  );
  const nbfcs = registry.filter(e => e.type === "nbfc");
  console.log(`Generating nbfc_sidecar.json for ${nbfcs.length} NBFC companies...\n`);
  for (const entry of nbfcs) {
    console.log(`[${entry.folder}]`);
    generateForCompany(entry.folder);
  }
}
