#!/usr/bin/env node
/**
 * scripts/upload-to-blob.mjs
 *
 * Uploads all company ZIPs, quality_indicators.json sidecars, and
 * Bajaj Finance XLS sidecar folders to Vercel Blob.
 * Writes blob URLs back into public/data/companies/registry.json.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=<token> node scripts/upload-to-blob.mjs
 *
 * Safe to re-run — existing blobs are overwritten (x-add-random-suffix: 0).
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

async function uploadFile(blobKey, filePath, contentType = "application/octet-stream") {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  const url = `https://blob.vercel-storage.com/${encodeURIComponent(blobKey)}`;
  console.log(`  Uploading ${blobKey} (${Math.round(buffer.length / 1024)} KB)...`);
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": contentType,
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

async function uploadFolder(folder, subdir, contentType) {
  const dirPath = path.join(COMPANIES_DIR, folder, subdir);
  if (!fs.existsSync(dirPath)) return [];
  const files = fs.readdirSync(dirPath).filter(f => !f.startsWith("."));
  const urls = [];
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    if (!fs.statSync(filePath).isFile()) continue;
    const blobKey = `companies/${folder}/${subdir}/${file}`;
    try {
      const url = await uploadFile(blobKey, filePath, contentType);
      if (url) urls.push(url);
    } catch (e) {
      console.warn(`  WARN: ${file} upload failed — ${e.message}`);
    }
  }
  return urls;
}

async function main() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
  let uploaded = 0;

  for (const entry of registry) {
    console.log(`\n[${entry.name}]`);

    // ── Consolidated ZIP ──────────────────────────────────────────
    const consZip = `${entry.folder}.zip`;
    const consPath = path.join(COMPANIES_DIR, entry.folder, consZip);
    if (fs.existsSync(consPath)) {
      try {
        const url = await uploadFile(`companies/${entry.folder}/${consZip}`, consPath, "application/zip");
        if (url) { entry.blobUrl = url; uploaded++; }
      } catch (e) { console.warn(`  WARN: consolidated ZIP — ${e.message}`); }
    } else {
      console.log(`  No consolidated ZIP, skipping.`);
    }

    // ── Standalone ZIP ────────────────────────────────────────────
    if (entry.hasStandalone) {
      const stanPath = path.join(COMPANIES_DIR, entry.folder, "standalone.zip");
      if (fs.existsSync(stanPath)) {
        try {
          const url = await uploadFile(`companies/${entry.folder}/standalone.zip`, stanPath, "application/zip");
          if (url) { entry.standaloneBlobUrl = url; uploaded++; }
        } catch (e) { console.warn(`  WARN: standalone ZIP — ${e.message}`); }
      }
    }

    // ── quality_indicators.json ───────────────────────────────────
    const qiPath = path.join(COMPANIES_DIR, entry.folder, "quality_indicators.json");
    if (fs.existsSync(qiPath)) {
      try {
        const url = await uploadFile(
          `companies/${entry.folder}/quality_indicators.json`,
          qiPath,
          "application/json"
        );
        if (url) { entry.qualityIndicatorsBlobUrl = url; uploaded++; }
      } catch (e) { console.warn(`  WARN: quality_indicators.json — ${e.message}`); }
    }

    // ── Bajaj Finance sidecar XLS folders ────────────────────────
    if (entry.folder === "Bajaj Finance") {
      entry.sidecarBlobs = entry.sidecarBlobs ?? {};

      console.log(`  [Subsidiaries]`);
      const subUrls = await uploadFolder(entry.folder, "Subsidiaries",
        "application/vnd.ms-excel");
      if (subUrls.length) { entry.sidecarBlobs.subsidiaries = subUrls; uploaded += subUrls.length; }

      console.log(`  [RBI NHB Banks]`);
      const rbiUrls = await uploadFolder(entry.folder, "RBI NHB Banks",
        "application/vnd.ms-excel");
      if (rbiUrls.length) { entry.sidecarBlobs.rbiNhbBanks = rbiUrls; uploaded += rbiUrls.length; }

      console.log(`  [Loss Given Default]`);
      const lgdUrls = await uploadFolder(entry.folder, "Loss Given Default",
        "application/vnd.ms-excel");
      if (lgdUrls.length) { entry.sidecarBlobs.lossGivenDefault = lgdUrls; uploaded += lgdUrls.length; }
    }
  }

  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
  console.log(`\nDone. ${uploaded} files uploaded.`);
  console.log(`registry.json updated — commit it and deploy to Vercel.`);
}

main().catch(err => { console.error(err); process.exit(1); });
