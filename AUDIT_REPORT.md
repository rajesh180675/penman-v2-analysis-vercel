# End-to-End Audit Report — penman-v2-analysis

**Date:** June 2026  
**Scope:** Data layer → Ingestion → Pipeline → Config/Symbol wiring → Tab routing → UI rendering → Edge cases  

---

## CRITICAL (will cause visible user-facing errors or dead-ends)

### C1. Insurance (LIC) — complete dead-end, no usable analysis tab

**Files:** `App.tsx` L876, L558-562, L575, L940-948

When LIC data is loaded:
- `scopeBlocked = true` (insurance is unsupported), `hasRecast = false`, `bankResult = null`
- `visibleTabs`: "statements"/"dashboard"/"ratios"/etc. all hidden (`needsData` + `!hasRecast`), "bank" hidden (no bankResult)
- "valuation" tab is VISIBLE because `financialFallbackAvailable = true`, but its rendering path checks `bankResult` at L876 — `bankResult` is null for insurance — so it falls through to L940: **"No data loaded"**
- After `handleDataSubmit`, `activeTab = "statements"` (hidden), bank auto-redirect doesn't fire (no bankResult), debug redirect doesn't fire (`financialFallbackAvailable = true`)
- **Result:** User is on a hidden tab seeing "No data loaded", with only "Debug" and "Valuation" visible — both dead-ends.

**Fix:** Add an insurance-specific rendering path, or redirect insurance to debug with a clear message: "Insurance companies are not yet supported by the analysis pipeline."

---

### C2. Dashboard tab hidden for all banks/NBFCs

**File:** `App.tsx` L575, L60

`visibleTabs` filters: `if (t.needsData) return hasRecast`. Dashboard has `needsData: true`. Banks never produce `hasRecast = true` (they produce `bankResult` instead). So the Dashboard tab is completely hidden for every bank and NBFC company — ICICI Bank, HDFC Bank, Bajaj Finance, SBI, etc. can never access the dashboard.

**Fix:** Add bank-aware visibility: `if (t.id === "dashboard") return hasRecast || bankResult !== null;`

---

### C3. LIC ticker wrong: "LIFI" in CompanyLibraryGrid vs "LICI" in NSE_SYMBOL_REGISTRY

**File:** `CompanyLibraryGrid.tsx` L91

The library grid stores `ticker: "LIFI"` for LIC. The NSE symbol registry maps to `"LICI"` (the correct NSE ticker). When the user picks LIC from the dropdown, `LIFI` is used as `market_data_symbol`, causing the NSE proxy to query `LIFI` — which is not a valid NSE symbol. Live market data will always fail for LIC.

**Fix:** Change `ticker: "LIFI"` to `ticker: "LICI"` in CompanyLibraryGrid.tsx.

---

### C4. Ratio sanity checks non-functional for auto-detected banks/NBFCs

**Files:** `pipeline.ts` L117-136, `ratioSanity.ts` L191+

When `company_type = "auto"` (the default), `evaluateRatioSanity` routes to the **industrial** branch, checking ROCE/RNOA/PM/FLEV bands. Bank/NBFC-specific bands (NIM 2-4.5%, ROA 0.5-2%, etc.) are never applied. Since the bank pipeline correctly identifies the company as financial-institution, the sanity checker should use the detected `subtype` from the bank pipeline, not `config.company_type`.

**Impact:** All auto-detected banks/NBFCs get `ratioSanity.status = "n/a"` — no sanity checks are applied. This defeats the rigor ladder for financial institutions.

**Fix:** Pass `bankResult.subtype` to `evaluateRatioSanity` when `company_type === "auto"` and `bankResult` exists.

---

### C5. "Fee and Commission Income" in NBFC signal group causes false positives for industrials

**File:** `scopePolicy.ts` L83

"Fee and Commission Income" is included in the NBFC signal group. This is a generic line item present in many industrial companies (ITC, Reliance, holding companies). Even Rs.1 Cr of trivial fee income triggers an NBFC signal because `isMaterialValue` threshold is `abs > 0.0001`.

**Impact:** An industrial company with immaterial fee income could accumulate enough NBFC signals to be misrouted to the financial-institution pipeline.

**Fix:** Either remove "Fee and Commission Income" from the NBFC signal group, or add a materiality threshold (e.g., must exceed 5% of total income to count as an NBFC signal).

---

## HIGH (significant functional gaps or incorrect behavior)

### H1. `casaRatio` always null — declared but never computed

**File:** `bankPipeline.ts` L65, L254, L273-369

`BankPeriodMetrics.casaRatio` is declared in the interface and initialized to `null` at L254, but `computeBankRatios()` never computes it. The CASA data IS available from the quality sidecar (`quality.casa_pct`), but sidecar values are only joined to `m.quality` — never bridged into `m.casaRatio`.

**Impact:** Any UI card or metric table reading `casaRatio` from the pipeline always shows "n/a" or blank.

**Fix:** In `computeBankRatios`, after joining quality data, set `m.casaRatio = m.quality?.casa_pct ?? null;`

---

### H2. Quality sidecar never forwarded through `scopeAwareLoader`

**File:** `scopeAwareLoader.ts` L198

`processScopeAwareData` calls `processCompanyDataFull(consolidatedData, config)` without the `BankQualityIndicators` parameter. The 3rd argument defaults to `null`.

**Impact:** Consolidated+standalone bank analysis (used for SOTP validation of HDFC, ICICI etc.) always gets `bankResult.assetQuality` with skip-with-reason on every signal. Asset-quality signals are completely absent in the scope-aware path.

**Fix:** Add `quality` parameter to `processScopeAwareData` signature and forward it to `processCompanyDataFull`.

---

### H3. Bank/NBFC pipeline produces `periods: []` — breaks scopeAwareLoader subsidiary analysis

**File:** `pipeline.ts` L110-138

When `family === "financial-institution"`, `PipelineResult.periods` is always `[]`. The `scopeAwareLoader` at L226 calls `consolidatedResult.periods.map(p => extractMetrics(p))` — for a bank, this produces an empty array. ALL subsidiary contribution analysis is impossible for consolidated bank entities.

**Fix:** Either have the bank pipeline populate `periods` with minimal RecastPeriod entries, or have `scopeAwareLoader` use `bankResult.bankMetrics` when `periods` is empty.

---

### H4. 9 of 13 companies missing `quality_indicators.json` sidecar

**Files:** `public/data/companies/` directories

Only 4 of 13 company directories have `quality_indicators.json`: HDFC bank, ICICI bank, KOTAKBANK, SBIN. The other 9 (ITC, Bajaj Finance, LIC, Paytm, Power Grid, Reliance, TCS, Tata Steel, Vodafone Idea) are missing it.

**Impact:** The bank quality panel always shows the "No quality_indicators.json sidecar found" amber banner for most companies. For Bajaj Finance (NBFC), this is especially critical — its key quality metrics (NPA, PCR) are unavailable.

**Fix:** Create quality_indicators.json files for all financial-institution companies (Bajaj Finance at minimum). Non-financial companies don't need it.

---

## MEDIUM (distortions, missing features, or degraded UX)

### M1. Bank load flashes "No data loaded" before auto-redirect to bank tab

**Files:** `App.tsx` L455, L558-562

`handleDataSubmit` always sets `activeTab("statements")` at L455. For banks, `hasRecast = false`, so the "statements" rendering at L870 is skipped, and the L940 fallback shows "No data loaded". The auto-redirect effect at L558 fires on the next render cycle, switching to "bank" tab. This creates a visible flash of the "No data loaded" screen.

**Fix:** In `handleDataSubmit`, detect financial-institution scope and set `activeTab("bank")` directly instead of "statements". Or use `flushSync` / `startTransition` to avoid the intermediate render.

---

### M2. `payoutRatio` never forwarded to DDM model — always uses 30% default

**Files:** `bankPipeline.ts` L477-479, `bankValuation.ts` L247-252

`computeBankValuation` accepts a 4th parameter `payoutRatio` (defaults to `null`), but `processBankData` never passes it. The DDM model always uses the hardcoded 30% payout assumption.

**Impact:** DDM is inaccurate for PSU banks (20-25% actual payout) and mature private banks (35-50% payout).

---

### M3. CRAR-as-proxy for Tier-1 uses fixed 2pp spread — can produce false "breach" severity

**File:** `bankAssetQuality.ts` L392-397

When no Tier-1 data exists, `baseRatio = crarFound.value - 2` (approximating Tier-1 as CRAR minus 2pp). If CRAR is low (e.g., 10%), `baseRatio = 8`, and `headroom = 8 - 9.5 = -1.5` → severity "breach". But the bank may actually have Tier-1 of 9.2% (adequate-to-thin). The 2pp approximation is too aggressive.

**Fix:** Use a smaller spread (e.g., 1.5pp) or flag the result as "approximated" with lower confidence.

---

### M4. NBFC borrowings fallback creates inconsistent `avgBorrowings` at period boundaries

**File:** `bankPipeline.ts` L288-289, L296

When `isNbfcFraming` and `borrowings` is null, fallback computes `borrowings = totalAssets - totalEquity`. But `prev.borrowings` may be null (if the previous period was bank-framed), so `avgBorrowings = avg(proxyValue, null) = proxyValue`. This silently inflates the average denominator for a single period.

---

### M5. `avg()` helper silently degrades to point-estimate when one operand is null

**File:** `bankPipeline.ts` L154-157

```ts
function avg(a, b) { if (a == null || b == null) return a ?? b; return (a + b) / 2; }
```

When one operand is null, returns the non-null value instead of averaging. All average-based ratios (ROA, NIM) use point-in-time values rather than averages for the first period or when previous data is missing.

**Impact:** Distorted ratios for growing balance sheets. No flag or caveat is surfaced.

---

### M6. Case-inconsistent directory names — will break on Linux/Vercel

**Files:** `public/data/companies/` directories

6 folders use inconsistent case: `HDFC bank` (not "Bank"), `ICICI bank`, `bajaj finance`, `reliance Industries`, `Tata steel`, `paytm`. Works on Windows but will break on case-sensitive OS (Linux Vercel deployment).

**Fix:** Standardize to title case, or add lower-case aliases.

---

### M7. 28 duplicate XLS files with "(1)"/"(2)" suffixes in data directories

Multiple company directories contain duplicate Capitaline downloads (e.g., `SegmentFinance_ (1).xls`). The ZIP packager may pick these up and create duplicate periods.

---

### M8. KOTAKBANK and SBIN have no XLS files or ZIPs — only quality_indicators.json

These directories have no financial statement data. Loading them would produce a blank pipeline result with no metrics.

---

## LOW (code quality, dead code, misleading comments)

### L1. `nii > interestEarned` check is dead code — always false after `Math.abs()`

**File:** `bankPipeline.ts` L226

`nii = interestEarned - Math.abs(interestExpended)`. Since `Math.abs() >= 0`, `nii <= interestEarned` always. The guard `if (nii > interestEarned) nii = null` never triggers.

---

### L2. Misleading comment in `detectSubtype` — code is correct

**File:** `bankPipeline.ts` L373-389

Comment says "Require >= 2 distinct banking labels before declaring 'bank'", but the code also accepts `bankingCount === 1` when `nbfcCount === 0`. The code behavior is reasonable; only the comment is misleading.

---

### L3. `paytm/revised schd/` is an empty directory

No files — no impact on functionality but should be cleaned up.

---

### L4. `HDFC bank/Standalone/` uses capital "S" vs lowercase `standalone/` everywhere else

Minor inconsistency; the ZIP parser may need case-aware directory walking.

---

## Summary Table

| ID | Severity | Area | Bug |
|----|----------|------|-----|
| C1 | CRITICAL | Tab routing | Insurance (LIC) dead-end — no usable analysis tab |
| C2 | CRITICAL | Tab visibility | Dashboard hidden for all banks/NBFCs |
| C3 | CRITICAL | Data/Symbol | LIC ticker "LIFI" should be "LICI" |
| C4 | CRITICAL | Pipeline | Ratio sanity non-functional for auto-detected banks |
| C5 | CRITICAL | Scope policy | "Fee and Commission Income" false positive for industrials |
| H1 | HIGH | Bank pipeline | casaRatio always null (never computed) |
| H2 | HIGH | Scope-aware loader | Quality sidecar never forwarded — asset-quality always skips |
| H3 | HIGH | Pipeline | `periods: []` for banks breaks subsidiary analysis |
| H4 | HIGH | Data files | 9/13 companies missing quality_indicators.json |
| M1 | MEDIUM | UX | Bank load flashes "No data loaded" before redirect |
| M2 | MEDIUM | Valuation | DDM payoutRatio never forwarded (always 30%) |
| M3 | MEDIUM | Asset quality | CRAR-proxy Tier-1 can produce false "breach" |
| M4 | MEDIUM | Bank pipeline | NBFC borrowings fallback inconsistent avgBorrowings |
| M5 | MEDIUM | Bank pipeline | avg() silently degrades to point-estimate |
| M6 | MEDIUM | Data files | Case-inconsistent directory names (breaks on Linux) |
| M7 | MEDIUM | Data files | 28 duplicate XLS files in company directories |
| M8 | MEDIUM | Data files | KOTAKBANK/SBIN have no financial statement data |
| L1 | LOW | Dead code | `nii > interestEarned` check unreachable |
| L2 | LOW | Comment | Misleading detectSubtype comment |
| L3 | LOW | Housekeeping | Empty `paytm/revised schd/` directory |
| L4 | LOW | Housekeeping | Inconsistent Standalone/ vs standalone/ casing |
