const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');

const companiesDir = path.join(__dirname, 'public', 'data', 'companies');
const registryFile = path.join(companiesDir, 'registry.json');

// Fixed epoch for deterministic ZIP generation — without this JSZip writes
// current timestamps into each entry header, so every dev-server start
// rewrites all 22 ZIPs with new bytes and git marks them modified.
const ZIP_FIXED_DATE = new Date('2024-01-01T00:00:00Z');

// Premium baseline metadata for the 13 preloaded companies.
// KEYS MUST MATCH THE EXACT DISK FOLDER NAME — strict lookup first, then a
// case-insensitive fallback below to surface drift loudly. A casing mismatch
// silently falling through to the inferred-ticker path produces wrong NSE
// tickers (e.g. "Bajaj Finance" -> "BAJAJFINANC" via slice(0, 12) instead of
// "BAJFINANCE").
const BASELINE_METADATA = {
  "ITC": {
    name: "ITC Ltd",
    ticker: "ITC",
    sector: "FMCG / Cigarettes",
    type: "conglomerate",
    description: "Diversified conglomerate \u2014 cigarettes, FMCG, hotels, paper, agri",
    emoji: "\ud83d\udeac",
    showcaseFor: "SOTP valuation across multiple segments",
  },
  "HDFC Bank": {
    name: "HDFC Bank",
    ticker: "HDFCBANK",
    sector: "Banking",
    type: "bank",
    description: "Largest private-sector bank by assets",
    emoji: "\ud83c\udfe6",
    showcaseFor: "Bank-specific quality_indicators pipeline",
  },
  "ICICI Bank": {
    name: "ICICI Bank",
    ticker: "ICICIBANK",
    sector: "Banking",
    type: "bank",
    description: "Universal bank with strong digital franchise",
    emoji: "\ud83c\udfe6",
  },
  "KOTAKBANK": {
    name: "Kotak Mahindra Bank",
    ticker: "KOTAKBANK",
    sector: "Banking",
    type: "bank",
    description: "Premium private bank with conservative loan book",
    emoji: "\ud83c\udfe6",
  },
  "SBIN": {
    name: "State Bank of India",
    ticker: "SBIN",
    sector: "Banking (PSU)",
    type: "bank",
    description: "Largest public-sector bank",
    emoji: "\ud83c\udfdb\ufe0f",
  },
  "Bajaj Finance": {
    name: "Bajaj Finance",
    ticker: "BAJFINANCE",
    sector: "NBFC",
    type: "nbfc",
    description: "Consumer finance NBFC with retail loan focus",
    emoji: "\ud83d\udcb3",
    showcaseFor: "NBFC routing \u2014 borrowings/equity leverage frame",
  },
  "Life Insurance Corporation of India": {
    name: "LIC",
    ticker: "LICI",
    sector: "Insurance (Life)",
    type: "insurance",
    description: "State-owned life insurer, dominant market share",
    emoji: "\ud83d\udee1\ufe0f",
    showcaseFor: "Insurance fail-closed (no equity-side valuation)",
  },
  "Power Grid Corporation of India Ltd": {
    name: "Power Grid",
    ticker: "POWERGRID",
    sector: "Utility (PSU)",
    type: "utility",
    description: "Inter-state electricity transmission monopoly",
    emoji: "\u26a1",
    showcaseFor: "Regulated utility with stable returns",
  },
  "Tata Consultancy Services Ltd": {
    name: "TCS",
    ticker: "TCS",
    sector: "IT Services",
    type: "it-services",
    description: "Global IT services leader, capital-light",
    emoji: "\ud83d\udcbb",
    showcaseFor: "IT-services detector + moat scorer awareness",
  },
  "Tata Steel": {
    name: "Tata Steel",
    ticker: "TATASTEEL",
    sector: "Metals (Cyclical)",
    type: "cyclical",
    description: "Integrated steel producer, India + Europe",
    emoji: "\ud83c\udfd7\ufe0f",
    showcaseFor: "Cyclical normalization + cycle-aware terminal RE",
  },
  "Paytm": {
    name: "Paytm (One97)",
    ticker: "PAYTM",
    sector: "Fintech",
    type: "loss-maker",
    description: "Digital payments + financial services platform",
    emoji: "\ud83d\udcf1",
    showcaseFor: "Loss-maker valuation pipeline (no positive earnings)",
  },
  "Reliance Industries": {
    name: "Reliance Industries",
    ticker: "RELIANCE",
    sector: "Conglomerate",
    type: "conglomerate",
    description: "O2C + telecom (Jio) + retail + new energy",
    emoji: "\ud83d\udee2\ufe0f",
    showcaseFor: "Mixed conglomerate routing + segment-aware SOTP",
  },
  "Vodafone Idea Ltd": {
    name: "Vodafone Idea",
    ticker: "IDEA",
    sector: "Telecom",
    type: "telecom",
    description: "3rd-largest telco \u2014 chronic losses, negative net worth",
    emoji: "\ud83d\udce1",
    showcaseFor: "Negative-equity stress test (distress detector)",
  }
};

// Pre-build a case-insensitive lookup so a folder rename like
// "bajaj finance" -> "Bajaj Finance" doesn't silently fall through.
const BASELINE_METADATA_CI = {};
for (const [k, v] of Object.entries(BASELINE_METADATA)) {
  BASELINE_METADATA_CI[k.toLowerCase()] = { _key: k, ...v };
}

function lookupBaselineMetadata(folderName) {
  if (Object.prototype.hasOwnProperty.call(BASELINE_METADATA, folderName)) {
    return BASELINE_METADATA[folderName];
  }
  const ci = BASELINE_METADATA_CI[folderName.toLowerCase()];
  if (ci) {
    console.warn(
      `WARN Metadata key "${ci._key}" does not match disk folder "${folderName}" - ` +
      `update sync-companies.cjs BASELINE_METADATA so keys match disk casing exactly.`
    );
    const { _key, ...rest } = ci;
    return rest;
  }
  return null;
}

function toTitleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Build a deterministic ZIP archive from a list of {name, data} entries.
 * Sorts by name and writes a fixed timestamp on every entry so the
 * resulting bytes are reproducible across runs.
 */
async function buildDeterministicZip(entries) {
  const zip = new JSZip();
  // Use byte-order sort (NOT localeCompare) so output is identical on
  // every OS — Windows dev box, Linux CI runner, macOS. localeCompare's
  // default locale varies and could shuffle entries between platforms.
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Pre-create directory entries with the fixed date. JSZip auto-creates
  // implicit folder entries (e.g. "revised schd/") when you add a file in
  // a subpath, and those auto-created entries pick up Date.now() because
  // the {date} option only attaches to the file entry, not the implicit
  // folder. Result: ZIP bytes drift across runs even when source content
  // is identical. Fix: explicitly add folder entries with the fixed date
  // so the auto-create path is never taken.
  const folders = new Set();
  for (const { name } of sorted) {
    const parts = name.split('/');
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i++) {
      prefix += parts[i] + '/';
      folders.add(prefix);
    }
  }
  const sortedFolders = [...folders].sort();
  for (const folder of sortedFolders) {
    zip.file(folder, null, { dir: true, date: ZIP_FIXED_DATE });
  }

  for (const { name, data } of sorted) {
    zip.file(name, data, { date: ZIP_FIXED_DATE });
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'DOS',
  });
}

/**
 * Write `buffer` to `filePath` only if its contents differ. SHA-256 over the
 * buffer is used to skip identical writes - keeps git status clean and
 * avoids waking up file watchers (Vite HMR) for no reason.
 */
function writeIfChanged(filePath, buffer, label) {
  const newHash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath);
    const oldHash = crypto.createHash('sha256').update(existing).digest('hex');
    if (oldHash === newHash) return false;
  }
  fs.writeFileSync(filePath, buffer);
  console.log(`+ wrote ${label} (${(buffer.length / 1024).toFixed(0)} KB)`);
  return true;
}

async function syncAndPackCompany(folderName) {
  const companyPath = path.join(companiesDir, folderName);
  const standalonePath = path.join(companyPath, 'standalone');
  let hasStandalone = false;

  // Consolidated zip (deterministic + content-hash skip)
  const consolidatedZipPath = path.join(companyPath, `${folderName}.zip`);
  const rootDirFiles = fs.readdirSync(companyPath);
  const xlsFiles = rootDirFiles.filter(f => f.endsWith('.xls') || f.endsWith('.xlsx'));

  if (xlsFiles.length > 0) {
    try {
      const entries = [];
      for (const file of xlsFiles) {
        entries.push({ name: file, data: fs.readFileSync(path.join(companyPath, file)) });
      }
      const revisedPath = path.join(companyPath, 'revised schd');
      if (fs.existsSync(revisedPath) && fs.statSync(revisedPath).isDirectory()) {
        for (const file of fs.readdirSync(revisedPath)) {
          const fp = path.join(revisedPath, file);
          if (fs.statSync(fp).isFile()) {
            entries.push({ name: `revised schd/${file}`, data: fs.readFileSync(fp) });
          }
        }
      }
      const stdPath = path.join(companyPath, 'standard');
      if (fs.existsSync(stdPath) && fs.statSync(stdPath).isDirectory()) {
        for (const file of fs.readdirSync(stdPath)) {
          const fp = path.join(stdPath, file);
          if (fs.statSync(fp).isFile()) {
            entries.push({ name: `standard/${file}`, data: fs.readFileSync(fp) });
          }
        }
      }
      const buffer = await buildDeterministicZip(entries);
      writeIfChanged(consolidatedZipPath, buffer, `consolidated ZIP for ${folderName}`);
    } catch (zipErr) {
      console.error(`Warning: Failed to package consolidated files for ${folderName}:`, zipErr);
    }
  }

  // Standalone zip (deterministic + content-hash skip)
  if (fs.existsSync(standalonePath) && fs.statSync(standalonePath).isDirectory()) {
    hasStandalone = true;
    const standaloneZipPath = path.join(companyPath, 'standalone.zip');
    try {
      const entries = [];
      for (const file of fs.readdirSync(standalonePath)) {
        const fp = path.join(standalonePath, file);
        if (fs.statSync(fp).isFile()) {
          entries.push({ name: file, data: fs.readFileSync(fp) });
        }
      }
      const revisedPath = path.join(companyPath, 'revised schd', 'standalone');
      if (fs.existsSync(revisedPath)) {
        for (const file of fs.readdirSync(revisedPath)) {
          const fp = path.join(revisedPath, file);
          if (fs.statSync(fp).isFile()) {
            entries.push({ name: `revised schd/${file}`, data: fs.readFileSync(fp) });
          }
        }
      }
      const stdPath = path.join(companyPath, 'standard', 'standalone');
      if (fs.existsSync(stdPath)) {
        for (const file of fs.readdirSync(stdPath)) {
          const fp = path.join(stdPath, file);
          if (fs.statSync(fp).isFile()) {
            entries.push({ name: `standard/${file}`, data: fs.readFileSync(fp) });
          }
        }
      }
      const buffer = await buildDeterministicZip(entries);
      writeIfChanged(standaloneZipPath, buffer, `standalone.zip for ${folderName}`);
    } catch (zipErr) {
      console.error(`Warning: Failed to package standalone files for ${folderName}:`, zipErr);
    }
  } else if (fs.existsSync(path.join(companyPath, 'standalone.zip'))) {
    hasStandalone = true;
  }

  // Resolve metadata: BASELINE > metadata.json > inferred-fallback
  let metadata = lookupBaselineMetadata(folderName);

  if (!metadata) {
    const metadataPath = path.join(companyPath, 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        console.log(`+ Loaded custom metadata.json for ${folderName}`);
      } catch (err) {
        console.error(`Warning: Invalid metadata.json in ${folderName}, applying fallbacks.`, err);
      }
    }
  }

  if (!metadata) {
    // Smart fallback for new folders. EMITS A WARNING - if a company falls
    // into this branch, the inferred ticker is almost certainly wrong
    // (slice(0, 12) on the folder name). Add to BASELINE_METADATA above.
    console.warn(
      `WARN No metadata for "${folderName}" - falling through to inferred ticker. ` +
      `Add it to BASELINE_METADATA in sync-companies.cjs (or drop a metadata.json ` +
      `into the folder) to set the correct NSE ticker.`
    );
    const name = toTitleCase(folderName);
    const ticker = folderName.replace(/\s+/g, '').toUpperCase().slice(0, 12);

    let type = "industrial";
    const lf = folderName.toLowerCase();
    if (lf.includes("bank")) type = "bank";
    else if (lf.includes("nbfc") || lf.includes("finance") || lf.includes("capital")) type = "nbfc";
    else if (lf.includes("insurance") || lf.includes("lic")) type = "insurance";
    else if (lf.includes("utility") || lf.includes("power") || lf.includes("grid") || lf.includes("energy")) type = "utility";
    else if (lf.includes("telecom") || lf.includes("communication")) type = "telecom";
    else if (lf.includes("tcs") || lf.includes("consultancy") || lf.includes("software") || lf.includes("tech")) type = "it-services";

    let emoji = "\ud83c\udfe2";
    if (type === "bank") emoji = "\ud83c\udfe6";
    else if (type === "nbfc") emoji = "\ud83d\udcb3";
    else if (type === "insurance") emoji = "\ud83d\udee1\ufe0f";
    else if (type === "utility") emoji = "\u26a1";
    else if (type === "telecom") emoji = "\ud83d\udce1";
    else if (type === "it-services") emoji = "\ud83d\udcbb";

    const sector = toTitleCase(type.replace("-", " "));
    const description = `Pre-loaded Capitaline financial dataset for ${name}.`;
    metadata = { name, ticker, sector, type, description, emoji };
    console.log(`+ Discovered new company "${name}" with inferred type: ${type}`);
  }

  return { folder: folderName, ...metadata, hasStandalone };
}

async function run() {
  if (!fs.existsSync(companiesDir)) {
    console.error('Error: Companies directory does not exist!');
    process.exit(1);
  }

  // Load existing registry to preserve blob URLs AND ticker overrides.
  // Ticker is a hand-corrected NSE-equivalence field. Preserving it across
  // runs makes manual tweaks sticky.
  let existingRegistry = [];
  if (fs.existsSync(registryFile)) {
    try {
      existingRegistry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    } catch (e) {
      console.warn("Warning: Could not read existing registry.json:", e.message);
    }
  }
  const existingByFolder = new Map(existingRegistry.map(c => [c.folder, c]));

  const items = fs.readdirSync(companiesDir);
  const companyList = [];

  for (const item of items) {
    const itemPath = path.join(companiesDir, item);
    if (fs.statSync(itemPath).isDirectory()) {
      const company = await syncAndPackCompany(item);

      const existing = existingByFolder.get(item);
      if (existing) {
        if (existing.blobUrl) company.blobUrl = existing.blobUrl;
        if (existing.standaloneBlobUrl) company.standaloneBlobUrl = existing.standaloneBlobUrl;
        if (existing.qualityIndicatorsBlobUrl) company.qualityIndicatorsBlobUrl = existing.qualityIndicatorsBlobUrl;
        if (existing.sidecarBlobs) company.sidecarBlobs = existing.sidecarBlobs;

        // Ticker drift warning. BASELINE_METADATA is the source of truth -
        // overriding belongs in BASELINE_METADATA (or a metadata.json sidecar
        // in the company folder), not in the generated registry. We do NOT
        // preserve the registry value because it might be a stale slice(0,12)
        // fallback artifact from when the BASELINE entry was missing.
        if (existing.ticker && existing.ticker !== company.ticker) {
          console.warn(
            `WARN Ticker drift on "${item}": baseline=${company.ticker}, registry=${existing.ticker}. ` +
            `Using baseline. If "${existing.ticker}" is correct, update BASELINE_METADATA in sync-companies.cjs.`
          );
        }
      }

      companyList.push(company);
    }
  }

  // Byte-order sort for cross-OS deterministic registry.json
  companyList.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Idempotent write - only touch the file if the JSON actually changed.
  // Stops the dev server from inflating git status on every restart.
  const newJson = JSON.stringify(companyList, null, 2) + "\n";
  let changed = true;
  if (fs.existsSync(registryFile)) {
    const existing = fs.readFileSync(registryFile, 'utf8');
    if (existing === newJson) changed = false;
  }
  if (changed) {
    fs.writeFileSync(registryFile, newJson);
    console.log(`\nRegistry compiled. Wrote ${companyList.length} companies to ${registryFile}\n`);
  } else {
    console.log(`\nRegistry already up to date (${companyList.length} companies). No write needed.\n`);
  }
}

run().catch(err => {
  console.error('Registry sync failed:', err);
  process.exit(1);
});
