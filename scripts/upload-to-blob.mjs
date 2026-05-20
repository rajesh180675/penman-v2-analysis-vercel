#!/usr/bin/env node
/**
 * scripts/upload-to-blob.mjs
 *
 * Uploads all company ZIPs to Vercel Blob via REST API (no SDK).
 * Writes blob URLs back into public/data/companies/registry.json.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=<token> node scripts/upload-to-blob.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANIES_DIR = path.resolve(__dirname, "../public/data/companies");
const REGISTRY_PATH = path.join(COMPANIES_DIR, "registry.json");
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!TOKEN) {
  console.error("ERROR: BLOB_READ_WRITE_TOKEN env var is not set.");
  process.exit(1);
}

async function uploadZip(folder, zipName) {
  const filePath = path.join(COMPANIES_DIR, folder, zipName);
  if (!fs.existsSync(filePath)) return null;

  const buffer = fs.readFileSync(filePath);
  const blobKey = `companies/${folder}/${zipName}`;
  const url = `https://blob.vercel-storage.com/${encodeURIComponent(blobKey)}`;

  console.log(`  Uploading ${blobKey} (${Math.round(buffer.length / 1024)} KB)...`);

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/zip",
      "x-content-type": "application/zip",
      "x-add-random-suffix": "0",
      "x-cache-control-max-age": "31536000",
    },
    body: buffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const blobUrl = data.url ?? data.downloadUrl;
  console.log(`  -> ${blobUrl}`);
  return blobUrl;
}

async function main() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
  let uploaded = 0;

  for (const entry of registry) {
    console.log(`\n[${entry.name}]`);

    const consZip = `${entry.folder}.zip`;
    const consPath = path.join(COMPANIES_DIR, entry.folder, consZip);
    if (fs.existsSync(consPath)) {
      try {
        const url = await uploadZip(entry.folder, consZip);
        if (url) { entry.blobUrl = url; uploaded++; }
      } catch (e) {
        console.warn(`  WARN: consolidated upload failed — ${e.message}`);
      }
    } else {
      console.log(`  No consolidated ZIP, skipping.`);
    }

    if (entry.hasStandalone) {
      const stanPath = path.join(COMPANIES_DIR, entry.folder, "standalone.zip");
      if (fs.existsSync(stanPath)) {
        try {
          const url = await uploadZip(entry.folder, "standalone.zip");
          if (url) { entry.standaloneBlobUrl = url; uploaded++; }
        } catch (e) {
          console.warn(`  WARN: standalone upload failed — ${e.message}`);
        }
      }
    }
  }

  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
  console.log(`\nDone. ${uploaded} ZIPs uploaded.`);
  console.log(`registry.json updated — commit it and deploy to Vercel.`);
}

main().catch(err => { console.error(err); process.exit(1); });
