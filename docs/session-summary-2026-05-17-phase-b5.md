# Session Summary — 2026-05-17 (Phase B5 — Bank Quality Flags)

Continuation of the 2026-05-17 session, after Phase J (negative net
worth) and Phase K (NBFC metrics). Tackled item #7 from the "still to
ship" list — bank quality flags (NPA cycle, CRAR, PCR, slippage, CASA,
deposit franchise, loan growth vs system).

## Context — why a sidecar

Capitaline's static `.xls` exports for banks contain only the formal
financial statements. They do **not** carry the asset-quality and
capital-adequacy indicators that drive bank investment decisions:
GNPA / NNPA, PCR, CRAR, Tier-1, slippage, restructured book, CASA,
advances/deposits growth.

Those numbers live in two places inside the Annual Report PDF:
- The 10-Year Financial Highlights table (HDFC FY25 page 198, etc.)
- MD&A prose ("Gross NPA Ratio stood at 1.33%...")

Conclusion: the data needs a separate input channel. Phase B5 lands the
contract, signals, UI, and App-level fetch path for an optional sidecar
JSON file alongside the Capitaline exports. Hand-curated fixture data
(B5.5) is deferred to a later session — see
`docs/bank-quality-indicators-design.md` for extraction strategy options.

## Shipped (4 commits, 568 tests, build clean)

### Phase B5.1 — asset-quality indicators contract

- **`576c78c`** feat(bank-quality): Phase B5.1
  - `bankQualityIndicators.ts` — typed schema with versioning
    (`2026-05-bank-quality-v1`), range/cross-field plausibility
    validation (NNPA ≤ GNPA, Tier-1 ≤ CRAR, ratio bands), period
    indexing for O(1) join, browser loader with 404/network graceful
    fallback and loud schema-mismatch errors
  - `BankPeriodMetrics.quality` field — joined by `period_end` inside
    `processBankData`. Periods without a sidecar match stay null.
  - `processCompanyDataFull` gains an optional quality parameter.
  - 17 unit tests covering schema validation, plausibility warnings,
    period indexing, loader graceful 404 / loud schema errors.

### Phase B5.2 — derived asset-quality signals

- **`1b7e12a`** feat(bank-quality): Phase B5.2
  - `bankAssetQuality.ts` — six independent signals derived from
    per-period quality records, each skip-with-reason on insufficient
    data:
    - **NPA cycle position**: rising / peaking / improving / stable
      (uses 3y delta + most-recent-step direction to disambiguate)
    - **PCR trend**: improving / stable / weakening (±5pp threshold)
    - **Slippage trajectory**: improving / stable / weakening
      (skip-reason explains MD&A-only typical reporting)
    - **Loan growth vs system**: outpacing / in-line / lagging
      (config-aware reference, default 12% Indian system credit)
    - **Deposit franchise**: premium ≥40 / above-average 30-40 /
      average 22-30 / weak <22 + 3y trend
    - **Capital buffer**: comfortable / adequate / thin / breach
      vs RBI Tier-1 minimum 9.5% (Basel III + CCB); Tier-1 preferred,
      CRAR-as-proxy with 2pp haircut as fallback
  - Wired into `FinancialInstitutionAnalysisResult.assetQuality`.
    Always populated for bank/NBFC subtypes.
  - Coverage diagnostic in the bundle reports the latest period's
    field density.
  - 33 unit tests covering threshold edges, empty/null inputs, and
    HDFC FY25 realistic shape end-to-end.

### Phase B5.3 — UI surface in FinancialInstitutionReport

- **`fc2da6b`** feat(ui): Phase B5.3
  - New `AssetQualitySection` component renders for both bank and
    NBFC subtypes:
    - **8-cell KPI grid** (latest snapshot): GNPA, NNPA, PCR, CRAR,
      Tier-1, Slippage, CASA, Advances Growth — each with the
      relevant derived-signal label underneath
    - **Severity-aware coloring**: rose for breach/rising-NPA,
      amber for thin/weakening, emerald for improving
    - **Severity callout banners** for the highest-impact warnings:
      capital breach, thin buffer, rising NPA cycle, weakening PCR,
      weak deposit franchise
    - **9-column trend table** with fiscal labels across all curated
      periods
    - **Coverage footer** reports periods curated and field density
  - **No-sidecar fallback**: amber reminder banner with explicit
    guidance to drop `quality_indicators.json`. UI works gracefully
    even before fixture data lands.

### Phase B5.4 — App-level sidecar fetch wiring

- **`91f4034`** feat(bank-quality): Phase B5 final wiring
  - New `EngineConfig.quality_data_folder` knob (defaults to null)
  - `App.tsx` fetches the sidecar asynchronously via
    `fetchBankQualityIndicators` whenever `quality_data_folder` OR
    `rawData[0].company_id` resolves to a folder. Common case "bulk-
    uploaded Capitaline data" just works.
  - Fetch is graceful: 404 / network errors yield null and the engine
    still runs unchanged. Schema/parse errors throw loud (logged to
    console).
  - Pipeline memo's dep array includes `bankQuality`, so asset-quality
    signals populate as soon as the fetch resolves.

### Documentation

- `docs/bank-quality-indicators-design.md` (new, ~480 lines) — full
  Phase B5 design doc:
  - Why the sidecar exists (Capitaline gap)
  - File location, resolution order
  - Full schema with field semantics table
  - Validation rules (errors vs warnings)
  - Engine integration diagram
  - Derived signals table with thresholds
  - UI surfaces
  - **Extraction strategy** — three options for B5.5 fixture data:
    (A) pdfplumber + regex; (B) vision LLM on highlights page —
    recommended; (C) pure LLM on full AR
  - Audit script design (cross-check growth rates against Capitaline-
    computed values, programmatic validator, extraction-audit.md output)
  - "Adding a new bank" end-to-end flow
  - Schema versioning policy

## Validation status

- `npm run typecheck`: clean
- `npm run validate` (typecheck + tests + build): clean
- 568 tests passing across 77 test files (up from 516 at K end)
- All commits pushed to `origin/main`

## What this enables now

| Component | Before | After |
|---|---|---|
| HDFC / ICICI / SBI / Kotak | Bank pipeline + B4 valuation, no asset quality | Full asset-quality surface ready; populates when sidecar provided |
| Bajaj Finance (NBFC) | NBFC metrics from K | Same NBFC metrics + asset quality when sidecar provided |
| New bank addition | Drop Capitaline files in folder | Drop Capitaline files + optional `quality_indicators.json` — no code changes |

## Patterns established this session

- **Sidecar contract pattern** — when source data (Capitaline) doesn't
  carry a class of indicators, a versioned JSON sidecar lives alongside
  it. Fail-graceful (404 = nothing to surface), fail-loud (schema
  mismatch = thrown error, never silent corruption).

- **Skip-with-reason for derived signals over partial data** — every
  signal in `bankAssetQuality` independently skip-with-reason. A
  curator filling GNPA + CRAR first ships, adds PCR / slippage later,
  no breakage. This is now the house style for any module computing
  multiple signals from a sparse input.

- **Polarity-correct fallbacks** — `capital buffer` falls back from
  Tier-1 to CRAR-with-haircut rather than treating absence as failure.
  Pattern: prefer the precise input, accept a less-precise proxy with
  a known correction, never error on partial data.

- **Three-tier severity ladder** — `comfortable` / `adequate` / `thin` /
  `breach` for capital; `premium` / `above-average` / `average` / `weak`
  for deposits. Same shape as Phase J distress (`none` / `warning` /
  `severe` / `critical`). Letting the categorical encoding drive the
  UI severity coloring keeps presentation consistent across all signals.

- **Document the gap explicitly** — `docs/bank-quality-indicators-design.md`
  treats the Capitaline limitation as a first-class architecture
  constraint, not a footnote. Future contributors see the WHY (data
  lives only in AR PDFs) before they see the HOW (sidecar JSON).

## What's still to ship

In rough priority order:

1. ~~**NBFC-specific metrics**~~ — DONE Phase K
2. **Currency/unit auto-detection** — Capitaline normally emits in Cr but
   some files use lakhs or absolute. Header parser today assumes Cr.
3. **Single-period uploads** — Currently might run with degenerate output.
   Should produce a "screening only" mode with explicit caveats.
4. ~~**Negative book value**~~ — DONE Phase J
5. **Demerger / M&A detection** — Partially shipped via structural-breaks
   (Phase I); could be tightened with explicit operator confirmation flow.
6. **Insurance pipeline (Phase E)** — LIC fail-closes correctly today.
   Building a real insurance pipeline is a multi-week investment.
7. ~~**Phase B5 — Bank quality flags**~~ — **DONE this session**
   - **Phase B5.5 (deferred)**: hand-curate `quality_indicators.json`
     for HDFC / ICICI / SBI / Kotak FY16-FY25 using vision-LLM
     extraction + audit script (recommended approach in design doc).

## Reference

- Design doc: `docs/bank-quality-indicators-design.md`
- Annual reports: `C:\Users\rajesh\WindsurfAPI\ITC-valuation-template\public\data\annual_reports\{HDFCBANK,ICICIBANK,SBIN,KOTAKBANK}\`
