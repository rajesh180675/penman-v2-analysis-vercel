const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const crc32 = require('jszip/lib/crc32');

const companiesDir = path.join(__dirname, 'public', 'data', 'companies');
const registryFile = path.join(companiesDir, 'registry.json');
const metadataFile = path.join(companiesDir, 'companies-metadata.json');

// Fixed epoch for deterministic ZIP generation — without this JSZip writes
// current timestamps into each entry header, so every dev-server start
// rewrites all 22 ZIPs with new bytes and git marks them modified.
const ZIP_FIXED_DATE = new Date('2024-01-01T00:00:00Z');

// ══════════════════════════════════════════════════════════════════
// Metadata resolution — companies-metadata.json is the SINGLE source of truth.
// No hardcoded company list. Adding a company = add an entry to
// companies-metadata.json + drop the data folder.
//
// If a folder exists on disk but has no entry in companies-metadata.json,
// the script auto-adds an inferred entry and warns the user to verify the
// NSE ticker.
//
// Chain: companies-metadata.json → (this script) → registry.json
//        registry.json → (sync-tickers.cjs) → nseSymbolRegistry.ts
// ══════════════════════════════════════════════════════════════════

function toTitleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Infer metadata from a folder name when no entry exists in companies-metadata.json.
 * The inferred ticker is a best-guess (folder name → uppercase, no spaces,
 * max 12 chars). It is OFTEN WRONG for Indian companies (e.g. "Bajaj Finance"
 * → "BAJAJFINANCE" when the real NSE ticker is "BAJFINANCE").
 */
function inferMetadata(folderName) {
  const name = toTitleCase(folderName);
  const ticker = folderName.replace(/\s+/g, '').replace(/Ltd$|Limited$/i, '').toUpperCase().slice(0, 12);

  let type = "industrial";
  const lf = folderName.toLowerCase();
  if (lf.includes("bank")) type = "bank";
  else if (lf.includes("nbfc") || lf.includes("finance") || lf.includes("capital")) type = "nbfc";
  else if (lf.includes("insurance") || lf.includes("lic")) type = "insurance";
  else if (lf.includes("utility") || lf.includes("power") || lf.includes("grid") || lf.includes("energy")) type = "utility";
  else if (lf.includes("telecom") || lf.includes("communication")) type = "telecom";
  else if (lf.includes("tcs") || lf.includes("consultancy") || lf.includes("software") || lf.includes("tech")) type = "it-services";
  else if (lf.includes("nestle") || lf.includes("hul") || lf.includes("unilever") || lf.includes("fmcg") || lf.includes("consumer") || (lf.includes("food") && !lf.includes("power"))) type = "consumer";

  let emoji = "\ud83c\udfe2";
  if (type === "bank") emoji = "\ud83c\udfe6";
  else if (type === "nbfc") emoji = "\ud83d\udcb3";
  else if (type === "insurance") emoji = "\ud83d\udee1\ufe0f";
  else if (type === "utility") emoji = "\u26a1";
  else if (type === "telecom") emoji = "\ud83d\udce1";
  else if (type === "it-services") emoji = "\ud83d\udcbb";
  else if (type === "consumer") emoji = "\ud83d\uded2";

  const sector = type === "consumer" ? "FMCG" : toTitleCase(type.replace("-", " "));
  const description = `Capitaline financial dataset for ${name}.`;
  return { folder: folderName, name, ticker, sector, type, description, emoji };
}

/**
 * Load companies-metadata.json. Returns a Map of folder → metadata.
 * Creates the file if it doesn't exist.
 */
function loadMetadata() {
  if (!fs.existsSync(metadataFile)) {
    fs.writeFileSync(metadataFile, '[]\n');
    return new Map();
  }
  try {
    const arr = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    return new Map(arr.map(entry => [entry.folder, entry]));
  } catch (err) {
    console.error(`ERROR: Invalid companies-metadata.json:`, err.message);
    process.exit(1);
  }
}

/**
 * Save the metadata map back to companies-metadata.json (sorted, idempotent).
 */
function saveMetadata(metadataMap) {
  const arr = [...metadataMap.values()].sort((a, b) =>
    a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0
  );
  const json = JSON.stringify(arr, null, 2) + '\n';
  // Only write if changed
  if (fs.existsSync(metadataFile)) {
    const existing = fs.readFileSync(metadataFile, 'utf8');
    if (existing === json) return false;
  }
  fs.writeFileSync(metadataFile, json);
  return true;
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

/**
 * Quick check: does the ZIP already exist and cover all current source paths?
 * We compare the ZIP's mtime against the latest mtime of any source file.
 * If the ZIP is newer, it's almost certainly up to date (deterministic ZIP
 * content would not have changed without source changes).
 * 
 * Returns true if we can skip building this ZIP.
 */
async function zipUpToDate(zipPath, sourcePaths, expectedNames) {
  if (!fs.existsSync(zipPath)) return false;
  let zipMtime;
  try { zipMtime = fs.statSync(zipPath).mtimeMs; } catch { return false; }
  for (const p of sourcePaths) {
    try { if (fs.statSync(p).mtimeMs > zipMtime) return false; } catch { return false; }
  }

  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    const actualEntries = Object.values(zip.files)
      .filter(entry => !entry.dir)
      .map(entry => ({
        name: entry.name,
        size: entry._data?.uncompressedSize,
        crc: entry._data?.crc32 == null ? null : entry._data.crc32 >>> 0,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const expectedEntries = sourcePaths
      .map((sourcePath, index) => {
        const data = fs.readFileSync(sourcePath);
        return {
          name: expectedNames[index],
          size: data.length,
          crc: crc32(data) >>> 0,
        };
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
  } catch {
    return false;
  }
}

async function syncAndPackCompany(folderName) {
  const companyPath = path.join(companiesDir, folderName);
  const standalonePath = path.join(companyPath, 'standalone');
  let hasStandalone = false;

  // Consolidated zip (deterministic + content-hash skip)
  const consolidatedZipPath = path.join(companyPath, `${folderName}.zip`);
  let rootDirFiles = [];
  try {
    rootDirFiles = fs.readdirSync(companyPath);
  } catch (zipErr) {
    console.error(`Warning: Failed to package consolidated files for ${folderName}:`, zipErr);
  }
  const xlsFiles = rootDirFiles.filter(f => f.endsWith('.xls') || f.endsWith('.xlsx'));

  if (xlsFiles.length > 0) {
    let shouldBuildConsolidated = true;
    try {
      // Collect all source file paths for fast-path mtime check
      const sourcePaths = [];
      const sourceNames = [];
      for (const file of xlsFiles) {
        sourcePaths.push(path.join(companyPath, file));
        sourceNames.push(file);
      }
      const revisedPath = path.join(companyPath, 'revised schd');
      if (fs.existsSync(revisedPath) && fs.statSync(revisedPath).isDirectory()) {
        for (const file of fs.readdirSync(revisedPath)) {
          const fp = path.join(revisedPath, file);
          if (fs.statSync(fp).isFile()) {
            sourcePaths.push(fp);
            sourceNames.push(`revised schd/${file}`);
          }
        }
      }
      const stdPath = path.join(companyPath, 'standard');
      if (fs.existsSync(stdPath) && fs.statSync(stdPath).isDirectory()) {
        for (const file of fs.readdirSync(stdPath)) {
          const fp = path.join(stdPath, file);
          if (fs.statSync(fp).isFile()) {
            sourcePaths.push(fp);
            sourceNames.push(`standard/${file}`);
          }
        }
      }
      // Fast-path: skip read+hash+build if ZIP is newer than all sources
      shouldBuildConsolidated = !await zipUpToDate(consolidatedZipPath, sourcePaths, sourceNames);
    } catch (scanErr) {
      console.warn(`Warning: ZIP fast-path pre-scan failed for consolidated files for ${folderName}; rebuilding:`, scanErr.message);
    }
    if (shouldBuildConsolidated) {
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
  }

  // Standalone zip (deterministic + content-hash skip)
  let hasStandaloneDir = false;
  try {
    hasStandaloneDir = fs.existsSync(standalonePath) && fs.statSync(standalonePath).isDirectory();
  } catch (zipErr) {
    console.error(`Warning: Failed to package standalone files for ${folderName}:`, zipErr);
  }
  if (hasStandaloneDir) {
    hasStandalone = true;
    const standaloneZipPath = path.join(companyPath, 'standalone.zip');
    // Collect source paths for fast-path mtime check
    let shouldBuildStandalone = true;
    try {
      const saSourcePaths = [];
      const saSourceNames = [];
      for (const file of fs.readdirSync(standalonePath)) {
        const fp = path.join(standalonePath, file);
        if (fs.statSync(fp).isFile()) {
          saSourcePaths.push(fp);
          saSourceNames.push(file);
        }
      }
      const saRevisedPath = path.join(companyPath, 'revised schd', 'standalone');
      if (fs.existsSync(saRevisedPath) && fs.statSync(saRevisedPath).isDirectory()) {
        for (const file of fs.readdirSync(saRevisedPath)) {
          const fp = path.join(saRevisedPath, file);
          if (fs.statSync(fp).isFile()) {
            saSourcePaths.push(fp);
            saSourceNames.push(`revised schd/${file}`);
          }
        }
      }
      const saStdPath = path.join(companyPath, 'standard', 'standalone');
      if (fs.existsSync(saStdPath) && fs.statSync(saStdPath).isDirectory()) {
        for (const file of fs.readdirSync(saStdPath)) {
          const fp = path.join(saStdPath, file);
          if (fs.statSync(fp).isFile()) {
            saSourcePaths.push(fp);
            saSourceNames.push(`standard/${file}`);
          }
        }
      }
      // Fast-path: skip read+hash+build if ZIP is newer than all sources
      shouldBuildStandalone = !await zipUpToDate(standaloneZipPath, saSourcePaths, saSourceNames);
    } catch (scanErr) {
      console.warn(`Warning: ZIP fast-path pre-scan failed for standalone files for ${folderName}; rebuilding:`, scanErr.message);
    }
    if (shouldBuildStandalone) {
      try {
        const entries = [];
        for (const file of fs.readdirSync(standalonePath)) {
          const fp = path.join(standalonePath, file);
          if (fs.statSync(fp).isFile()) {
            entries.push({ name: file, data: fs.readFileSync(fp) });
          }
        }
        const saRevisedPath2 = path.join(companyPath, 'revised schd', 'standalone');
        if (fs.existsSync(saRevisedPath2)) {
          for (const file of fs.readdirSync(saRevisedPath2)) {
            const fp = path.join(saRevisedPath2, file);
            if (fs.statSync(fp).isFile()) {
              entries.push({ name: `revised schd/${file}`, data: fs.readFileSync(fp) });
            }
          }
        }
        const saStdPath2 = path.join(companyPath, 'standard', 'standalone');
        if (fs.existsSync(saStdPath2)) {
          for (const file of fs.readdirSync(saStdPath2)) {
            const fp = path.join(saStdPath2, file);
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
    }
  } else if (fs.existsSync(path.join(companyPath, 'standalone.zip'))) {
    hasStandalone = true;
  }

  return hasStandalone;
}

async function run() {
  if (!fs.existsSync(companiesDir)) {
    console.error('Error: Companies directory does not exist!');
    process.exit(1);
  }

  // Phase 1: Load metadata and discover new folders
  const metadataMap = loadMetadata();
  const items = fs.readdirSync(companiesDir);
  let newCompanies = 0;

  for (const item of items) {
    const itemPath = path.join(companiesDir, item);
    if (!fs.statSync(itemPath).isDirectory()) continue;
    if (metadataMap.has(item)) continue;

    // New folder without metadata entry — auto-add with inferred values
    const inferred = inferMetadata(item);
    metadataMap.set(item, inferred);
    newCompanies++;
    console.warn(
      `\n\u26a0  NEW COMPANY: "${item}"\n` +
      `   Inferred: ticker=${inferred.ticker}, type=${inferred.type}\n` +
      `   ACTION REQUIRED: Verify the NSE ticker in companies-metadata.json\n`
    );
  }

  // Remove stale entries (folder deleted from disk)
  for (const folder of metadataMap.keys()) {
    const folderPath = path.join(companiesDir, folder);
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      console.warn(`WARN Removing stale metadata entry for "${folder}" (folder no longer exists)`);
      metadataMap.delete(folder);
    }
  }

  // Save updated companies-metadata.json if anything changed
  if (CHECK_MODE) {
    // In check mode, verify that metadata and registry are up-to-date without writing
    const arr = [...metadataMap.values()].sort((a, b) =>
      a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0
    );
    const expectedJson = JSON.stringify(arr, null, 2) + '\n';
    if (fs.existsSync(metadataFile)) {
      const existing = fs.readFileSync(metadataFile, 'utf8');
      if (existing !== expectedJson) {
        console.error('CHECK FAILED: companies-metadata.json is out of date. Run `node sync-companies.cjs` to update.');
        process.exit(1);
      }
    }
  } else if (saveMetadata(metadataMap)) {
    console.log(`+ Updated companies-metadata.json (${metadataMap.size} entries)`);
  }

  // Phase 2: Package ZIPs and build registry.json
  // Load existing registry to preserve blob URLs.
  let existingRegistry = [];
  if (fs.existsSync(registryFile)) {
    try {
      existingRegistry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    } catch (e) {
      console.warn("Warning: Could not read existing registry.json:", e.message);
    }
  }
  const existingByFolder = new Map(existingRegistry.map(c => [c.folder, c]));

  const companyList = [];

  for (const [folder, meta] of metadataMap) {
    const folderPath = path.join(companiesDir, folder);
    if (!fs.existsSync(folderPath)) continue;

    const hasStandalone = CHECK_MODE
      ? fs.existsSync(path.join(folderPath, 'standalone.zip'))
        || fs.existsSync(path.join(folderPath, 'standalone'))
      : await syncAndPackCompany(folder);
    const company = { folder, ...meta, hasStandalone };

    // Preserve blob URLs from previous registry
    const existing = existingByFolder.get(folder);
    if (existing) {
      if (existing.blobUrl) company.blobUrl = existing.blobUrl;
      if (existing.standaloneBlobUrl) company.standaloneBlobUrl = existing.standaloneBlobUrl;
      if (existing.qualityIndicatorsBlobUrl) company.qualityIndicatorsBlobUrl = existing.qualityIndicatorsBlobUrl;
      if (existing.sidecarBlobs) company.sidecarBlobs = existing.sidecarBlobs;
    }

    companyList.push(company);
  }

  // Byte-order sort for cross-OS deterministic registry.json
  companyList.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Idempotent write - only touch the file if the JSON actually changed.
  const newJson = JSON.stringify(companyList, null, 2) + "\n";
  if (CHECK_MODE) {
    if (fs.existsSync(registryFile)) {
      const existing = fs.readFileSync(registryFile, 'utf8');
      if (existing !== newJson) {
        console.error('CHECK FAILED: registry.json is out of date. Run `node sync-companies.cjs` to update.');
        process.exit(1);
      }
    } else {
      console.error('CHECK FAILED: registry.json does not exist. Run `node sync-companies.cjs` to generate.');
      process.exit(1);
    }
    console.log(`Registry check passed (${companyList.length} companies).`);
  } else {
    let changed = true;
    if (fs.existsSync(registryFile)) {
      const existing = fs.readFileSync(registryFile, 'utf8');
      if (existing === newJson) changed = false;
    }
    if (changed) {
      fs.writeFileSync(registryFile, newJson);
      console.log(`\nRegistry compiled. Wrote ${companyList.length} companies to registry.json\n`);
    } else {
      console.log(`\nRegistry already up to date (${companyList.length} companies). No write needed.\n`);
    }
  }
}

const CHECK_MODE = process.argv.includes('--check');

run().catch(err => {
  console.error('Registry sync failed:', err);
  process.exit(1);
});
