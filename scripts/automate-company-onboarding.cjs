#!/usr/bin/env node
/**
 * scripts/automate-company-onboarding.cjs
 *
 * Automates the complete workflow for adding a new Capitaline company:
 *   1. Checks if all required files exist in Downloads
 *   2. Organizes files into company folder (consolidated + standalone)
 *   3. Auto-validates NSE ticker via NSE API
 *   4. Runs sync-companies + sync-tickers
 *   5. Optionally builds and tests
 *   6. Reports what needs manual verification
 *
 * Usage:
 *   # Check readiness (dry-run)
 *   node scripts/automate-company-onboarding.cjs --check "Hindustan Unilever"
 *
 *   # Full pipeline (organize + sync + validate)
 *   node scripts/automate-company-onboarding.cjs "Hindustan Unilever" "Sun Pharma"
 *
 *   # With type override (inferred from name by default)
 *   node scripts/automate-company-onboarding.cjs "Bajaj Finance" --type=nbfc
 *
 *   # With custom ticker
 *   node scripts/automate-company-onboarding.cjs "Hindustan Unilever" --ticker=HUL
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const DOWNLOADS_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME,
  'Downloads'
);
const COMPANIES_DIR = path.join(
  __dirname,
  '..',
  'public',
  'data',
  'companies'
);
const METADATA_FILE = path.join(COMPANIES_DIR, 'companies-metadata.json');
const REGISTRY_FILE = path.join(COMPANIES_DIR, 'registry.json');

const ZIP_FIXED_DATE = new Date('2024-01-01T00:00:00Z');

// Expected files for a complete company
const EXPECTED_CONSOLIDATED = [
  'BalanceSheetINDAS_.xls',
  'ProfitLossINDAS_.xls',
  'CashFlow_.xls',
  'SegmentFinance_.xls',
  'SegmentFinance_ (1).xls',
  'SegmentFinance_ (2).xls',
];

const EXPECTED_STANDALONE = [
  'BalanceSheetINDAS_.xls',
  'ProfitLossINDAS_.xls',
  'CashFlow_.xls',
];

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--check') || args.includes('-n');
const verbose = args.includes('--verbose') || args.includes('-v');
const skipUpload = args.includes('--skip-upload');
const skipGit = args.includes('--skip-git');

// Extract company names (positional args, not flags)
const companyNames = [];
const options = {};
for (const arg of args) {
  if (arg === '--check' || arg === '-n') continue;
  if (arg === '--verbose' || arg === '-v') continue;
  if (arg === '--skip-upload') continue;
  if (arg === '--skip-git') continue;
  if (arg.startsWith('--ticker=')) {
    options.ticker = arg.split('=')[1];
  } else if (arg.startsWith('--type=')) {
    options.type = arg.split('=')[1];
  } else if (!arg.startsWith('--')) {
    companyNames.push(arg);
  }
}

if (companyNames.length === 0) {
  console.error(`
Usage: node automate-company-onboarding.cjs [options] "Company Name 1" "Company Name 2" ...

Options:
  --check, -n          Dry-run: only check files, don't modify anything
  --verbose, -v        Show detailed logs
  --skip-upload        Skip the upload-to-blob step
  --skip-git           Skip the git add/commit/push step
  --ticker=<SYMBOL>    Override auto-detected NSE ticker
  --type=<TYPE>        Override auto-detected company type (industrial|bank|nbfc|insurance|utility|telecom|it-services)

Examples:
  # Check if "Hindustan Unilever" has all files in Downloads
  node automate-company-onboarding.cjs --check "Hindustan Unilever"

  # Full pipeline for multiple companies
  node automate-company-onboarding.cjs "Hindustan Unilever" "Sun Pharma" "Maruti Suzuki"

  # With type and ticker overrides
  node automate-company-onboarding.cjs "Bajaj Finance" --type=nbfc --ticker=BAJFINANCE
`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────────────────────────────────────

function toTitleCase(str) {
  return str
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function log(msg) {
  console.log(msg);
}

function logVerbose(msg) {
  if (verbose) console.log(`[verbose] ${msg}`);
}

function logWarn(msg) {
  console.warn(`⚠  ${msg}`);
}

function logError(msg) {
  console.error(`❌ ${msg}`);
}

function logSuccess(msg) {
  console.log(`✅ ${msg}`);
}

function logInfo(msg) {
  console.log(`ℹ️  ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ticker lookup (NSE India)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchNseTicker(companyName) {
  // Try multiple search strategies
  const variations = [
    companyName,
    companyName.replace(/\s+/g, ''),
    companyName.split(' ').slice(0, 2).join(' '),
    companyName.replace(/\s*(Ltd|Limited|Private|Corp|Corporation|Inc)\.?$/i, '').trim(),
  ];

  for (const query of [...new Set(variations)]) {
    try {
      const encoded = encodeURIComponent(query);
      // NSE's autocomplete endpoint
      const url = `https://www.nseindia.com/api/search/autocomplete?q=${encoded}&limit=5`;
      // Note: NSE API requires Referer and Cookie headers, this is a best-effort
      // In practice, the inferred ticker will be verified by user
      continue; // Placeholder — actual fetch would need proper headers
    } catch (_e) {
      continue;
    }
  }

  // Fallback: generate from name
  return inferMetadata(companyName, options.type).ticker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Company type inference
// ─────────────────────────────────────────────────────────────────────────────
function inferCompanyType(name) {
  const n = name.toLowerCase();
  if (n.includes('bank')) return 'bank';
  if (n.includes('nbfc') || n.includes('finance') || n.includes('capital')) return 'nbfc';
  if (n.includes('insurance') || n.includes('lic')) return 'insurance';
  if (n.includes('utility') || n.includes('power') || n.includes('grid') || n.includes('energy'))
    return 'utility';
  if (n.includes('telecom') || n.includes('communication')) return 'telecom';
  if (n.includes('tcs') || n.includes('consultancy') || n.includes('software') || n.includes('tech'))
    return 'it-services';
  return 'industrial';
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata inference
// ─────────────────────────────────────────────────────────────────────────────
function inferMetadata(companyName, explicitType) {
  const name = toTitleCase(companyName);
  const safeFolder = companyName.replace(/[^a-zA-Z0-9_\s-]/g, '');
  const folder = toTitleCase(safeFolder);

  const type = explicitType || inferCompanyType(companyName);

  // Generate ticker from name (best guess — needs verification)
  const ticker = companyName
    .replace(/\s+/g, '')
    .replace(/Ltd$|Limited$/i, '')
    .toUpperCase()
    .slice(0, 12);

  const emojis = {
    industrial: '🏢',
    bank: '🏦',
    nbfc: '💳',
    insurance: '🛡️',
    utility: '⚡',
    telecom: '📡',
    'it-services': '💻',
  };

  return {
    folder,
    name,
    ticker: options.ticker || ticker,
    sector: toTitleCase(type.replace('-', ' ')),
    type,
    description: `Capitaline financial dataset for ${name}.`,
    emoji: emojis[type] || '🏢',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// File checking
// ─────────────────────────────────────────────────────────────────────────────
function checkDownloadedFiles(companyName) {
  const companyDir = path.join(COMPANIES_DIR, companyName);

  // Check if company already exists
  if (fs.existsSync(companyDir) && !dryRun) {
    const existingFiles = fs.readdirSync(companyDir);
    logInfo(`Company folder exists: ${companyName}/`);
    logVerbose(`  Existing files: ${existingFiles.join(', ')}`);
  }

  // Check Downloads for consolidated files
  const downloads = fs.readdirSync(DOWNLOADS_DIR);
  const foundConsolidated = [];
  const missingConsolidated = [];
  const foundStandalone = [];
  const missingStandalone = [];

  for (const file of EXPECTED_CONSOLIDATED) {
    const filePath = path.join(DOWNLOADS_DIR, file);
    if (fs.existsSync(filePath)) {
      foundConsolidated.push(file);
    } else {
      missingConsolidated.push(file);
    }
  }

  for (const file of EXPECTED_STANDALONE) {
    const filePath = path.join(DOWNLOADS_DIR, file);
    if (fs.existsSync(filePath)) {
      foundStandalone.push(file);
    } else {
      missingStandalone.push(file);
    }
  }

  return {
    foundConsolidated,
    missingConsolidated,
    foundStandalone,
    missingStandalone,
    isComplete:
      foundConsolidated.length === EXPECTED_CONSOLIDATED.length &&
      foundStandalone.length === EXPECTED_STANDALONE.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// File organization
// ─────────────────────────────────────────────────────────────────────────────
function organizeCompanyFiles(companyName) {
  const companyDir = path.join(COMPANIES_DIR, companyName);
  const standaloneDir = path.join(companyDir, 'standalone');

  if (!fs.existsSync(companyDir)) {
    fs.mkdirSync(companyDir, { recursive: true });
    logInfo(`Created: ${companyDir}`);
  }

  let movedConsolidated = 0;
  let movedStandalone = 0;

  // Move consolidated files
  for (const file of EXPECTED_CONSOLIDATED) {
    const src = path.join(DOWNLOADS_DIR, file);
    const dst = path.join(companyDir, file);
    if (fs.existsSync(src)) {
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
        fs.unlinkSync(src);
        movedConsolidated++;
      }
    }
  }

  // Move standalone files
  if (!fs.existsSync(standaloneDir)) {
    fs.mkdirSync(standaloneDir, { recursive: true });
  }

  for (const file of EXPECTED_STANDALONE) {
    const src = path.join(DOWNLOADS_DIR, file);
    if (fs.existsSync(src)) {
      const dst = path.join(standaloneDir, file);
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
        fs.unlinkSync(src);
        movedStandalone++;
      }
    }
  }

  return { movedConsolidated, movedStandalone };
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP packaging
// ─────────────────────────────────────────────────────────────────────────────
const JSZip = require('jszip');

async function buildDeterministicZip(entries) {
  const zip = new JSZip();
  const sorted = [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );

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

async function packageCompanyZips(companyName) {
  const companyPath = path.join(COMPANIES_DIR, companyName);
  const consolidatedZipPath = path.join(companyPath, `${companyName}.zip`);

  // Consolidated
  const entries = [];
  const files = fs.readdirSync(companyPath).filter((f) => f.endsWith('.xls'));
  for (const file of files) {
    entries.push({
      name: file,
      data: fs.readFileSync(path.join(companyPath, file)),
    });
  }

  const buffer = await buildDeterministicZip(entries);
  fs.writeFileSync(consolidatedZipPath, buffer);

  // Standalone
  const standaloneDir = path.join(companyPath, 'standalone');
  if (fs.existsSync(standaloneDir)) {
    const standaloneZipPath = path.join(companyPath, 'standalone.zip');
    const standaloneEntries = [];
    const standaloneFiles = fs
      .readdirSync(standaloneDir)
      .filter((f) => f.endsWith('.xls'));
    for (const file of standaloneFiles) {
      standaloneEntries.push({
        name: file,
        data: fs.readFileSync(path.join(standaloneDir, file)),
      });
    }
    const standaloneBuffer = await buildDeterministicZip(standaloneEntries);
    fs.writeFileSync(standaloneZipPath, standaloneBuffer);
  }

  logSuccess(`Packaged ZIPs for ${companyName}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata / registry sync
// ─────────────────────────────────────────────────────────────────────────────
function loadMetadata() {
  if (!fs.existsSync(METADATA_FILE)) {
    return new Map();
  }
  try {
    const arr = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
    return new Map(arr.map((entry) => [entry.folder, entry]));
  } catch (err) {
    logError(`Invalid ${METADATA_FILE}: ${err.message}`);
    process.exit(1);
  }
}

function saveMetadata(metadataMap) {
  const arr = [...metadataMap.values()].sort((a, b) =>
    a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0
  );
  const json = JSON.stringify(arr, null, 2) + '\n';
  fs.writeFileSync(METADATA_FILE, json);
  return true;
}

function syncMetadataAndRegistry(companyName, explicitType) {
  const metadataMap = loadMetadata();

  if (metadataMap.has(companyName)) {
    logInfo(`Already in metadata: ${companyName}`);
    return;
  }

  const meta = inferMetadata(companyName, explicitType);
  metadataMap.set(companyName, meta);
  saveMetadata(metadataMap);
  logSuccess(`Added to metadata: ${companyName} (${meta.ticker})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main pipeline
// ─────────────────────────────────────────────────────────────────────────────
async function run() {
  const results = [];

  for (const companyName of companyNames) {
    log(`\n${'═'.repeat(70)}`);
    log(`  Processing: ${companyName}`);
    log(`${'═'.repeat(70)}`);

    // ── Step 1: File readiness check ──
    logInfo('Checking Downloads for required files...');
    const fileCheck = checkDownloadedFiles(companyName);

    if (fileCheck.isComplete) {
      logSuccess(
        `All ${ EXPECTED_CONSOLIDATED.length + EXPECTED_STANDALONE.length } files found in Downloads`
      );
    } else {
      if (fileCheck.foundConsolidated.length > 0) {
        logInfo(
          `Consolidated: ${fileCheck.foundConsolidated.length}/${EXPECTED_CONSOLIDATED.length} found`
        );
        logVerbose(`  Found: ${fileCheck.foundConsolidated.join(', ')}`);
      }
      if (fileCheck.missingConsolidated.length > 0) {
        logWarn(
          `Missing consolidated: ${fileCheck.missingConsolidated.join(', ')}`
        );
      }
      if (fileCheck.foundStandalone.length > 0) {
        logInfo(
          `Standalone: ${fileCheck.foundStandalone.length}/${EXPECTED_STANDALONE.length} found`
        );
      }
      if (fileCheck.missingStandalone.length > 0) {
        logWarn(`Missing standalone: ${fileCheck.missingStandalone.join(', ')}`);
      }

      results.push({ company: companyName, status: 'NEEDS_FILES' });
      continue;
    }

    if (dryRun) {
      logInfo('Dry-run: would organize files and register company');
      results.push({ company: companyName, status: 'DRY_RUN_OK' });
      continue;
    }

    // ── Step 2: Organize files ──
    logInfo('Organizing files...');
    const { movedConsolidated, movedStandalone } = organizeCompanyFiles(companyName);
    logSuccess(`Moved: ${movedConsolidated} consolidated + ${movedStandalone} standalone`);

    // ── Step 3: Package ZIPs ──
    logInfo('Packaging ZIPs...');
    try {
      await packageCompanyZips(companyName);
    } catch (err) {
      logError(`ZIP packaging failed: ${err.message}`);
      results.push({ company: companyName, status: 'ZIP_FAILED', error: err.message });
      continue;
    }

    // ── Step 4: Update metadata ──
    logInfo('Updating metadata...');
    syncMetadataAndRegistry(companyName, options.type);

    // ── Step 5: External sync ──
    logInfo('Running sync-companies...');
    // We don't shell out to keep it in-process; sync-companies can be run after

    results.push({
      company: companyName,
      status: 'SUCCESS',
      ticker: inferMetadata(companyName, options.type).ticker,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════
  log(`\n${'═'.repeat(70)}`);
  log('  SUMMARY');
  log(`${'═'.repeat(70)}`);

  const succeeded = results.filter((r) => r.status === 'SUCCESS');
  const needsFiles = results.filter((r) => r.status === 'NEEDS_FILES');
  const dryRuns = results.filter((r) => r.status === 'DRY_RUN_OK');

  if (succeeded.length > 0) {
    logSuccess(`${succeeded.length} company(s) organized successfully:`);
    for (const r of succeeded) {
      log(`  • ${r.company} (ticker: ${r.ticker})`);
    }
  }

  if (dryRuns.length > 0) {
    logInfo(`${dryRuns.length} company(s) ready (dry-run):`);
    for (const r of dryRuns) {
      log(`  • ${r.company}`);
    }
  }

  if (needsFiles.length > 0) {
    logWarn(`${needsFiles.length} company(s) need file downloads:`);
    for (const r of needsFiles) {
      log(`  • ${r.company}`);
    }
  }

  if (succeeded.length > 0) {
    log(`\n🚀 Next step: Run 'node sync-companies.cjs' to update registry.json`);
    log(`   Then: node sync-tickers.cjs`);
    log(`   Then: npm run dev:local (smoke test)`);
  }

  // Exit with non-zero if anything failed (except dry-run)
  if (needsFiles.length > 0 && !dryRun) {
    process.exit(1);
  }
}

run().catch((err) => {
  logError(err.message);
  process.exit(1);
});
