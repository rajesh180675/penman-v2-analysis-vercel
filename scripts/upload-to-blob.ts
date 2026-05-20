#!/usr/bin/env npx ts-node --esm
/**
 * scripts/upload-to-blob.ts
 *
 * One-time upload of all company ZIPs to Vercel Blob.
 * Writes blob URLs back into public/data/companies/registry.json.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=<token> npx ts-node --esm scripts/upload-to-blob.ts
 *
 * Requires BLOB_READ_WRITE_TOKEN env var (from Vercel dashboard → Storage → Blob).
 * Safe to re-run — existing blobs are overwritten (addRandomSuffix: false).
 */

import { put } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANIES_DIR = path.resolve(__dirname, "../public/data/companies");
const REGISTRY_PATH = path.join(COMPANIES_DIR, "registry.json");

interface RegistryEntry {
  folder: string;
  name: string;
  ticker: string;
  sector: string;
  type: string;
  description: string;
  emoji: string;
  showcaseFor?: string;
  hasStandalone?: boolean;
  blobUrl?: string;
  standaloneBlobUrl?: string;
}

async function uploadZip(folder: string, zipName: string): Promise<string> {
  const filePath = path.join(COMPANIES_DIR, folder, zipName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`ZIP not found: ${filePath}`);
  }
  const buffer = fs.readFileSync(filePath);
  const blobKey = `companies/${folder}/${zipName}`;
  console.log(`  Uploading ${blobKey} (${Math.round(buffer.length / 1024)} KB)...`);
  const result = await put(blobKey, buffer, {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/zip",
  });
  console.log(`  -> ${result.url}`);
  return result.url;
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("ERROR: BLOB_READ_WRITE_TOKEN env var is not set.");
    console.error("Get it from: Vercel dashboard -> Storage -> Blob -> .env.local");
    process.exit(1);
  }

  const registry: RegistryEntry[] = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
  let uploaded = 0;
  let skipped = 0;

  for (const entry of registry) {
    console.log(`\n[${entry.name}]`);
    const consZip = `${entry.folder}.zip`;
    const consPath = path.join(COMPANIES_DIR, entry.folder, consZip);

    if (fs.existsSync(consPath)) {
      try {
        entry.blobUrl = await uploadZip(entry.folder, consZip);
        uploaded++;
      } catch (e) {
        console.warn(`  WARN: consolidated upload failed — ${e}`);
      }
    } else {
      console.log(`  No consolidated ZIP found, skipping.`);
      skipped++;
    }

    if (entry.hasStandalone) {
      const stanPath = path.join(COMPANIES_DIR, entry.folder, "standalone.zip");
      if (fs.existsSync(stanPath)) {
        try {
          entry.standaloneBlobUrl = await uploadZip(entry.folder, "standalone.zip");
          uploaded++;
        } catch (e) {
          console.warn(`  WARN: standalone upload failed — ${e}`);
        }
      } else {
        console.log(`  No standalone ZIP found, skipping.`);
      }
    }
  }

  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
  console.log(`\nDone. ${uploaded} ZIPs uploaded, ${skipped} skipped.`);
  console.log(`registry.json updated with blob URLs.`);
  console.log(`\nNext: commit registry.json and deploy to Vercel.`);
}

main().catch(err => {
  console.error("Upload failed:", err);
  process.exit(1);
});
