# Bank Quality Indicators — Design Doc

**Status**: Phase B5 shipped (contract, signals, UI, App-level fetch).
Phase B5.5 (fixture data) deferred — see "Extraction strategy" below.

## Why this exists

Capitaline's static `.xls` exports for banks contain only the formal
financial statements:
- BalanceSheetINDAS (assets, liabilities, equity)
- ProfitLossINDAS (interest income, interest expended, PAT, etc.)
- CashFlow (CFO/CFI/CFF, dividends paid)

They do **NOT** contain the asset-quality and capital-adequacy indicators
that drive bank investment decisions:
- Gross NPA % / Net NPA %
- Provision Coverage Ratio (PCR)
- Capital to Risk-Weighted Assets Ratio (CRAR / CAR)
- Tier-1 ratio, CET1
- Slippage ratio (fresh slippages / opening standard advances)
- Restructured book %
- CASA % (current + savings deposits / total deposits)
- YoY advances and deposits growth

These numbers live in two places inside the Annual Report PDF:

1. **10-Year Financial Highlights table** — a real ruled table at the back
   of the AR (HDFC FY25 page 198, ICICI/SBI/Kotak similar). Carries the
   structured ratios across 10 years.
2. **Management Discussion & Analysis (MD&A)** prose — narrative text in
   the Directors' Report. Carries PCR and slippage commentary that often
   doesn't make it into the highlights table. Format example:
   > "Gross NPA Ratio stood at 1.33% as against 1.24%..."
   > "Provision Coverage Ratio was 67.92%..."

Because the data is unavailable in any Capitaline export, we need a
separate input channel — that's the sidecar JSON.

## The sidecar contract

### File location

```
public/data/companies/<CompanyFolder>/quality_indicators.json
```

The `<CompanyFolder>` matches whatever the Capitaline parser sets as
`rawData[0].company_id`. For HDFC Bank that's `HDFC Bank` (with a space).
The App fetches the file at runtime from `/data/companies/<encoded>/quality_indicators.json`.

### Resolution order

Inside `App.tsx` (Phase B5.4):

```ts
const qualityFolder =
  config.quality_data_folder    // explicit override on EngineConfig
  ?? rawData?.[0]?.company_id   // parser-detected company id
  ?? null;                       // no fetch attempted
```

Most banks resolve via the company_id path automatically. The explicit
override is for cases where the folder name diverges from the parser's
detected company_id.

### Schema (current — `2026-05-bank-quality-v1`)

```json
{
  "schema_version": "2026-05-bank-quality-v1",
  "company_name": "HDFC Bank Ltd",
  "as_of_date": "2025-03-31",
  "source_notes": "FY16-FY25, sourced from Integrated Annual Reports.",
  "periods": [
    {
      "period_end": "2025-03-31",
      "fiscal_label": "FY25",

      "gnpa_pct": 1.33,
      "nnpa_pct": 0.43,
      "pcr_pct": 67.92,
      "slippage_pct": 1.5,
      "restructured_pct": null,

      "crar_pct": 19.6,
      "tier1_pct": 17.69,
      "cet1_pct": null,

      "casa_pct": 34.36,

      "advances_growth_pct": 5.4,
      "deposits_growth_pct": 14.1,

      "source_doc": "HDFCBANK_AR_FY2025.pdf",
      "source_page": 198,
      "source_notes": "PCR excludes technical write-offs."
    }
  ]
}
```

### Field semantics

| Field | Units | Source | Notes |
|---|---|---|---|
| `gnpa_pct` | % | Highlights table or MD&A | Gross NPA / Gross Advances |
| `nnpa_pct` | % | Highlights table or MD&A | Net NPA / Net Advances. Must be ≤ `gnpa_pct` |
| `pcr_pct` | % | MD&A typically | Definitions vary across banks — note inclusions/exclusions in `source_notes` |
| `slippage_pct` | % | MD&A typically | Fresh slippages / opening standard advances |
| `restructured_pct` | % | MD&A | Standard restructured book / advances |
| `crar_pct` | % | Highlights table | Total CRAR (Basel III) |
| `tier1_pct` | % | Highlights table | Tier-1 capital ratio. Must be ≤ `crar_pct` |
| `cet1_pct` | % | Highlights table | Common Equity Tier-1. Optional — banks vary on disclosure |
| `casa_pct` | % | MD&A or "deposits" breakup | (Current + Savings) / Total Deposits |
| `advances_growth_pct` | % YoY | Computed or AR | Cross-checkable against Capitaline-computed growth |
| `deposits_growth_pct` | % YoY | Computed or AR | Cross-checkable against Capitaline-computed growth |
| `source_doc` | string | — | PDF filename used for audit trail |
| `source_page` | int | — | Page number where the values were read |
| `source_notes` | string | — | Per-record context, e.g., definition variations |

**All ratio fields are PERCENTAGES** (e.g., `1.33` means 1.33%, NOT 0.0133).
This matches how the values appear in ARs and minimises transcription
friction. The validator's plausibility bands enforce this convention:
NPA fields must fall in `[0, 30]`, CRAR/Tier-1 in `[0, 50]`, CASA/PCR in
`[0, 100]`. Out-of-band values produce warnings (not errors) so genuine
stress-year anomalies still load.

### Validation rules (`validateBankQualityIndicators`)

**Errors** (block the load — sidecar is rejected):
- `schema_version` mismatch
- Missing `company_name` or `as_of_date`
- Malformed `period_end` (must be `YYYY-MM-DD`)
- Duplicate `period_end` across records
- Non-finite numbers in ratio fields

**Warnings** (load but flag for review):
- `nnpa_pct > gnpa_pct` (definitionally impossible)
- `tier1_pct > crar_pct` (definitionally impossible)
- Ratios outside plausibility bands
- `|growth_pct| > 100%` (likely AR demerger/structural break)

The browser loader (`fetchBankQualityIndicators`) treats 404 / network
errors as non-fatal — the bank pipeline still runs without quality data,
producing skip-with-reason on every derived signal. Schema-version
mismatches and bad JSON throw loud, surfaced to the console.

## Engine integration

```
                      App.tsx
                         │
       quality_data_folder│ company_id
                         ▼
              fetchBankQualityIndicators()
                         │
                         ▼
       /data/companies/<folder>/quality_indicators.json
                         │
                ┌────────┴────────┐
                │  404 → null     │  200 → parsed + validated
                ▼                 ▼
         (graceful degradation)   BankQualityIndicators
                                          │
                                          ▼
                       processCompanyDataFull(rawData, config, quality)
                                          │
                                          ▼
                       processBankData(...quality)
                                          │
                              ┌───────────┴───────────┐
                              ▼                       ▼
                    indexQualityByPeriod()   computeBankAssetQuality()
                              │                       │
                              ▼                       ▼
                      BankPeriodMetrics.quality  AnalysisResult.assetQuality
                                          │
                                          ▼
                     FinancialInstitutionReport → AssetQualitySection
```

## Derived signals (Phase B5.2)

Each signal is independently skip-with-reason. Partial sidecars produce
partial output — a curator can fill GNPA + CRAR first, ship, and add
PCR / slippage later without breaking anything.

| Signal | Inputs | Output | Threshold notes |
|---|---|---|---|
| **NPA cycle position** | `gnpa_pct` ≥ 2 periods | `rising` / `peaking` / `improving` / `stable` | Long-run delta + most-recent-step direction disambiguates "still climbing" from "rolled over" |
| **PCR trend** | `pcr_pct` ≥ 2 periods | `improving` / `stable` / `weakening` | ±5pp threshold |
| **Slippage trajectory** | `slippage_pct` ≥ 2 periods | `improving` / `stable` / `weakening` | ±0.3pp threshold; skip-reason explains slippage is typically MD&A-only |
| **Loan growth vs system** | `advances_growth_pct` (latest) | `outpacing-system` / `in-line-with-system` / `lagging-system` | ±3pp vs configurable system reference (default 12%) |
| **Deposit franchise** | `casa_pct` (latest, optional trend) | `premium` (≥40) / `above-average` (30-40) / `average` (22-30) / `weak` (<22) + trend | Indian system norms; HDFC/SBI/Kotak premium tier |
| **Capital buffer** | `tier1_pct` or `crar_pct` (with 2pp haircut) | `comfortable` / `adequate` / `thin` / `breach` | RBI floor 9.5% Tier-1 (Basel III + CCB) |

## UI surfaces (Phase B5.3)

Inside `FinancialInstitutionReport.tsx`, the **Asset Quality (Phase B5)**
section appears for `subtype === "bank" | "nbfc"`:

- **8-cell KPI grid**: GNPA, NNPA, PCR, CRAR, Tier-1, Slippage, CASA,
  Advances Growth — each tagged with the relevant derived-signal label
  underneath
- **Severity-coded coloring**:
  - rose: capital breach, NPA rising
  - amber: thin capital buffer, PCR weakening, weak deposit franchise
  - emerald: improving signals
- **Severity callout banners** — explicit warnings for the highest-impact
  conditions
- **9-column trend table** showing all curated periods
- **Coverage diagnostic** in the footer (periods curated, latest period
  field density)

When no sidecar is present, the section shows an amber reminder banner
with explicit guidance to drop the JSON file. UI works gracefully even
before any fixture data lands.

## Extraction strategy (Phase B5.5 — deferred)

Filling the sidecar JSON for HDFC, ICICI, SBI, Kotak across FY16-FY25 is
roughly 240 cells of hand-curated data. There are three viable ways to
populate it.

### Option A — `pdfplumber` + regex (traditional Python)

- Per-bank "row map" config because each bank's 10-year highlights table
  has the indicators on different rows
- Regex passes on MD&A text for slippage and PCR
- **Reliable** for table data when ruled gridlines exist (FY18+)
- **Flaky** for older ARs (FY14-FY17) where the table layout shifted
- **Effort**: 1-2 days to build per-bank maps for 4 banks. Ongoing
  maintenance when banks rev their AR template.
- **Accuracy**: 80-90% on tables, 60-70% on prose. Wrong cells can be
  subtle (e.g., FY24 number aligned with FY23 column header)

### Option B — Vision LLM on the highlights page (recommended)

- Render each AR's highlights page as a PNG, send to a vision-capable
  LLM (Claude / GPT-4o), prompt for the structured output that maps to
  the schema
- LLM handles the column alignment that breaks `pdftotext`, handles
  row-label variations, returns clean JSON
- One image call per AR (40 calls total: 4 banks × 10 ARs)
- Regex pass on MD&A text for prose-only fields (slippage, PCR variants)
- **Effort**: half a day for the extractor + prompt
- **Accuracy**: 95%+ on tables when prompt is tight. Spot-check needed
  on edge cases:
  - HDFC FY24 pre-merger vs post-merger (numbers shift dramatically
    after July 2023 amalgamation)
  - PCR with vs without technical write-offs (definition varies)
  - SBI consolidated vs standalone (insurance subsidiaries distort)
- **Cost**: trivial at current API pricing

### Option C — Pure LLM reads the whole AR

- Pipe the full AR (or relevant chunks) through an LLM, ask for the full
  sidecar JSON
- Most "magic", least controllable
- Hallucination risk on prose-only fields where the LLM might guess
- **Use only with the audit script** below

### The audit script — non-negotiable for any approach

A small Python script that runs after extraction:

1. **Cross-check growth rates against Capitaline-computed values** —
   `advances_growth_pct` extracted from the AR should match
   `(latest_advances / prior_advances - 1) * 100` computed from the
   Capitaline `.xls` we already parse. Mismatches > 1pp signal column-
   alignment errors in the table extraction.
2. **Run `validateBankQualityIndicators` programmatically** — cross-field
   sanity (NNPA ≤ GNPA, Tier-1 ≤ CRAR), plausibility-band warnings.
3. **Output `extraction-audit.md`** listing every cell that needs human
   review: low-confidence cells, plausibility warnings, growth-rate
   mismatches.

### Recommended workflow when B5.5 ships

1. Build Option B's vision-LLM extractor (~ half day)
2. Build the audit script (~ 1 hour)
3. Run extractor across 4 banks × 10 ARs
4. Run audit script
5. Manually review and patch flagged cells (~ 1-2 hours per bank)
6. Commit the four `quality_indicators.json` files

Total estimated effort: 1-1.5 days for all 4 banks, vs ~2-3 days of
pure manual transcription with a higher error rate.

## Adding a new bank

End-to-end flow once the contract is in place:

1. Create folder: `public/data/companies/<Bank Name>/`
2. Drop the Capitaline files (BalanceSheetINDAS_, ProfitLossINDAS_, CashFlow_)
3. Create `quality_indicators.json` (manual, vision-LLM, or pdfplumber
   pipeline — your choice)
4. Reload the app, upload the Capitaline ZIP
5. Asset Quality section populates automatically with KPI grid, severity
   banners, and trend table

No code changes required. No engine config changes required for the
common case (company_id resolution handles the folder lookup).

## Schema versioning policy

The `schema_version` constant is bumped only on **breaking** changes:
- Renaming a field
- Removing a field
- Changing a field's units (e.g., switching to 0-1 fractions)

Additive changes (new optional fields) do NOT bump the version. The
loader rejects mismatched versions to prevent silent corruption when an
old fixture is opened against new code or vice-versa.

## Related Phase B5 commits

```
576c78c  feat(bank-quality): Phase B5.1 — asset-quality indicators contract
1b7e12a  feat(bank-quality): Phase B5.2 — derived asset-quality signals
fc2da6b  feat(ui): Phase B5.3 — Asset Quality surface in FinancialInstitutionReport
91f4034  feat(bank-quality): Phase B5 final wiring — App-level sidecar fetch
```

## Files

- `src/engine/bankQualityIndicators.ts` — schema, validator, indexer, loader
- `src/engine/bankAssetQuality.ts` — six derived signals, pure functions
- `src/engine/bankPipeline.ts` — joins quality records into BankPeriodMetrics
- `src/engine/pipeline.ts` — passes quality through processCompanyDataFull
- `src/engine/analysisFamily.ts` — assetQuality field on the result envelope
- `src/components/FinancialInstitutionReport.tsx` — AssetQualitySection
- `src/App.tsx` — async fetch wiring
- `src/engine/types.ts` — EngineConfig.quality_data_folder
- `src/engine/__tests__/bankQualityIndicators.spec.ts` — 17 contract tests
- `src/engine/__tests__/bankAssetQuality.spec.ts` — 33 signal tests
