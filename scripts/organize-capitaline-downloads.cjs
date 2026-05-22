#!/usr/bin/env node
// organize-capitaline-downloads.js
// Moves Capitaline .xls downloads into the correct company folder structure
// under public/data/companies/<CompanyName>/
//
// Usage:
//   node scripts/organize-capitaline-downloads.js "Hindustan Unilever" "Infosys" ...
//
// It expects files in the Downloads folder with these names:
//   BalanceSheetINDAS_.xls  → <Company>/BalanceSheetINDAS_.xls  (consolidated)
//   ProfitLossINDAS_.xls    → <Company>/ProfitLossINDAS_.xls    (consolidated)
//   CashFlow_.xls           → <Company>/CashFlow_.xls           (consolidated)
//   SegmentFinance_.xls     → <Company>/SegmentFinance_.xls     (product)
//   SegmentFinance_ (1).xls → <Company>/SegmentFinance_ (1).xls (geographic)
//   SegmentFinance_ (2).xls → <Company>/SegmentFinance_ (2).xls (mixed)
//
// For standalone, you must re-download after switching to Standalone.
// The script handles duplicate filenames by checking if the consolidated version
// already exists in the company folder.

const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads');
const COMPANIES_DIR = path.join(__dirname, '..', 'public', 'data', 'companies');

// Capitaline download filenames and their target structure
const CONSOLIDATED_FILES = [
  'BalanceSheetINDAS_.xls',
  'ProfitLossINDAS_.xls',
  'CashFlow_.xls',
  'SegmentFinance_.xls',
  'SegmentFinance_ (1).xls',
  'SegmentFinance_ (2).xls',
  'Investment_.xls',
];

const STANDALONE_FILES = [
  'BalanceSheetINDAS_.xls',
  'ProfitLossINDAS_.xls',
  'CashFlow_.xls',
];

function organizeCompany(companyName) {
  const companyDir = path.join(COMPANIES_DIR, companyName);
  const standaloneDir = path.join(companyDir, 'standalone');
  
  // Create directories
  if (!fs.existsSync(companyDir)) {
    fs.mkdirSync(companyDir, { recursive: true });
    console.log(`[ORG] Created: ${companyDir}`);
  }
  
  console.log(`\n[ORG] === Organizing downloads for: ${companyName} ===`);
  console.log(`[ORG] Downloads dir: ${DOWNLOADS_DIR}`);
  console.log(`[ORG] Target dir:    ${companyDir}`);
  
  // Check what's in Downloads
  const downloads = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.endsWith('.xls'));
  console.log(`[ORG] .xls files in Downloads: ${downloads.join(', ') || '(none)'}`);
  
  // Move consolidated files
  let movedConsolidated = 0;
  for (const filename of CONSOLIDATED_FILES) {
    const src = path.join(DOWNLOADS_DIR, filename);
    const dst = path.join(companyDir, filename);
    if (fs.existsSync(src)) {
      // Don't overwrite if already exists (might be standalone version)
      if (fs.existsSync(dst)) {
        console.log(`[ORG] SKIP (already exists): ${filename} → ${companyName}/`);
      } else {
        fs.copyFileSync(src, dst);
        fs.unlinkSync(src);
        console.log(`[ORG] ✓ Consolidated: ${filename} → ${companyName}/`);
        movedConsolidated++;
      }
    }
  }
  
  // Move standalone files (these come AFTER consolidated since they overwrite the download filename)
  // Strategy: after downloading standalone versions, the filenames are the SAME
  // but the content is standalone. We move them to standalone/ subfolder.
  // The user should download consolidated FIRST, then standalone.
  // If a consolidated file already exists, the remaining download IS standalone.
  let movedStandalone = 0;
  for (const filename of STANDALONE_FILES) {
    const src = path.join(DOWNLOADS_DIR, filename);
    if (fs.existsSync(src)) {
      // If consolidated already placed, this remaining file must be standalone
      if (!fs.existsSync(standaloneDir)) {
        fs.mkdirSync(standaloneDir, { recursive: true });
      }
      const dst = path.join(standaloneDir, filename);
      fs.copyFileSync(src, dst);
      fs.unlinkSync(src);
      console.log(`[ORG] ✓ Standalone: ${filename} → ${companyName}/standalone/`);
      movedStandalone++;
    }
  }
  
  // Segment files (1) and (2)
  for (const filename of ['SegmentFinance_ (1).xls', 'SegmentFinance_ (2).xls']) {
    const src = path.join(DOWNLOADS_DIR, filename);
    const dst = path.join(companyDir, filename);
    if (fs.existsSync(src)) {
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
        fs.unlinkSync(src);
        console.log(`[ORG] ✓ Segment: ${filename} → ${companyName}/`);
      } else {
        console.log(`[ORG] SKIP (already exists): ${filename}`);
      }
    }
  }
  
  // Investment
  const invSrc = path.join(DOWNLOADS_DIR, 'Investment_.xls');
  const invDst = path.join(companyDir, 'Investment_.xls');
  if (fs.existsSync(invSrc) && !fs.existsSync(invDst)) {
    fs.copyFileSync(invSrc, invDst);
    fs.unlinkSync(invSrc);
    console.log(`[ORG] ✓ Investment: Investment_.xls → ${companyName}/`);
  }
  
  console.log(`[ORG] Result: ${movedConsolidated} consolidated + ${movedStandalone} standalone files moved`);
  
  // List what's in the company folder now
  const placed = [];
  if (fs.existsSync(companyDir)) {
    const items = fs.readdirSync(companyDir);
    for (const item of items) {
      if (item.endsWith('.xls') || item.endsWith('.json') || item.endsWith('.zip') || item === 'standalone') {
        placed.push(item);
      }
    }
  }
  console.log(`[ORG] Files in ${companyName}/: ${placed.join(', ')}`);
}

// Main
const companies = process.argv.slice(2);
if (companies.length === 0) {
  console.error('Usage: node organize-capitaline-downloads.js "Company Name 1" "Company Name 2" ...');
  console.error('Example: node organize-capitaline-downloads.js "Hindustan Unilever" "Infosys"');
  process.exit(1);
}

for (const company of companies) {
  organizeCompany(company);
}

console.log('\n[ORG] === Next steps ===');
console.log('[ORG] 1. Add company to BASELINE_METADATA in sync-companies.cjs');
console.log('[ORG] 2. Run: node sync-companies.cjs');
console.log('[ORG] 3. Run: npx tsx scripts/validate-registry.ts');
console.log('[ORG] 4. Run: BLOB_READ_WRITE_TOKEN=... node scripts/upload-to-blob.mjs');
console.log('[ORG] 5. Run: npm run dev:local  (smoke test)');
console.log('[ORG] 6. git add + commit + push');
