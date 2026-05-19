/**
 * validate-registry.ts — Build-time check that registry.json folder names
 * match actual directories on disk (case-sensitive comparison).
 *
 * On Windows, fs.readdirSync returns the actual on-disk casing even though
 * the filesystem is case-insensitive. This means the check works correctly
 * on dev machines too — it catches casing mismatches before they hit Linux.
 *
 * Also verifies that each folder contains a consolidated ZIP matching
 * the folder name (i.e., "{folder}.zip") since DataEntry.tsx fetches it
 * by that exact name.
 *
 * Usage:
 *   npx tsx scripts/validate-registry.ts
 *   (or add to package.json "prebuild": "tsx scripts/validate-registry.ts")
 *
 * Exit 0 = all good, Exit 1 = mismatches found.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const COMPANIES_DIR = path.join(ROOT, "public", "data", "companies");
const REGISTRY_PATH = path.join(COMPANIES_DIR, "registry.json");

interface RegistryEntry {
  folder: string;
  name: string;
  ticker: string;
  type: string;
  hasStandalone?: boolean;
}

function main(): void {
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error("ERROR: registry.json not found at", REGISTRY_PATH);
    process.exit(1);
  }

  const registry: RegistryEntry[] = JSON.parse(
    fs.readFileSync(REGISTRY_PATH, "utf-8")
  );

  // Get actual directory names on disk (case-preserving even on Windows)
  const actualDirs = new Set(
    fs.readdirSync(COMPANIES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  );

  const errors: string[] = [];
  const warnings: string[] = [];

  for (const entry of registry) {
    const { folder, name, ticker } = entry;

    // Check 1: Does the folder exist with exact casing?
    if (!actualDirs.has(folder)) {
      // Check if it exists with different casing
      const ciMatch = [...actualDirs].find(
        (d) => d.toLowerCase() === folder.toLowerCase()
      );
      if (ciMatch) {
        errors.push(
          `CASING MISMATCH: registry expects "${folder}" but disk has "${ciMatch}" ` +
          `(${name} / ${ticker})`
        );
      } else {
        errors.push(
          `MISSING FOLDER: "${folder}" not found on disk (${name} / ${ticker})`
        );
      }
      continue;
    }

    // Check 2: Does the consolidated ZIP exist with correct name?
    const expectedZip = `${folder}.zip`;
    const folderPath = path.join(COMPANIES_DIR, folder);
    const filesInDir = fs.readdirSync(folderPath);
    const hasConsolidatedZip = filesInDir.includes(expectedZip);

    if (!hasConsolidatedZip) {
      // Check case-insensitive match
      const ciZip = filesInDir.find(
        (f) => f.toLowerCase() === expectedZip.toLowerCase() && f !== expectedZip
      );
      if (ciZip) {
        errors.push(
          `ZIP CASING: "${folder}/" contains "${ciZip}" but code expects "${expectedZip}"`
        );
      } else {
        // Maybe no consolidated zip at all — only a warning since user might
        // only have standalone
        const anyZip = filesInDir.filter(
          (f) => f.endsWith(".zip") && f !== "standalone.zip"
        );
        if (anyZip.length > 0) {
          errors.push(
            `ZIP NAME MISMATCH: "${folder}/" has ${anyZip.join(", ")} but code expects "${expectedZip}"`
          );
        } else {
          warnings.push(
            `NO CONSOLIDATED ZIP: "${folder}/" has no ${expectedZip} (only standalone?)`
          );
        }
      }
    }

    // Check 3: If hasStandalone, verify standalone.zip exists
    if (entry.hasStandalone) {
      if (!filesInDir.includes("standalone.zip")) {
        warnings.push(
          `MISSING STANDALONE: "${folder}/" marked hasStandalone=true but no standalone.zip`
        );
      }
    }
  }

  // Check 4: Orphan directories (on disk but not in registry)
  const registeredFolders = new Set(registry.map((e) => e.folder));
  for (const dir of actualDirs) {
    if (!registeredFolders.has(dir)) {
      warnings.push(`ORPHAN DIRECTORY: "${dir}/" exists on disk but is not in registry.json`);
    }
  }

  // Report
  if (warnings.length > 0) {
    console.warn("\n⚠️  WARNINGS:");
    for (const w of warnings) console.warn(`   ${w}`);
  }

  if (errors.length > 0) {
    console.error("\n❌ ERRORS (will break on Vercel/Linux):");
    for (const e of errors) console.error(`   ${e}`);
    console.error(`\n${errors.length} error(s) found. Fix before deploying.`);
    process.exit(1);
  }

  console.log(`\n✅ Registry validated: ${registry.length} companies, all folders + ZIPs match.`);
  if (warnings.length > 0) {
    console.log(`   (${warnings.length} non-blocking warning(s) above)`);
  }
  process.exit(0);
}

main();
