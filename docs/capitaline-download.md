# Capitaline Download Guide

**Last updated:** 22-May-2026

## Folder Structure

Once downloaded, files must be organized as follows:

```
public/data/companies/<Company Name>/
├── BalanceSheetINDAS_.xls          # Consolidated (Detailed)
├── ProfitLossINDAS_.xls            # Consolidated (X-Detail)
├── CashFlow_.xls                   # Consolidated (Detailed)
├── SegmentFinance_.xls             # Consolidated — Product (Detailed)
├── SegmentFinance_ (1).xls         # Consolidated — Geographic (Detailed)
├── SegmentFinance_ (2).xls         # Consolidated — Mixed (Detailed)
├── standalone/
│   ├── BalanceSheetINDAS_.xls      # Standalone (Detailed)
│   ├── ProfitLossINDAS_.xls        # Standalone (X-Detail)
│   ├── CashFlow_.xls               # Standalone (Detailed)
│   ├── SegmentFinance_.xls         # Standalone — Product (Detailed)
│   ├── SegmentFinance_ (1).xls     # Standalone — Geographic (Detailed)
│   └── SegmentFinance_ (2).xls     # Standalone — Mixed (Detailed)
├── standard/                       # Empty placeholder
```

**Key rules:**
- Consolidated files → directly in company folder
- Standalone files → `standalone/` subfolder
- Never mix the two — download all consolidated first, move them, THEN download standalone
- Delete leftover files from Downloads between phases

## Layout Settings per Statement

| Statement | Scope | Tab | Detail Level |
|-----------|-------|-----|-------------|
| Balance Sheet | Consol → Standalone | Ind-AS | `det` (Detailed) |
| Profit & Loss | Consol → Standalone | Ind-AS | `xdet` (X-Detail) |
| Cash Flow | Consol → Standalone | Ind-AS | `det` (Detailed) |
| Segment Finance | Consol → Standalone | — | `Detailed` (text value) |

**Note:** Segment Finance uses text values (`"Detailed"`) not short codes (`"det"`).  
**Note:** Cash Flow only has Condensed / Detailed options (no X-Detail).

## Segment Finance — Three Report Types

For **each scope** (Consolidated and Standalone), download all 3 report types:

1. **Segment Product** → `SegmentFinance_.xls`
2. **Segment Geographic** → `SegmentFinance_ (1).xls`
3. **Segment Mixed** → `SegmentFinance_ (2).xls`

Set `BS.reporttype` dropdown (select[9]) to each value before clicking GO and downloading.

## How to Find Companies on Capitaline

Use **BSE codes** for reliable search — company name search often shows subsidiaries instead.

| Company | BSE Code | NSE Code |
|---------|:--------:|:--------:|
| Hindustan Unilever | 500696 | HINDUNILVR |
| Sun Pharma | 524715 | SUNPHARMA |
| Maruti Suzuki | 532500 | MARUTI |
| Larsen & Toubro | 500510 | LT |
| UltraTech Cement | 532538 | ULTRACEMCO |

Type the BSE code into the "Enter Company Name" search box — Capitaline will show the correct company in the dropdown.

## Download Sequence (per Company)

### Phase 1 — Consolidated (all 6 files)
1. Search company by BSE code, click to navigate
2. `Finance → Balance Sheet`
3. Click **Ind-AS** tab
4. Set dropdowns:
   - `BS.isConsolidate` (select[7]) → `true` (Consolidated)
   - `BS.firstValue` (select[8]) → `det` (Detailed)
5. Click **GO**
6. Click Excel download icon (.fa-file-excel-o)
7. Wait for file to appear in Downloads folder
8. Move BALANCE SHEET then `Profit & Loss`:
   - Same as BS but `BS.firstValue` → `xdet` (X-Detail)
9. `Cash Flow`:
   - Same as BS but (Cash Flow only has Condensed/Detailed — choose `det`)
10. `Segment Finance` × 3:
    - Set `BS.isConsolidate` → `true`
    - Set `BS.firstValue` → `Detailed` (text value, NOT "det")
    - Set `BS.reporttype` → `Segment Product`, click **GO**, download
    - Set `BS.reporttype` → `Segment Geographic`, click **GO**, download
    - Set `BS.reporttype` → `Segment Mixed`, click **GO**, download

### Phase 2 — Move Consolidated
```bash
mkdir -p "public/data/companies/<Company Name>/standalone"
mv /c/Users/rajesh/Downloads/BalanceSheetINDAS_.xls "public/data/companies/<Company Name>/"
mv /c/Users/rajesh/Downloads/ProfitLossINDAS_.xls "..."
mv /c/Users/rajesh/Downloads/CashFlow_.xls "..."
mv /c/Users/rajesh/Downloads/SegmentFinance_.xls "..."
mv '/c/Users/rajesh/Downloads/SegmentFinance_ (1).xls' "..."
mv '/c/Users/rajesh/Downloads/SegmentFinance_ (2).xls' "..."
```

### Phase 3 — Standalone (all 6 files)
Repeat same sequence as Phase 1 but:
- `BS.isConsolidate` → `false` (Standalone) — no need to change if defaulting
- Do NOT touch BS.isConsolidate (stays on Standalone)
- Same layout settings (BS=det, PL=xdet, CF=det, Segment=Detailed)

### Phase 4 — Move Standalone
```bash
mv /c/Users/rajesh/Downloads/BalanceSheetINDAS_.xls "public/data/companies/<Company Name>/standalone/"
mv /c/Users/rajesh/Downloads/ProfitLossINDAS_.xls ".../standalone/"
mv /c/Users/rajesh/Downloads/CashFlow_.xls ".../standalone/"
mv /c/Users/rajesh/Downloads/SegmentFinance_.xls ".../standalone/"
mv '/c/Users/rajesh/Downloads/SegmentFinance_ (1).xls' ".../standalone/"
mv '/c/Users/rajesh/Downloads/SegmentFinance_ (2).xls' ".../standalone/"
```

## Pacing Rules (avoid duplicates)

- Click download **ONCE** per file
- Wait 3–5 seconds for the file to appear in Downloads before taking any next action
- If you don't see the file after 5 seconds, check the page heading first — the download may have been triggered but the browser hasn't flushed it to disk yet
- Never click download a second time unless you've verified the first didn't work
- If a duplicate appears (e.g., `BalanceSheetINDAS_ (1).xls`), delete the `(1)` copy

## After All Downloads — Register the Company

```bash
# 1. Add company metadata to sync-companies.cjs
# 2. Run sync to update registry.json
node scripts/sync-companies.cjs

# 3. Validate
npx tsx scripts/validate-registry.ts

# 4. Test locally
npm run dev:local

# 5. Upload to blob storage (if deploying)
BLOB_READ_WRITE_TOKEN=... node scripts/upload-to-blob.mjs

# 6. Commit
git add .
git commit -m "feat: add <Company Name> data"
git push
```

## Troubleshooting

- **Session timeout (15 min):** "Welcome {{authentication.userName}}" template text appears. User must log in again.
- **Search shows subsidiaries not parent:** Use BSE code instead of company name.
- **Downloads producing `(1)` duplicates:** You clicked download twice. Remove the `(1)` file — both are identical.
- **Segment downloads only showing 2 files:** Some companies may not have all 3 report types. Check the `BS.reporttype` dropdown options.
- **File not appearing in Downloads:** The CDP browser may have a delay. Wait 5+ seconds, check with `ls`, then try clicking download once more.
