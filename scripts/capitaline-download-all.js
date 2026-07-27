// Capitaline Rapid Download Script
// Paste this into the Capitaline browser console after logging in and navigating to a company's Balance Sheet page.
// It automates all 7 downloads (3 Consolidated + 3 Standalone + 1 Segment) for the current company.
//
// Usage:
//   1. Log into Capitaline
//   2. Search for a company (e.g., "Hindustan Unilever")
//   3. Navigate to Finance → Balance Sheet (Ind-AS tab)
//   4. Open browser console (F12 → Console)
//   5. Paste this script and press Enter
//   6. It will download all files to your Downloads folder
//
// Settings per file type:
//   Balance Sheet: Ind-AS, Detailed
//   Profit & Loss: Ind-AS, X-Detail
//   Cash Flow: Ind-AS, Detailed
//   Segment Finance: Consolidated (no Ind-AS tab for segments)

(function capitalineDownloadAll() {
  const DELAY = 3000; // ms between actions (3 seconds)

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Select dropdown option via Angular scope
  function setDropdown(selectIdx, value) {
    const sel = document.querySelectorAll('select')[selectIdx];
    if (!sel) return Promise.reject('Select #' + selectIdx + ' not found');
    sel.value = value;
    sel.dispatchEvent(new Event('change'));
    const s = window.angular?.element(sel)?.scope?.();
    if (s) s.$apply();
    return wait(DELAY);
  }

  // Click the Ind-AS tab
  function clickIndAS() {
    const link = [...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Ind-AS');
    if (link) link.click();
    return wait(DELAY);
  }

  // Click the Excel download icon
  function downloadExcel() {
    const icon = document.querySelector('.fa-file-excel-o');
    if (icon) icon.parentElement.click();
    return wait(DELAY);
  }

  // Click a finance sidebar link by text
  function clickSidebarLink(text) {
    const link = [...document.querySelectorAll('a')].find(a => a.textContent.trim() === text);
    if (link) link.click();
    return wait(DELAY);
  }

  // Click GO button
  function clickGO() {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'GO');
    if (btn) btn.click();
    return wait(DELAY);
  }

  // Set detail level: 'det' = Detailed, 'xdet' = X-Detail, 'Condensed' = Condensed
  function setDetailLevel(level) {
    return setDropdown(8, level); // select[8] = BS.firstValue
  }

  // Set Consolidated/Standalone: 'true' = Consolidated, 'false' = Standalone
  function setConsolidated(val) {
    return setDropdown(7, val); // select[7] = BS.isConsolidate
  }

  // Get current heading
  function getHeading() {
    return document.querySelector('h3')?.textContent?.trim() || 'unknown';
  }

  async function downloadStatement(statement, scope_val, detailLevel) {
    console.log(`[CAP-DL] Navigating to ${statement} (${scope_val === 'true' ? 'Consolidated' : 'Standalone'}, detail=${detailLevel})...`);
    
    // Click the statement link in sidebar
    await clickSidebarLink(statement);
    
    // Click Ind-AS tab (for BS, PL, CF — not Segment)
    if (statement !== 'Segment Finance') {
      await clickIndAS();
    }
    
    // Set Consolidated/Standalone
    await setConsolidated(scope_val);
    
    // Set detail level (not for Segment Finance)
    if (statement !== 'Segment Finance') {
      await setDetailLevel(detailLevel);
    }
    
    // Click GO to apply changes
    await clickGO();
    
    // Wait for data to load
    await wait(DELAY * 2);
    
    // Verify heading
    const heading = getHeading();
    console.log(`[CAP-DL] Heading: ${heading.substring(0, 70)}`);
    
    // Download Excel
    await downloadExcel();
    console.log(`[CAP-DL] ✓ Downloaded ${statement} (${scope_val === 'true' ? 'Consolidated' : 'Standalone'})`);
    
    await wait(DELAY);
  }

  async function run() {
    console.log('[CAP-DL] ===== Starting Capitaline Rapid Download =====');
    console.log('[CAP-DL] Company: ' + (document.querySelector('h1')?.textContent?.trim() || 'unknown'));
    
    try {
      // === CONSOLIDATED DOWNLOADS ===
      console.log('[CAP-DL] --- Consolidated ---');
      
      // 1. Balance Sheet (Consolidated, Ind-AS, Detailed)
      await downloadStatement('Balance Sheet', 'true', 'det');
      
      // 2. Profit & Loss (Consolidated, Ind-AS, X-Detail)
      await downloadStatement('Profit & Loss', 'true', 'xdet');
      
      // 3. Cash Flow (Consolidated, Ind-AS, Detailed)
      await downloadStatement('Cash Flow', 'true', 'det');
      
      // 4. Segment Finance (Consolidated)
      await downloadStatement('Segment Finance', 'true', 'det');
      
      // === STANDALONE DOWNLOADS ===
      console.log('[CAP-DL] --- Standalone ---');
      
      // 5. Balance Sheet (Standalone, Ind-AS, Detailed)
      await downloadStatement('Balance Sheet', 'false', 'det');
      
      // 6. Profit & Loss (Standalone, Ind-AS, X-Detail)
      await downloadStatement('Profit & Loss', 'false', 'xdet');
      
      // 7. Cash Flow (Standalone, Ind-AS, Detailed)
      await downloadStatement('Cash Flow', 'false', 'det');
      
      console.log('[CAP-DL] ===== ALL DOWNLOADS COMPLETE =====');
      console.log('[CAP-DL] Check your Downloads folder for 7 .xls files');
    } catch (err) {
      console.error('[CAP-DL] ERROR:', err);
    }
  }

  run();
})();
